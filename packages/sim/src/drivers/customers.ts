import {
  type Random,
  SIM_START,
  TODAY0,
  addBusinessDays,
  addDays,
  addMonthsAnchored,
  bps,
  chance,
  dayIn,
  daysBetween,
  int,
  keyed,
  months,
  mulDiv,
  onOrAfterBusinessDay,
  pick,
} from "./basics.ts";
import type { ProfileSpec } from "./profiles.ts";

/**
 * Customer drivers: segments with ARR, billing cadence and terms, per-customer payment
 * behavior, churn and expansion at renewal, and seasonal new-logo bookings. Every draw is
 * keyed by the customer or invoice identity, so profiles share outcomes except where a
 * profile driver overrides them.
 */
export type Segment = "enterprise" | "midmarket" | "smb";
type Payer = "prompt" | "standard" | "slow";

export interface GenCustomer {
  id: string;
  name: string;
  segment: Segment;
  terms: number;
  payer: Payer;
  method: "ach" | "card";
}

export interface GenPlan {
  id: string;
  customerId: string;
  amount: number;
  everyMonths: 1 | 3 | 12;
  anchor: string;
  /** First invoice of this plan (its anchor, or the first occurrence the sim generated) */
  startOn: string;
  terms: number;
  endDate?: string;
  /** When the cancellation or replacement became known to the company */
  endKnownOn?: string;
}

export interface GenInvoice {
  id: string;
  customerId: string;
  planId: string;
  amount: number;
  issued: string;
  due: string;
  method: "ach" | "card";
  /** Day the customer paid (ACH posting day, or the card charge day) */
  paidOn?: string;
  /** Gross collected; less than amount only for a short settlement */
  paidAmount?: number;
  writtenOffOn?: string;
  /** Card invoices: Stripe payout day and net amount after fees */
  payoutOn?: string;
  net?: number;
}

export interface GenDeal {
  id: string;
  customerId: string;
  amount: number;
  kind: "new_business" | "renewal";
  closeOn: string;
  /** Renewal opportunities show as open from this day */
  openFrom: string;
  outcome: "won" | "lost";
  decidedOn: string;
  invoiceId?: string;
}

export interface Booking {
  date: string;
  /** New annual recurring revenue booked (new logo or expansion), cents */
  arr: number;
}

export interface Book {
  customers: GenCustomer[];
  plans: GenPlan[];
  invoices: GenInvoice[];
  deals: GenDeal[];
  bookings: Booking[];
  /** Monthly recurring revenue in force on a day, cents */
  mrrOn: (date: string) => number;
}

const SEGMENT_LETTER: Record<Segment, string> = { enterprise: "e", midmarket: "m", smb: "s" };
const INITIAL = { enterprise: 15, midmarket: 60, smb: 105 } as const;
/** Expected new logos per month at plan, before seasonality */
const NEW_PER_MONTH = { enterprise: 0.45, midmarket: 1.9, smb: 3.4 } as const;
const MONTH_IN_QUARTER = [0.8, 0.9, 1.35];
const SMB_PRICES = [29_900, 49_900, 79_900, 119_900, 149_900];
/** Expansion and late-payment windows apply only inside this span of contract history */
const HISTORY_FROM = "2023-11-03";

const NAME_A = [
  "Ardent",
  "Bluefin",
  "Cedar",
  "Driftwood",
  "Ember",
  "Fathom",
  "Granite",
  "Harbor",
  "Iris",
  "Juniper",
  "Kinetic",
  "Lumen",
  "Meridian",
  "Northstar",
  "Orchard",
  "Pioneer",
  "Quill",
  "Redwood",
  "Summit",
  "Tidal",
  "Upland",
  "Vista",
  "Willow",
  "Yellowtail",
  "Zephyr",
  "Aspen",
  "Beacon",
  "Copper",
  "Delta",
  "Evergreen",
];
const NAME_B = [
  "Analytics",
  "Logistics",
  "Health",
  "Retail",
  "Foods",
  "Labs",
  "Robotics",
  "Insurance",
  "Energy",
  "Media",
  "Systems",
  "Outfitters",
  "Biotech",
  "Freight",
  "Studios",
  "Networks",
  "Markets",
  "Clinics",
  "Mobility",
  "Supply",
];
const NAME_C = ["Inc", "Co", "Group", "LLC", "Partners", "Holdings"];

function nameFor(random: Random, taken: Set<string>): string {
  for (;;) {
    const name = `${pick(random, NAME_A)} ${pick(random, NAME_B)} ${pick(random, NAME_C)}`;
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
}

/** A start date, weighted toward the last month of each quarter (sales seasonality). */
function seasonalDate(random: Random, from: string, to: string): string {
  for (;;) {
    const day = addDays(from, int(random, 0, daysBetween(from, to)));
    const month = Number(day.slice(5, 7));
    const weight = MONTH_IN_QUARTER[(month - 1) % 3]!;
    if (random() * 1.35 < weight) return day;
  }
}

interface Contract {
  customer: GenCustomer;
  amount: number;
  everyMonths: 1 | 3 | 12;
  anchor: string;
  /** New logos start inside the sim; the initial book started before it */
  isNew: boolean;
}

function draft(
  seed: number,
  id: string,
  segment: Segment,
  names: Set<string>,
  start?: string,
): Contract {
  const r = keyed(seed, `customer:${id}`);
  const payerDraw = r();
  const payer: Payer = payerDraw < 0.3 ? "prompt" : payerDraw < 0.85 ? "standard" : "slow";
  const name = nameFor(r, names);
  if (segment === "smb") {
    const price = pick(r, SMB_PRICES);
    const anchor = start ?? addDays(SIM_START, -int(r, 1, 700));
    return {
      customer: { id, name, segment, terms: 0, payer, method: "card" },
      amount: price,
      everyMonths: 1,
      anchor,
      isNew: start !== undefined,
    };
  }
  const billing = r();
  const enterprise = segment === "enterprise";
  const everyMonths: 1 | 3 | 12 = enterprise
    ? billing < 0.8
      ? 12
      : 3
    : billing < 0.7
      ? 12
      : billing < 0.85
        ? 3
        : 1;
  const terms = enterprise
    ? chance(r, 0.4)
      ? 45
      : 60
    : everyMonths === 1 || chance(r, 0.55)
      ? 30
      : 45;
  // Enterprise ARR in whole $1,000s, mid-market in whole $100s (monthly plans in whole dollars).
  const arr = enterprise ? int(r, 240, 820) * 100_000 : int(r, 300, 1_500) * 10_000;
  const amount = everyMonths === 1 ? int(r, 25, 125) * 10_000 : (arr * everyMonths) / 12;
  const anchor = start ?? seasonalDate(r, HISTORY_FROM, addDays(SIM_START, -1));
  return {
    customer: { id, name, segment, terms, payer, method: "ach" },
    amount,
    everyMonths,
    anchor,
    isNew: start !== undefined,
  };
}

function halcyon(names: Set<string>): Contract {
  names.add("Halcyon Freight");
  return {
    customer: {
      id: "cus_halcyon",
      name: "Halcyon Freight",
      segment: "enterprise",
      terms: 60,
      payer: "standard",
      method: "ach",
    },
    amount: 28_500_000,
    everyMonths: 3,
    anchor: "2023-11-16",
    isNew: false,
  };
}

function contracts(seed: number, spec: ProfileSpec, end: string): Contract[] {
  const names = new Set<string>();
  const out: Contract[] = [halcyon(names)];
  for (const segment of ["enterprise", "midmarket", "smb"] as const)
    for (let i = 1; i <= INITIAL[segment]; i++)
      out.push(
        draft(seed, `cus_${SEGMENT_LETTER[segment]}${String(i).padStart(3, "0")}`, segment, names),
      );
  for (const month of months(SIM_START, end)) {
    const position = (Number(month.slice(5, 7)) - 1) % 3;
    const quarter = Math.floor((Number(month.slice(5, 7)) - 1) / 3);
    for (const segment of ["enterprise", "midmarket", "smb"] as const) {
      const seasonal =
        segment === "smb" ? 1 : MONTH_IN_QUARTER[position]! * (quarter === 3 ? 1.15 : 1);
      const bookings = month >= "2026-03" ? spec.bookingsBps / 10_000 : 1;
      const expected = NEW_PER_MONTH[segment] * seasonal * bookings;
      // Fixed candidate slots with keyed draws: a weaker profile's new logos are a subset.
      const slots = 8;
      for (let slot = 0; slot < slots; slot++) {
        const r = keyed(seed, `new:${segment}:${month}:${slot}`);
        if (r() >= expected / slots) continue;
        const start = dayIn(month, int(r, 1, 28));
        if (start < SIM_START || start > end) continue;
        const id = `cus_${SEGMENT_LETTER[segment]}${month.replace("-", "").slice(2)}${slot}`;
        out.push(draft(seed, id, segment, names, start));
      }
    }
  }
  return out;
}

const payerOnTime: Record<Payer, number> = { prompt: 0.85, standard: 0.45, slow: 0.1 };
const payerLate: Record<Segment, Record<Payer, [number, number]>> = {
  enterprise: { prompt: [1, 6], standard: [5, 30], slow: [15, 45] },
  midmarket: { prompt: [1, 5], standard: [3, 20], slow: [10, 35] },
  smb: { prompt: [1, 3], standard: [1, 5], slow: [2, 8] },
};

function achPayment(
  seed: number,
  customer: GenCustomer,
  invoice: GenInvoice,
  lateDays?: [number, number],
) {
  const r = keyed(seed, `pay:${invoice.id}`);
  const enterprise = customer.segment === "enterprise" ? 0.1 : 0;
  const onTime = chance(r, payerOnTime[customer.payer] - enterprise);
  const [low, high] = payerLate[customer.segment][customer.payer];
  const offset = onTime ? -int(r, 0, 3) : int(r, low, high);
  const late = keyed(seed, `late:${invoice.id}`);
  const days = lateDays ? int(late, lateDays[0], lateDays[1]) : offset;
  const paid = onOrAfterBusinessDay(addDays(invoice.due, days));
  invoice.paidOn = paid > invoice.issued ? paid : onOrAfterBusinessDay(addDays(invoice.issued, 1));
  invoice.paidAmount = invoice.amount;
}

/** Stripe card: 2.9% + 30 cents per charge, paid out two business days later. */
export const stripeNet = (gross: number) => gross - bps(gross, 290) - 30;

function cardPayment(seed: number, invoice: GenInvoice): boolean {
  const r = keyed(seed, `pay:${invoice.id}`);
  const draw = r();
  if (draw < 0.012) {
    // Dunning gives up after 14 days of failed retries; the subscription is cancelled.
    invoice.writtenOffOn = addDays(invoice.issued, 14);
    return false;
  }
  const charged = draw < 0.07 ? addDays(invoice.issued, int(r, 2, 6)) : invoice.issued;
  invoice.paidOn = charged;
  invoice.paidAmount = invoice.amount;
  invoice.payoutOn = addBusinessDays(charged, 2);
  invoice.net = stripeNet(invoice.amount);
  return true;
}

/** Expansion at renewal: 10-30% for enterprise, 8-20% mid-market; amounts in whole $100. */
function expanded(r: Random, contract: Contract, amount: number): number {
  const pct = contract.customer.segment === "enterprise" ? int(r, 10, 30) : int(r, 8, 20);
  const raw = amount + Math.floor((amount * pct) / 100);
  const unit = contract.everyMonths === 3 ? 2_500 : 10_000;
  return Math.round(raw / unit) * unit;
}

/** The replacement plan at a new price: same cadence anchor, open-ended, starting `startOn`. */
function successor(plan: GenPlan, id: string, amount: number, startOn: string): GenPlan {
  const {
    id: _id,
    amount: _amount,
    startOn: _start,
    endDate: _end,
    endKnownOn: _known,
    ...rest
  } = plan;
  return { ...rest, id, amount, startOn };
}

interface Walk {
  seed: number;
  spec: ProfileSpec;
  end: string;
  book: Book;
}

function issue(walk: Walk, contract: Contract, plan: GenPlan, issued: string): GenInvoice {
  const { customer } = contract;
  const invoice: GenInvoice = {
    id: `inv_${customer.id}_${issued}`,
    customerId: customer.id,
    planId: plan.id,
    amount: plan.amount,
    issued,
    due: addDays(issued, plan.terms),
    method: customer.method,
  };
  walk.book.invoices.push(invoice);
  return invoice;
}

/** Annual and quarterly contracts: invoices on cadence, decisions 30 days before each anniversary. */
function walkTermContract(walk: Walk, contract: Contract) {
  const { seed, spec, end, book } = walk;
  const { customer } = contract;
  const notice = customer.id === "cus_halcyon" ? spec.topCustomerLeaves?.noticeOn : undefined;
  let plan: GenPlan = {
    id: `plan_${customer.id}`,
    customerId: customer.id,
    amount: contract.amount,
    everyMonths: contract.everyMonths,
    anchor: contract.anchor,
    startOn: contract.anchor,
    terms: customer.terms,
  };
  book.plans.push(plan);
  const from = contract.isNew ? contract.anchor : addDays(SIM_START, -130);
  for (let n = 0; ; n++) {
    const issued = addMonthsAnchored(contract.anchor, n * contract.everyMonths);
    if (issued > end) return;
    if (issued < from) continue;
    const anniversary = n > 0 && (n * contract.everyMonths) % 12 === 0;
    if (anniversary && issued > SIM_START) {
      // The top customer leaves at the first anniversary after its notice.
      const leaving = notice !== undefined && issued > notice && addDays(issued, -365) <= notice;
      const r = keyed(seed, `renewal:${customer.id}:${issued}`);
      const decidedOn = addDays(issued, -30);
      const churnRate = customer.segment === "enterprise" ? 0.06 : 0.1;
      const churns = leaving ? true : customer.id === "cus_halcyon" ? false : chance(r, churnRate);
      const expandRate = customer.segment === "enterprise" ? 0.35 : 0.25;
      const grows = !churns && customer.id !== "cus_halcyon" && chance(r, expandRate);
      const dealId = `deal_ren_${customer.id}_${issued}`;
      if (churns) {
        plan.endDate = addDays(issued, -1);
        plan.endKnownOn = leaving ? notice : decidedOn;
        if (contract.everyMonths === 12 || leaving)
          book.deals.push({
            id: dealId,
            customerId: customer.id,
            amount: plan.amount,
            kind: "renewal",
            closeOn: issued,
            openFrom: addDays(issued, -90),
            outcome: "lost",
            decidedOn: plan.endKnownOn,
          });
        return;
      }
      if (grows) {
        const amount = expanded(r, contract, plan.amount);
        book.bookings.push({ date: issued, arr: ((amount - plan.amount) * 12) / plan.everyMonths });
        plan.endDate = addDays(issued, -1);
        plan.endKnownOn = decidedOn;
        plan = successor(plan, `plan_${customer.id}_${issued}`, amount, issued);
        book.plans.push(plan);
      }
      const invoice = issue(walk, contract, plan, issued);
      if (contract.everyMonths === 12)
        book.deals.push({
          id: dealId,
          customerId: customer.id,
          amount: invoice.amount,
          kind: "renewal",
          closeOn: issued,
          openFrom: addDays(issued, -90),
          outcome: "won",
          decidedOn: issued,
          invoiceId: invoice.id,
        });
      settle(walk, contract, invoice);
      continue;
    }
    settle(walk, contract, issue(walk, contract, plan, issued));
  }
}

function settle(walk: Walk, contract: Contract, invoice: GenInvoice) {
  const { spec, seed } = walk;
  const leave = spec.topCustomerLeaves;
  if (leave && invoice.customerId === "cus_halcyon" && invoice.issued === "2026-08-16") {
    invoice.paidOn = leave.settleOn;
    invoice.paidAmount = bps(invoice.amount, leave.settleBps);
    return;
  }
  achPayment(seed, contract.customer, invoice);
}

/**
 * The largest ACH payers by amount billed from `issuedFrom` to the creation date pay those
 * invoices 30-60 days after the due date. Chosen by billing, not ARR, so the cohort always
 * has invoices in the observed window.
 */
function payMajorsLate(seed: number, spec: ProfileSpec, book: Book) {
  const late = spec.majorsPayLate;
  if (!late) return;
  const billed = new Map<string, number>();
  for (const i of book.invoices)
    if (i.method === "ach" && i.issued >= late.issuedFrom && i.issued <= TODAY0)
      billed.set(i.customerId, (billed.get(i.customerId) ?? 0) + i.amount);
  const majors = new Set(
    [...billed]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, late.count)
      .map(([id]) => id),
  );
  const customers = new Map(book.customers.map((c) => [c.id, c]));
  for (const invoice of book.invoices)
    if (majors.has(invoice.customerId) && invoice.issued >= late.issuedFrom)
      achPayment(seed, customers.get(invoice.customerId)!, invoice, late.lateDays);
}

/** Monthly contracts: churn and upgrades checked at each billing date. */
function walkMonthlyContract(walk: Walk, contract: Contract) {
  const { seed, end, book } = walk;
  const { customer } = contract;
  let plan: GenPlan = {
    id: `plan_${customer.id}`,
    customerId: customer.id,
    amount: contract.amount,
    everyMonths: 1,
    anchor: contract.anchor,
    startOn: contract.anchor,
    terms: customer.terms,
  };
  book.plans.push(plan);
  const from = contract.isNew ? contract.anchor : addDays(SIM_START, -45);
  for (let n = 0; ; n++) {
    const issued = addMonthsAnchored(contract.anchor, n);
    if (issued > end) return;
    if (issued < from) continue;
    if (n > 0 && issued > SIM_START) {
      const r = keyed(seed, `month:${customer.id}:${issued}`);
      if (chance(r, customer.segment === "smb" ? 0.017 : 0.008)) {
        plan.endDate = addDays(issued, -1);
        plan.endKnownOn = addDays(issued, -10);
        return;
      }
      if (customer.segment === "smb" && chance(r, 0.012)) {
        const tier = SMB_PRICES.indexOf(plan.amount);
        if (tier >= 0 && tier < SMB_PRICES.length - 1) {
          const amount = SMB_PRICES[tier + 1]!;
          book.bookings.push({ date: issued, arr: (amount - plan.amount) * 12 });
          plan.endDate = addDays(issued, -1);
          plan.endKnownOn = addDays(issued, -1);
          plan = successor(plan, `plan_${customer.id}_${issued}`, amount, issued);
          book.plans.push(plan);
        }
      }
    }
    const invoice = issue(walk, contract, plan, issued);
    if (customer.method === "card") {
      if (!cardPayment(seed, invoice)) {
        plan.endDate = invoice.writtenOffOn!;
        plan.endKnownOn = invoice.writtenOffOn!;
        return;
      }
    } else achPayment(seed, customer, invoice);
  }
}

export function generateBook(seed: number, spec: ProfileSpec, end: string): Book {
  const all = contracts(seed, spec, end);
  const book: Book = {
    customers: all.map((c) => c.customer),
    plans: [],
    invoices: [],
    deals: [],
    bookings: [],
    mrrOn: () => 0,
  };
  const walk: Walk = { seed, spec, end, book };
  for (const contract of all) {
    if (contract.isNew) {
      book.bookings.push({
        date: contract.anchor,
        arr: (contract.amount * 12) / contract.everyMonths,
      });
    }
    if (contract.everyMonths === 1) walkMonthlyContract(walk, contract);
    else walkTermContract(walk, contract);
    if (contract.isNew && contract.everyMonths === 12) {
      const first = book.invoices.find(
        (i) => i.customerId === contract.customer.id && i.issued === contract.anchor,
      );
      if (first)
        book.deals.push({
          id: `deal_new_${contract.customer.id}`,
          customerId: contract.customer.id,
          amount: first.amount,
          kind: "new_business",
          closeOn: contract.anchor,
          openFrom: contract.anchor,
          outcome: "won",
          decidedOn: contract.anchor,
          invoiceId: first.id,
        });
    }
  }
  payMajorsLate(seed, spec, book);
  const plans = book.plans;
  book.mrrOn = (date) => {
    let total = 0;
    for (const plan of plans) {
      if (plan.startOn > date || (plan.endDate !== undefined && plan.endDate < date)) continue;
      // Initial-book plans started before the sim; count them from their anchor.
      total += mulDiv(plan.amount, 1, plan.everyMonths);
    }
    return total;
  };
  return book;
}
