import type { BankTxn, Cents, Change, CompanyModel, ISODate, Snapshot } from "@domino/contracts";
import { addDays, toMs } from "./dates";
import { cashSchedule, forecastFromSchedule } from "./forecast";
import { type CashItem, bucketOf } from "./schedule";

/**
 * Weekly direct-method cash flow statement: actual weeks from bank transactions, then the 13
 * projected weeks of the existing forecast, in one shape. Integer cents only.
 *
 * Classification rules (first match wins). Snapshot records carry no category on bank
 * transactions or bills, so lines come from record links and plain text:
 *
 * | Record / signal                                   | Line                               |
 * | ------------------------------------------------- | ---------------------------------- |
 * | Bank txn naming a payroll run id                  | payroll                            |
 * | Bank txn naming an invoice id                     | customer collections               |
 * | Bank txn naming a card txn id                     | card spend                         |
 * | Bank txn naming a bill id                         | vendor text rule, else supplier    |
 * | Text "payroll", "gusto", "adp", "salary", "wages" | payroll (includes payroll taxes)   |
 * | Text "interest": out / in                         | interest paid / other operating    |
 * | Text "tax", "irs", "franchise"                    | taxes paid                         |
 * | Text "capitalized software"                       | capitalized software               |
 * | Text "capex", "equipment", "hardware", "furniture"| capital expenditure                |
 * | Text "acquisition", "marketable securities"       | other investing                    |
 * | Text "loan", "credit line", "drawdown", "principal"| in: debt drawdown, out: repayment |
 * | Text "equity", "series x", "preferred stock"      | in: equity raised, out: other fin. |
 * | Text "rent", "lease", "landlord", "facilities"    | rent and facilities                |
 * | Text "card settlement", "card issuer", ramp, brex | card spend                         |
 * | Text "stripe", "customer payment"                 | customer collections               |
 * | Counterparty equal to a bill vendor               | vendor text rule, else supplier    |
 * | Inflow from a counterparty named as a customer    | customer collections               |
 * | Anything else                                     | other operating + `unclassified`   |
 *
 * Projected items (schedule.ts kinds): invoice and deal = customer collections; bill = vendor
 * text rule, else supplier payments; payroll = payroll; recurring = card spend (learn.ts builds
 * recurring spend from card transactions); shift_hire savings = payroll; add_cash/remove_cash =
 * text rules on the label, else other operating + `unclassified`.
 *
 * Card transactions and their `category` are not cash events: cash moves when the card is
 * settled from the bank, so every settlement is card spend whatever was bought. Deals, billing
 * plans, customers and pending payouts move no cash in the actual weeks; they only feed the
 * forecast. Bank transactions dated after asOf are not in cashOnHand and are listed in
 * `futureDated`, not counted.
 */
export const CASH_FLOW_STATEMENT_METHOD = "direct-weekly-1.0.0";

export const CFS_SECTIONS = ["operating", "investing", "financing"] as const;
export type CfsSection = (typeof CFS_SECTIONS)[number];

export const CFS_LINES = [
  { id: "customer_collections", section: "operating", label: "Customer collections" },
  { id: "payroll", section: "operating", label: "Payroll and payroll taxes" },
  { id: "supplier_payments", section: "operating", label: "Supplier payments" },
  { id: "rent_facilities", section: "operating", label: "Rent and facilities" },
  { id: "card_spend", section: "operating", label: "Card spend" },
  { id: "taxes_paid", section: "operating", label: "Taxes paid" },
  { id: "interest_paid", section: "operating", label: "Interest paid" },
  { id: "other_operating", section: "operating", label: "Other operating" },
  { id: "capex", section: "investing", label: "Capital expenditure" },
  { id: "capitalized_software", section: "investing", label: "Capitalized software" },
  { id: "other_investing", section: "investing", label: "Other investing" },
  { id: "debt_drawdown", section: "financing", label: "Debt drawdown" },
  { id: "debt_repayment", section: "financing", label: "Debt repayment" },
  { id: "equity_raised", section: "financing", label: "Equity raised" },
  { id: "other_financing", section: "financing", label: "Other financing" },
] as const;
export type CfsLineId = (typeof CFS_LINES)[number]["id"];
export type CfsLines = Record<CfsLineId, Cents>;

const SECTION_OF = Object.fromEntries(CFS_LINES.map((l) => [l.id, l.section])) as Record<
  CfsLineId,
  CfsSection
>;

export type CfsWeek = {
  weekStart: ISODate;
  /** Last day counted: the Sunday, or asOf for the partial current week. */
  weekEnd: ISODate;
  kind: "actual" | "projected";
  beginningCash: Cents;
  lines: CfsLines;
  operating: Cents;
  investing: Cents;
  financing: Cents;
  netChange: Cents;
  endingCash: Cents;
};

/** A flow that fell through every rule. It is still counted, in other operating. */
export type Unclassified = {
  source: "bank" | "forecast";
  id: string;
  date: ISODate;
  weekStart: ISODate;
  amount: Cents;
  text: string;
};

export type CashFlowStatement = {
  method: typeof CASH_FLOW_STATEMENT_METHOD;
  companyId: string;
  asOf: ISODate;
  restrictedCash: Cents;
  weeks: CfsWeek[];
  unclassified: Unclassified[];
  /** Bank transaction ids dated after asOf: not in cashOnHand, so not counted. */
  futureDated: string[];
};

export type TieOutError = {
  weekStart: ISODate;
  kind: "actual" | "projected";
  /** Balance from the bank records (actual) or the forecast (projected). */
  expected: Cents;
  /** Ending cash rolled forward through the statement. */
  actual: Cents;
  /** actual - expected */
  difference: Cents;
  message: string;
};

export type CfsResult<T> = { ok: true; value: T } | { ok: false; error: TieOutError };

export type Classification = { line: CfsLineId; rule: string; classified: boolean };

// ---------- Classification ----------

type TextRule = { rule: string; test: RegExp; line: CfsLineId; outflowLine?: CfsLineId };

// Order matters: "payroll tax" is payroll, "loan interest" is interest, "leasehold" is capex.
const TEXT_RULES: TextRule[] = [
  {
    rule: "payroll text",
    test: /\b(payroll|gusto|adp|rippling|paychex|salary|salaries|wages)\b/,
    line: "payroll",
  },
  {
    rule: "interest text",
    test: /\binterest\b/,
    line: "other_operating",
    outflowLine: "interest_paid",
  },
  { rule: "tax text", test: /\b(tax|taxes|irs|franchise)\b/, line: "taxes_paid" },
  {
    rule: "capitalized software text",
    test: /\bcapitali[sz]ed software\b/,
    line: "capitalized_software",
  },
  {
    rule: "capex text",
    test: /\b(capex|capital expenditure|equipment|hardware|furniture|leasehold)\b/,
    line: "capex",
  },
  {
    rule: "investing text",
    test: /\b(acquisition|marketable securities|purchase of investments?)\b/,
    line: "other_investing",
  },
  {
    rule: "debt text",
    test: /\b(loan|credit line|line of credit|venture debt|revolver|drawdown|principal)\b/,
    line: "debt_drawdown",
    outflowLine: "debt_repayment",
  },
  {
    rule: "equity text",
    test: /\b(equity|series [a-z]|preferred stock|stock issuance)\b/,
    line: "equity_raised",
    outflowLine: "other_financing",
  },
  {
    rule: "rent text",
    test: /\b(rent|lease|landlord|facilities|utilities|coworking)\b/,
    line: "rent_facilities",
  },
  {
    rule: "card text",
    test: /\b(card settlement|card payment|card issuer|amex|american express|ramp|brex)\b/,
    line: "card_spend",
  },
  { rule: "collections text", test: /\b(stripe|customer payment)\b/, line: "customer_collections" },
];

function byText(text: string, amount: Cents): Classification | null {
  const lower = text.toLowerCase();
  const hit = TEXT_RULES.find((r) => r.test.test(lower));
  if (!hit) return null;
  const line = amount < 0 && hit.outflowLine ? hit.outflowLine : hit.line;
  return { line, rule: hit.rule, classified: true };
}

const UNCLASSIFIED: Classification = {
  line: "other_operating",
  rule: "unclassified",
  classified: false,
};

/** A bill is a supplier payment unless its vendor names a more specific line. */
function vendorLine(vendor: string, amount: Cents, rule: string): Classification {
  const hit = byText(vendor, amount);
  return hit
    ? { ...hit, rule: `${rule}, ${hit.rule}` }
    : { line: "supplier_payments", rule, classified: true };
}

export type RecordIndex = {
  invoices: Set<string>;
  payroll: Set<string>;
  cardTxns: Set<string>;
  bills: Map<string, string>;
  vendors: Set<string>;
  customers: Set<string>;
};

export function recordIndex(snapshot: Snapshot): RecordIndex {
  return {
    invoices: new Set(snapshot.invoices.map((i) => i.id)),
    payroll: new Set(snapshot.payroll.map((p) => p.id)),
    cardTxns: new Set(snapshot.cardTxns.map((c) => c.id)),
    bills: new Map(snapshot.bills.map((b) => [b.id, b.vendor])),
    vendors: new Set(snapshot.bills.map((b) => b.vendor.toLowerCase())),
    customers: new Set(snapshot.customers.map((c) => c.name.toLowerCase())),
  };
}

export function classifyBankTxn(txn: BankTxn, index: RecordIndex): Classification {
  for (const token of txn.description.split(/[^A-Za-z0-9_-]+/)) {
    if (!token) continue;
    if (index.payroll.has(token))
      return { line: "payroll", rule: "linked payroll run", classified: true };
    if (index.invoices.has(token))
      return { line: "customer_collections", rule: "linked invoice", classified: true };
    if (index.cardTxns.has(token))
      return { line: "card_spend", rule: "linked card transaction", classified: true };
    const vendor = index.bills.get(token);
    if (vendor !== undefined) return vendorLine(vendor, txn.amount, "linked bill");
  }
  const text = byText(`${txn.description} ${txn.counterparty ?? ""}`, txn.amount);
  if (text) return text;
  const party = txn.counterparty?.toLowerCase();
  if (party !== undefined && index.vendors.has(party))
    return vendorLine(txn.counterparty ?? "", txn.amount, "bill vendor");
  if (party !== undefined && txn.amount > 0 && index.customers.has(party))
    return { line: "customer_collections", rule: "customer counterparty", classified: true };
  return UNCLASSIFIED;
}

export function classifyCashItem(
  item: CashItem,
  index: RecordIndex,
  changes: Change[],
): Classification {
  switch (item.kind) {
    case "invoice":
    case "deal":
      return { line: "customer_collections", rule: `forecast ${item.kind}`, classified: true };
    case "plan":
      return { line: "customer_collections", rule: "forecast billing plan", classified: true };
    case "payroll":
      return { line: "payroll", rule: "forecast payroll", classified: true };
    case "recurring":
      return { line: "card_spend", rule: "forecast recurring card spend", classified: true };
    case "bill":
      return vendorLine(index.bills.get(item.id) ?? "", item.amount, "forecast bill");
    case "change": {
      const change = changes.find(
        (c) =>
          (c.kind === "add_cash" || c.kind === "remove_cash" || c.kind === "shift_hire") &&
          c.label === item.id,
      );
      if (change?.kind === "shift_hire")
        return { line: "payroll", rule: "planned hire shift", classified: true };
      return byText(item.id, item.amount) ?? UNCLASSIFIED;
    }
  }
}

// ---------- Weeks ----------

const zeroLines = (): CfsLines => Object.fromEntries(CFS_LINES.map((l) => [l.id, 0])) as CfsLines;

type Bucket = { weekStart: ISODate; weekEnd: ISODate; lines: CfsLines };

function closeWeek(bucket: Bucket, kind: CfsWeek["kind"], beginningCash: Cents): CfsWeek {
  const totals: Record<CfsSection, Cents> = { operating: 0, investing: 0, financing: 0 };
  for (const l of CFS_LINES) totals[SECTION_OF[l.id]] += bucket.lines[l.id];
  const netChange = totals.operating + totals.investing + totals.financing;
  return {
    weekStart: bucket.weekStart,
    weekEnd: bucket.weekEnd,
    kind,
    beginningCash,
    lines: bucket.lines,
    ...totals,
    netChange,
    endingCash: beginningCash + netChange,
  };
}

function mondayOf(date: ISODate): ISODate {
  const dow = new Date(toMs(date)).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}

const tieError = (
  weekStart: ISODate,
  kind: CfsWeek["kind"],
  expected: Cents,
  actual: Cents,
  source: string,
): TieOutError => ({
  weekStart,
  kind,
  expected,
  actual,
  difference: actual - expected,
  message: `${kind} week ${weekStart} does not tie: statement ending ${actual} cents, ${source} ${expected} cents, difference ${actual - expected} cents`,
});

export type ActualOptions = {
  /** Number of actual weeks ending with the week of asOf. Default: from the earliest bank txn. */
  weeks?: number;
  /** Known bank balance at the start of the first week. Default: implied from cashOnHand. */
  openingCash?: Cents;
};

/**
 * Actual weeks from bank transactions on or before asOf. cashOnHand is the bank balance at the
 * end of asOf, so each week close must equal cashOnHand minus every later transaction through
 * asOf. That balance is computed straight from the raw transactions, independent of the lines,
 * so a dropped or double-counted transaction (or a wrong openingCash) fails the tie-out.
 */
export function actualCashFlow(
  snapshot: Snapshot,
  options: ActualOptions = {},
): CfsResult<CashFlowStatement> {
  const { asOf } = snapshot;
  const index = recordIndex(snapshot);
  const txns = snapshot.bankTxns.filter((t) => t.date <= asOf);
  const futureDated = snapshot.bankTxns.filter((t) => t.date > asOf).map((t) => t.id);
  const lastMonday = mondayOf(asOf);
  const earliest = txns.reduce<ISODate>((min, t) => (t.date < min ? t.date : min), asOf);
  const count =
    options.weeks ?? Math.round((toMs(lastMonday) - toMs(mondayOf(earliest))) / 604_800_000) + 1;
  if (!Number.isInteger(count) || count < 1) throw new Error("weeks must be a whole number >= 1");
  const buckets: Bucket[] = Array.from({ length: count }, (_, i) => {
    const weekStart = addDays(lastMonday, -7 * (count - 1 - i));
    const weekEnd = i === count - 1 ? asOf : addDays(weekStart, 6);
    return { weekStart, weekEnd, lines: zeroLines() };
  });
  const first = buckets[0]?.weekStart ?? lastMonday;
  const unclassified: Unclassified[] = [];
  let inRange = 0;
  for (const txn of txns) {
    if (txn.date < first) continue;
    const i = Math.floor((toMs(txn.date) - toMs(first)) / 604_800_000);
    const bucket = buckets[i];
    if (!bucket) throw new Error(`bank txn ${txn.id} outside the statement weeks`);
    const c = classifyBankTxn(txn, index);
    bucket.lines[c.line] += txn.amount;
    inRange += txn.amount;
    if (!c.classified) {
      const text = [txn.description, txn.counterparty].filter(Boolean).join(" / ");
      unclassified.push({
        source: "bank",
        id: txn.id,
        date: txn.date,
        weekStart: bucket.weekStart,
        amount: txn.amount,
        text,
      });
    }
  }
  let beginning = options.openingCash ?? snapshot.cashOnHand - inRange;
  const weeks: CfsWeek[] = [];
  for (const bucket of buckets) {
    const week = closeWeek(bucket, "actual", beginning);
    const after = txns.reduce((sum, t) => (t.date > bucket.weekEnd ? sum + t.amount : sum), 0);
    const bank = snapshot.cashOnHand - after;
    if (week.endingCash !== bank)
      return {
        ok: false,
        error: tieError(week.weekStart, "actual", bank, week.endingCash, "bank balance"),
      };
    weeks.push(week);
    beginning = week.endingCash;
  }
  return { ok: true, value: statement(snapshot, weeks, unclassified, futureDated) };
}

/**
 * The 13 forecast weeks after asOf, classified. Reuses the forecast's own schedule and
 * bucketing (overdue items in week 0, items past the horizon dropped) and must close to the
 * forecast's weekly closing cash exactly.
 */
export function projectedCashFlow(
  snapshot: Snapshot,
  model: CompanyModel,
  changes: Change[] = [],
): CfsResult<CashFlowStatement> {
  const schedule = cashSchedule(snapshot, model, changes);
  const projected = forecastFromSchedule(snapshot, schedule);
  const index = recordIndex(snapshot);
  const buckets: Bucket[] = schedule.weeks.map((weekStart) => ({
    weekStart,
    weekEnd: addDays(weekStart, 6),
    lines: zeroLines(),
  }));
  const unclassified: Unclassified[] = [];
  for (const item of schedule.items) {
    const i = bucketOf(item.date, schedule.weeks);
    const bucket = i === null ? undefined : buckets[i];
    if (!bucket) continue;
    const c = classifyCashItem(item, index, changes);
    bucket.lines[c.line] += item.amount;
    if (!c.classified)
      unclassified.push({
        source: "forecast",
        id: `${item.kind}:${item.id}`,
        date: item.date,
        weekStart: bucket.weekStart,
        amount: item.amount,
        text: item.id,
      });
  }
  let beginning = snapshot.cashOnHand;
  const weeks: CfsWeek[] = [];
  for (const [i, bucket] of buckets.entries()) {
    const week = closeWeek(bucket, "projected", beginning);
    const expected = projected.weeks[i]?.closing;
    if (expected === undefined || week.endingCash !== expected)
      return {
        ok: false,
        error: tieError(
          week.weekStart,
          "projected",
          expected ?? 0,
          week.endingCash,
          "forecast closing",
        ),
      };
    weeks.push(week);
    beginning = week.endingCash;
  }
  return { ok: true, value: statement(snapshot, weeks, unclassified, []) };
}

/** Actual weeks through asOf, then the 13 projected weeks. The seam must tie too. */
export function cashFlowStatement(
  snapshot: Snapshot,
  model: CompanyModel,
  changes: Change[] = [],
  options: ActualOptions = {},
): CfsResult<CashFlowStatement> {
  const actual = actualCashFlow(snapshot, options);
  if (!actual.ok) return actual;
  const projected = projectedCashFlow(snapshot, model, changes);
  if (!projected.ok) return projected;
  const last = actual.value.weeks.at(-1);
  const next = projected.value.weeks[0];
  if (last && next && last.endingCash !== next.beginningCash)
    return {
      ok: false,
      error: tieError(
        next.weekStart,
        "projected",
        last.endingCash,
        next.beginningCash,
        "actual ending",
      ),
    };
  return {
    ok: true,
    value: {
      ...actual.value,
      weeks: [...actual.value.weeks, ...projected.value.weeks],
      unclassified: [...actual.value.unclassified, ...projected.value.unclassified],
    },
  };
}

function statement(
  snapshot: Snapshot,
  weeks: CfsWeek[],
  unclassified: Unclassified[],
  futureDated: string[],
): CashFlowStatement {
  return {
    method: CASH_FLOW_STATEMENT_METHOD,
    companyId: snapshot.companyId,
    asOf: snapshot.asOf,
    restrictedCash: snapshot.restrictedCash,
    weeks,
    unclassified,
    futureDated,
  };
}

// ---------- Dashboard summary ----------

export type CfsSummary = {
  /** Lowest projected ending cash; ties go to the earliest week. Null with no projected weeks. */
  lowestProjected: { weekStart: ISODate; endingCash: Cents; usable: Cents } | null;
  runway: {
    /**
     * Average weekly net outflow over the weeks in `basis`, rounded to cents: the projected
     * weeks when the statement has them (forward burn, including expected recurring billing),
     * else the last complete actual weeks.
     */
    weeklyBurn: Cents;
    /** Whole weeks usable cash (latest actual ending - restrictedCash) lasts. Null if not burning. */
    weeks: number | null;
    basis: ISODate[];
  };
  projectedTotals: { operating: Cents; investing: Cents; financing: Cents; netChange: Cents };
};

/**
 * Runway uses projected burn: the average net change of the projected weeks. A statement with
 * no projected weeks falls back to `burnWeeks` complete actual weeks (the partial week of asOf
 * is skipped). Runway uses exact integer division, so it never rounds up into a week the cash
 * cannot cover.
 */
export function cashFlowSummary(statement: CashFlowStatement, burnWeeks = 4): CfsSummary {
  const projected = statement.weeks.filter((w) => w.kind === "projected");
  const actual = statement.weeks.filter((w) => w.kind === "actual");
  const low = projected.reduce<CfsWeek | null>(
    (a, b) => (a === null || b.endingCash < a.endingCash ? b : a),
    null,
  );
  const complete = actual.filter((w) => w.weekEnd === addDays(w.weekStart, 6));
  const basis = projected.length > 0 ? projected : complete.slice(-burnWeeks);
  const burned = -basis.reduce((sum, w) => sum + w.netChange, 0);
  const n = basis.length;
  const weeklyBurn = n === 0 ? 0 : roundHalfUp(burned, n);
  const latest = actual.at(-1)?.endingCash ?? projected[0]?.beginningCash ?? 0;
  const usable = latest - statement.restrictedCash;
  const runwayWeeks =
    n === 0 || burned <= 0
      ? null
      : Math.max(0, Number((BigInt(usable) * BigInt(n)) / BigInt(burned)));
  const sum = (key: "operating" | "investing" | "financing" | "netChange") =>
    projected.reduce((s, w) => s + w[key], 0);
  return {
    lowestProjected: low && {
      weekStart: low.weekStart,
      endingCash: low.endingCash,
      usable: low.endingCash - statement.restrictedCash,
    },
    runway: { weeklyBurn, weeks: runwayWeeks, basis: basis.map((w) => w.weekStart) },
    projectedTotals: {
      operating: sum("operating"),
      investing: sum("investing"),
      financing: sum("financing"),
      netChange: sum("netChange"),
    },
  };
}

/** num / den rounded half toward +infinity, exactly (den > 0). */
function roundHalfUp(num: number, den: number): Cents {
  const a = 2n * BigInt(num) + BigInt(den);
  const b = 2n * BigInt(den);
  const q = a / b;
  return Number(a % b !== 0n && a < 0n ? q - 1n : q);
}
