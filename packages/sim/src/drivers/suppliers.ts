import {
  SIM_START,
  addDays,
  bps,
  dayIn,
  dollarsBetween,
  firstOfMonth,
  int,
  isBusinessDay,
  keyed,
  lastOfMonth,
  monthOf,
  months,
  nextMonth,
  onOrAfterBusinessDay,
  onOrBeforeBusinessDay,
  pick,
  sum,
} from "./basics.ts";
import type { Book } from "./customers.ts";
import type { Roster } from "./payroll.ts";
import type { ProfileSpec } from "./profiles.ts";

/**
 * Supplier drivers: accounts payable with real terms (hosting that scales with recurring
 * revenue, software, contractors, professional services, marketing, insurance, recruiting),
 * the office lease, taxes, capital spending (equipment and leasehold improvements, billed,
 * never on the card), capitalized software development, scheduled term-loan principal, and
 * company card spend settled monthly against a card statement bill.
 */
export type BillKind =
  | "hosting"
  | "cogs_software"
  | "software"
  | "contractor"
  | "services"
  | "marketing"
  | "insurance"
  | "recruiting"
  | "rent"
  | "card"
  | "tax"
  | "capex"
  | "capitalized_software"
  | "interest"
  | "principal";

export interface GenBill {
  id: string;
  vendor: string;
  amount: number;
  /** Day the bill arrived in the books; it is not observable before this */
  received: string;
  due: string;
  payOn: string;
  critical: boolean;
  kind: BillKind;
  /** Card statements: the card transactions they settle */
  cardIds?: string[];
}

export interface GenCard {
  id: string;
  date: string;
  amount: number;
  merchant: string;
  category: string;
}

/**
 * Fixed contractual dates known long before they fall due: the lease, the loan schedule, and
 * fixed-fee vendor contracts the books carry as recurring bill templates. Usage-based and
 * hourly bills (hosting, warehouse, contractors, legal) are only known once received.
 */
const CONTRACT_SIGNED = "2025-06-01";

const MERCHANTS: { merchant: string; category: string; range: [number, number]; weight: number }[] =
  [
    { merchant: "SkyJet Airlines", category: "Travel", range: [320, 1_450], weight: 3 },
    { merchant: "Metro Hotels", category: "Travel", range: [240, 1_150], weight: 3 },
    { merchant: "Rideline", category: "Travel", range: [18, 95], weight: 4 },
    { merchant: "Corner Table", category: "Meals", range: [42, 390], weight: 4 },
    { merchant: "Notely", category: "Software", range: [15, 320], weight: 2 },
    { merchant: "Figmint", category: "Software", range: [45, 720], weight: 1 },
    {
      merchant: "Paperhaus office supplies",
      category: "Office supplies",
      range: [28, 260],
      weight: 2,
    },
  ];
const WEIGHTS = MERCHANTS.flatMap((m, index) => Array<number>(m.weight).fill(index));
/** Weekly search and social ad charges, larger in the last month of a quarter and in autumn */
const ADS = [
  { merchant: "Searchly Ads", range: [6_200, 10_400] as [number, number] },
  { merchant: "Linkway Ads", range: [3_900, 7_100] as [number, number] },
];

export function generateCards(seed: number, from: string, end: string): GenCard[] {
  const cards: GenCard[] = [];
  for (let day = from; day <= end; day = addDays(day, 1)) {
    if (!isBusinessDay(day)) continue;
    const r = keyed(seed, `card:${day}`);
    const month = Number(day.slice(5, 7));
    const travelBoost = month === 9 || month === 10 ? 1 : 0;
    const count = int(r, 0, 2) + travelBoost - (month === 12 ? 1 : 0);
    for (let k = 0; k < count; k++) {
      const m = MERCHANTS[pick(r, WEIGHTS)]!;
      cards.push({
        id: `card_${day}_${k}`,
        date: day,
        amount: int(r, m.range[0] * 100, m.range[1] * 100),
        merchant: m.merchant,
        category: m.category,
      });
    }
    if (new Date(`${day}T00:00:00Z`).getUTCDay() === 2)
      for (const [k, ad] of ADS.entries())
        cards.push({
          id: `card_${day}_ad${k}`,
          date: day,
          amount: int(r, ad.range[0] * 100, ad.range[1] * 100),
          merchant: ad.merchant,
          category: "Advertising",
        });
  }
  return cards;
}

interface BillDraft {
  id: string;
  vendor: string;
  amount: number;
  received: string;
  due: string;
  critical: boolean;
  kind: BillKind;
  cardIds?: string[];
}

/** Critical bills are paid on the due date (the business day before, if needed); others 0-4 days after. */
function paid(seed: number, bill: BillDraft): GenBill {
  const r = keyed(seed, `billpay:${bill.id}`);
  let payOn = bill.critical
    ? onOrBeforeBusinessDay(bill.due)
    : onOrAfterBusinessDay(addDays(bill.due, int(r, 0, 4)));
  if (payOn < bill.received) payOn = onOrAfterBusinessDay(bill.received);
  return { ...bill, payOn };
}

export function generateBills(
  seed: number,
  spec: ProfileSpec,
  book: Book,
  roster: Roster,
  cards: GenCard[],
  end: string,
): GenBill[] {
  const drafts: BillDraft[] = [];
  const add = (draft: BillDraft) => {
    if (draft.amount > 0 && draft.received <= end) drafts.push(draft);
  };
  const net = (received: string, days: number) => addDays(received, days);
  const billings = (from: string, to: string) =>
    sum(book.invoices.filter((i) => i.issued >= from && i.issued <= to).map((i) => i.amount));

  for (const month of months(SIM_START, end)) {
    const first = firstOfMonth(month);
    const last = lastOfMonth(month);
    const r = keyed(seed, `bills:${month}`);
    const rent =
      spec.rent.stepUp && month >= spec.rent.stepUp.from ? spec.rent.stepUp.amount : spec.rent.base;
    add({
      id: `bill_rent_${month}`,
      vendor: "Harbor Point Properties office rent",
      amount: rent,
      received: CONTRACT_SIGNED,
      due: first,
      critical: true,
      kind: "rent",
    });
    // Hosting for the previous month's usage: 12% of recurring revenue plus a fixed base.
    const usage = addDays(first, -15);
    const seasonal =
      month.endsWith("-12") || month.endsWith("-01")
        ? 10_400
        : month.endsWith("-08")
          ? 9_700
          : 10_000;
    const hosting = bps(1_400_000 + bps(book.mrrOn(usage), 1_200), seasonal + int(r, -150, 150));
    add({
      id: `bill_hosting_${month}`,
      vendor: "Stratus Cloud hosting",
      amount: hosting,
      received: dayIn(month, 3),
      due: dayIn(month, 23),
      critical: true,
      kind: "hosting",
    });
    add({
      id: `bill_monitoring_${month}`,
      vendor: "Beacon monitoring software",
      amount: 840_000,
      received: CONTRACT_SIGNED,
      due: net(first, 15),
      critical: false,
      kind: "cogs_software",
    });
    add({
      id: `bill_workspace_${month}`,
      vendor: "Relay workspace software",
      amount: roster.headcountOn(first) * 3_800 + 120_000,
      received: CONTRACT_SIGNED,
      due: net(first, 15),
      critical: false,
      kind: "software",
    });
    add({
      id: `bill_warehouse_${month}`,
      vendor: "Quarry data warehouse software",
      amount: dollarsBetween(r, 16_000, 22_500),
      received: dayIn(month, 5),
      due: net(dayIn(month, 5), 30),
      critical: false,
      kind: "software",
    });
    const monthEnd = onOrBeforeBusinessDay(last);
    add({
      id: `bill_qa_${month}`,
      vendor: "Brightline QA contractors",
      amount: int(r, 240, 300) * 15_000,
      received: monthEnd,
      due: net(monthEnd, 15),
      critical: false,
      kind: "contractor",
    });
    add({
      id: `bill_design_${month}`,
      vendor: "Northfork design contractors",
      amount: int(r, 60, 120) * 15_000,
      received: monthEnd,
      due: net(monthEnd, 15),
      critical: false,
      kind: "contractor",
    });
    add({
      id: `bill_legal_${month}`,
      vendor: "Hale & Ward legal services",
      amount: dollarsBetween(r, 6_000, 24_000),
      received: dayIn(month, 10),
      due: net(dayIn(month, 10), 30),
      critical: false,
      kind: "services",
    });
    add({
      id: `bill_accounting_${month}`,
      vendor: "Ledgerly accounting services",
      amount: 950_000,
      received: CONTRACT_SIGNED,
      due: net(dayIn(month, 5), 30),
      critical: false,
      kind: "services",
    });
    add({
      id: `bill_agency_${month}`,
      vendor: "Signal Ridge marketing agency",
      amount: 6_500_000,
      received: CONTRACT_SIGNED,
      due: net(first, 30),
      critical: false,
      kind: "marketing",
    });
    add({
      id: `bill_enrichment_${month}`,
      vendor: "Signalbase data enrichment software",
      amount: 1_800_000,
      received: CONTRACT_SIGNED,
      due: net(first, 30),
      critical: false,
      kind: "software",
    });
    // Laptops for new starters plus a three-year refresh cycle; capitalized, never on the card.
    const starters = roster.employees.filter(
      (e) => e.hiredInSim && monthOf(e.start) === month,
    ).length;
    const refresh = Math.floor(roster.headcountOn(first) / 36);
    add({
      id: `bill_laptops_${month}`,
      vendor: "Corelink hardware equipment (capex)",
      amount: (starters + refresh) * 285_000,
      received: monthEnd,
      due: net(monthEnd, 30),
      critical: false,
      kind: "capex",
    });
    if (month >= "2026-06" && month <= "2027-01")
      add({
        id: `bill_platform_${month}`,
        vendor: "Forge Labs capitalized software development",
        amount: dollarsBetween(r, 52_000, 68_000),
        received: monthEnd,
        due: net(monthEnd, 30),
        critical: false,
        kind: "capitalized_software",
      });
    const cardIds = cards.filter((c) => monthOf(c.date) === month);
    add({
      id: `bill_card_${month}`,
      vendor: "Ramp card statement",
      amount: sum(cardIds.map((c) => c.amount)),
      received: last,
      due: dayIn(nextMonth(month), 7),
      critical: true,
      kind: "card",
      cardIds: cardIds.map((c) => c.id),
    });
    // Sales tax on taxable SaaS sales in some states, remitted quarterly through Avalara.
    if (["01", "04", "07", "10"].includes(month.slice(5))) {
      const quarterStart = firstOfMonth(monthOf(addDays(first, -80)));
      add({
        id: `bill_salestax_${month}`,
        vendor: "Avalara sales tax remittance",
        amount: bps(billings(quarterStart, addDays(first, -1)), 90),
        received: first,
        due: dayIn(month, 20),
        critical: true,
        kind: "tax",
      });
    }
  }

  const once = (draft: BillDraft) => add(draft);
  once({
    id: "bill_crm_2026",
    vendor: "Atlas CRM software",
    amount: 16_800_000,
    received: "2025-12-15",
    due: "2026-01-14",
    critical: false,
    kind: "software",
  });
  once({
    id: "bill_crm_2027",
    vendor: "Atlas CRM software",
    amount: 17_640_000,
    received: "2026-12-15",
    due: "2027-01-14",
    critical: false,
    kind: "software",
  });
  once({
    id: "bill_security_2026",
    vendor: "Vaultline security software",
    amount: 9_600_000,
    received: "2026-06-20",
    due: "2026-07-20",
    critical: false,
    kind: "software",
  });
  once({
    id: "bill_audit_2026",
    vendor: "Ledgerly accounting services",
    amount: 4_200_000,
    received: "2026-05-20",
    due: "2026-06-19",
    critical: false,
    kind: "services",
  });
  once({
    id: "bill_summit_2026",
    vendor: "Cloudscale Summit sponsorship (marketing)",
    amount: 5_800_000,
    received: "2026-08-14",
    due: "2026-09-14",
    critical: false,
    kind: "marketing",
  });
  once({
    id: "bill_insurance_2026",
    vendor: "Keystone insurance premium",
    amount: 8_400_000,
    received: "2026-06-15",
    due: "2026-07-01",
    critical: true,
    kind: "insurance",
  });
  once({
    id: "bill_proptax_2026",
    vendor: "Santa Clara County property tax",
    amount: 1_380_000,
    received: "2026-07-15",
    due: "2026-08-31",
    critical: true,
    kind: "tax",
  });
  once({
    id: "bill_network_2026",
    vendor: "Corelink hardware equipment (capex)",
    amount: 4_600_000,
    received: "2026-08-12",
    due: "2026-09-11",
    critical: false,
    kind: "capex",
  });
  for (const [index, [received, due, amount]] of spec.buildout.entries())
    once({
      id: `bill_buildout_${index + 1}`,
      vendor: "Ironwood Builders leasehold improvements (capex)",
      amount,
      received,
      due,
      critical: false,
      kind: "capex",
    });
  // One agency invoice per start date: 20% of first-year salary for each placed hire.
  const placements = new Map<string, number>();
  for (const e of roster.employees) {
    if (!e.hiredInSim || e.start < SIM_START) continue;
    if (keyed(seed, `agency:${e.id}`)() >= 0.4) continue;
    placements.set(e.start, (placements.get(e.start) ?? 0) + bps(e.salary, 2_000));
  }
  for (const [start, amount] of placements)
    once({
      id: `bill_recruit_${start}`,
      vendor: "Talentworks recruiting fees",
      amount,
      received: start,
      due: net(start, 30),
      critical: false,
      kind: "recruiting",
    });
  const loan = spec.termLoan;
  if (loan) {
    let left = loan.principal;
    for (const month of months(`${loan.amortizesFrom}-01`, end)) {
      if (left <= 0) break;
      const amount = Math.min(left, loan.monthlyPrincipal);
      left -= amount;
      once({
        id: `bill_principal_${month}`,
        vendor: `${loan.lender} term loan principal`,
        amount,
        received: CONTRACT_SIGNED,
        due: firstOfMonth(month),
        critical: true,
        kind: "principal",
      });
    }
  }
  return drafts.map((draft) => paid(seed, draft));
}
