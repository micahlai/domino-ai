import type {
  BankTxn,
  Bill,
  CardTxn,
  CompanyProfile,
  Customer,
  Deal,
  Invoice,
  PayrollRun,
  Snapshot,
  WorldState,
} from "@domino/contracts";
import { fixtures } from "@domino/contracts/fixtures";

const TODAY = "2026-10-30";
const FIRST_MONDAY = "2026-05-04";
const DAY_MS = 86_400_000;
const ENDING_CASH = 450_000_000;
const RESTRICTED_CASH = 60_000_000;

type Random = () => number;

function rng(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function drawInt(random: Random, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}

function customers(): Customer[] {
  const named = fixtures.snapshot.customers.map((customer) => ({ ...customer }));
  const generated = Array.from({ length: 296 }, (_, index) => ({
    id: `cus_${String(index + 5).padStart(3, "0")}`,
    name: `Kestrel Customer ${String(index + 5).padStart(3, "0")}`,
    paymentTermsDays: (index + 5) % 10 === 0 ? 60 : 30,
  }));
  return [...named, ...generated];
}

interface HistoryRecords {
  invoices: Invoice[];
  bankTxns: BankTxn[];
  bills: Bill[];
  cardTxns: CardTxn[];
  payroll: PayrollRun[];
}

function emptyHistory(): HistoryRecords {
  return { invoices: [], bankTxns: [], bills: [], cardTxns: [], payroll: [] };
}

function addPaidInvoice(history: HistoryRecords, invoice: Invoice, delay: number, random: Random) {
  const paid = addDays(invoice.due, delay);
  const payoutDate = addDays(paid, drawInt(random, 1, 3));
  if (payoutDate > TODAY) throw new Error(`historical payout after asOf: ${invoice.id}`);
  history.invoices.push({ ...invoice, paid });
  // The canonical bank receipt is net of a synthetic 2.9% processing fee.
  history.bankTxns.push({
    id: `bank_${invoice.id}`,
    date: payoutDate,
    amount: invoice.amount - Math.round((invoice.amount * 29) / 1000),
    description: `STRIPE PAYOUT ${invoice.id} NET FEES`,
    counterparty: "Stripe",
  });
}

function addAcmeInvoices(history: HistoryRecords, random: Random) {
  for (const [quarter, due] of ["2026-05-20", "2026-07-20", "2026-09-20"].entries()) {
    addPaidInvoice(
      history,
      {
        id: `inv_acme_hist_${quarter + 1}`,
        customerId: "cus_acme",
        amount: 24_000_000,
        issued: addDays(due, -30),
        due,
      },
      drawInt(random, 18, 24),
      random,
    );
  }
}

function addAnnualInvoice(history: HistoryRecords, customer: Customer, random: Random) {
  // About half the annual cohort renews in this window; quarter ends dominate.
  const dues = [
    "2026-05-28",
    "2026-06-25",
    "2026-06-30",
    "2026-06-30",
    "2026-07-30",
    "2026-08-28",
    "2026-09-25",
    "2026-09-30",
    "2026-09-30",
    "2026-10-09",
  ];
  const due = dues[drawInt(random, 0, dues.length - 1)]!;
  addPaidInvoice(
    history,
    {
      id: `inv_${customer.id}_annual`,
      customerId: customer.id,
      amount: drawInt(random, 6_000_000, 10_000_000),
      issued: addDays(due, -customer.paymentTermsDays),
      due,
    },
    drawInt(random, 0, 10),
    random,
  );
}

function addMonthlyInvoices(history: HistoryRecords, customer: Customer, random: Random) {
  const dues = ["2026-05-15", "2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15", "2026-10-05"];
  for (const [month, due] of dues.entries()) {
    addPaidInvoice(
      history,
      {
        id: `inv_${customer.id}_m${month + 1}`,
        customerId: customer.id,
        amount: drawInt(random, 400_000, 700_000),
        issued: addDays(due, -customer.paymentTermsDays),
        due,
      },
      drawInt(random, 0, 10),
      random,
    );
  }
}

function addInvoiceHistory(history: HistoryRecords, people: Customer[], random: Random) {
  for (const [index, customer] of people.entries()) {
    if (customer.id === "cus_acme") {
      addAcmeInvoices(history, random);
      continue;
    }
    // Roughly 80% annual up front, 20% monthly, with Acme quarterly.
    const annual =
      customer.id === "cus_northwind" ||
      customer.id === "cus_cobalt" ||
      (customer.id !== "cus_brightpath" && index % 5 !== 0);
    if (annual && (index < 4 || index % 2 === 0)) addAnnualInvoice(history, customer, random);
    if (!annual) addMonthlyInvoices(history, customer, random);
  }
}

function addPaidBill(
  history: HistoryRecords,
  id: string,
  vendor: string,
  amount: number,
  date: string,
  critical: boolean,
) {
  history.bills.push({ id, vendor, amount, due: date, paid: date, critical });
  history.bankTxns.push({
    id: `bank_${id}`,
    date,
    amount: -amount,
    description: `BILL ${id}`,
    counterparty: vendor,
  });
}

function addWeeklyOperations(history: HistoryRecords) {
  for (let week = 0; week < 26; week++) {
    addPaidBill(
      history,
      `bill_ops_${String(week).padStart(2, "0")}`,
      "Operations vendors",
      3_500_000,
      addDays(FIRST_MONDAY, week * 7),
      false,
    );
  }
}

function addPayroll(history: HistoryRecords) {
  for (let run = 0; run < 13; run++) {
    const date = addDays("2026-05-08", run * 14);
    const id = `pay_${String(run).padStart(2, "0")}`;
    history.payroll.push({ id, date, amount: 60_000_000 });
    history.bankTxns.push({
      id: `bank_${id}`,
      date,
      amount: -60_000_000,
      description: `GUSTO PAYROLL ${id}`,
      counterparty: "Gusto",
    });
  }
}

function addMonthlySpend(history: HistoryRecords) {
  const dates = [
    "2026-05-25",
    "2026-06-25",
    "2026-07-25",
    "2026-08-25",
    "2026-09-25",
    "2026-10-25",
  ];
  for (const [month, date] of dates.entries()) {
    const id = `card_${month + 1}`;
    history.cardTxns.push({
      id,
      date,
      amount: 3_800_000,
      merchant: "SOFTWARE VENDORS",
      category: "Software",
    });
    history.bankTxns.push({
      id: `bank_${id}`,
      date,
      amount: -3_800_000,
      description: `CARD SETTLEMENT ${id}`,
      counterparty: "Card issuer",
    });
    addPaidBill(
      history,
      `bill_rent_${month + 1}`,
      "Office landlord",
      6_200_000,
      addDays(date, -15),
      true,
    );
  }
}

function addOutflows(history: HistoryRecords) {
  addWeeklyOperations(history);
  addPayroll(history);
  addMonthlySpend(history);
  for (const [quarter, date] of ["2026-06-30", "2026-09-30"].entries()) {
    addPaidBill(history, `bill_cloud_${quarter + 1}`, "Cloud provider", 21_000_000, date, true);
  }
}

export function createCompany(profile: CompanyProfile, seed: number): WorldState {
  if (profile !== "kestrel") throw new Error(`sim.${profile} is not built yet`);
  if (!Number.isSafeInteger(seed)) throw new Error("seed must be a safe integer");
  const random = rng(seed);
  const people = customers();
  const history = emptyHistory();
  addInvoiceHistory(history, people, random);
  addOutflows(history);
  const pendingInvoices = fixtures.snapshot.invoices.map((invoice) => ({
    ...invoice,
    issued: invoice.issued > TODAY ? TODAY : invoice.issued,
  }));
  const snapshot: Snapshot = {
    companyId: "kestrel",
    asOf: TODAY,
    cashOnHand: ENDING_CASH,
    restrictedCash: RESTRICTED_CASH,
    customers: people,
    invoices: [...history.invoices, ...pendingInvoices],
    bankTxns: history.bankTxns.sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    ),
    bills: [...history.bills, ...fixtures.snapshot.bills.map((bill) => ({ ...bill }))],
    cardTxns: history.cardTxns,
    payroll: [...history.payroll, ...fixtures.snapshot.payroll.map((run) => ({ ...run }))],
    deals: fixtures.snapshot.deals.map((deal): Deal => ({ ...deal })),
  };
  return {
    companyId: "kestrel",
    profile,
    seed,
    week: 25,
    today: TODAY,
    snapshot,
    pendingEvents: [
      {
        week: 26,
        label: "Northwind renewal is at risk",
        change: { kind: "lose_invoice", invoiceId: "inv_nw_q4" },
      },
      {
        week: 29,
        label: "Acme payment may arrive late",
        change: { kind: "delay_invoice", invoiceId: "inv_acme_2027", days: 45 },
      },
    ],
  };
}
