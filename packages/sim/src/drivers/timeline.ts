import type { BankTxn } from "@domino/contracts";
import {
  SIM_START,
  WINDOW_START,
  addDays,
  dayIn,
  dayOfMonth,
  firstOfMonth,
  isBusinessDay,
  monthOf,
  mulDiv,
  nextMonth,
  onOrAfterBusinessDay,
  onOrBeforeBusinessDay,
  weekday,
} from "./basics.ts";
import { type Book, type GenInvoice, generateBook } from "./customers.ts";
import { type Roster, generateRoster } from "./payroll.ts";
import type { ProfileSpec } from "./profiles.ts";
import { type GenBill, type GenCard, generateBills, generateCards } from "./suppliers.ts";

/**
 * The whole company as one causal day-by-day simulation from SIM_START to `end`. Cash moves
 * only when money actually moves: customer ACH and Stripe payouts, Gusto debits, bill
 * payments, card statement settlements, interest, credit line draws and repayments, and
 * equity wires. A record dated d depends only on days up to d, so a later `end` never changes
 * an earlier record and every weekly cut of the same seed agrees with the last one.
 */
export interface Timeline {
  spec: ProfileSpec;
  seed: number;
  end: string;
  book: Book;
  roster: Roster;
  cards: GenCard[];
  bills: GenBill[];
  /** Every bank posting from SIM_START to end, sorted by date then id */
  bankTxns: BankTxn[];
  /** Closing bank balance per day, lease collateral included */
  balances: Map<string, number>;
  /** Credit line drawn balance at each day's close */
  drawn: Map<string, number>;
  /** Bank balance at the start of WINDOW_START: the first observed week opens here */
  openingCash: number;
}

type Posting = BankTxn & { treasury?: false };

const dueDay = (bill: GenBill) => bill.payOn;

function billDescription(bill: GenBill): string {
  switch (bill.kind) {
    case "card":
      return `RAMP CARD SETTLEMENT ${bill.id} card settlement for ${(bill.cardIds ?? []).join(" ")}`;
    case "tax":
      return `TAX PAYMENT ${bill.id} ${bill.vendor}`;
    case "interest":
      return `LOAN INTEREST ${bill.id} ${bill.vendor}`;
    case "principal":
      return `LOAN PRINCIPAL ${bill.id} ${bill.vendor}`;
    case "rent":
      return `ACH DEBIT ${bill.id} ${bill.vendor}`;
    default:
      return `ACH DEBIT ${bill.id} ${bill.vendor} supplier payment`;
  }
}

function scheduledPostings(
  book: Book,
  roster: Roster,
  bills: GenBill[],
  spec: ProfileSpec,
): Map<string, Posting[]> {
  const byDay = new Map<string, Posting[]>();
  const add = (posting: Posting) => {
    const list = byDay.get(posting.date) ?? [];
    list.push(posting);
    byDay.set(posting.date, list);
  };
  const names = new Map(book.customers.map((c) => [c.id, c.name]));
  // One ACH credit per customer per day, naming every invoice it pays.
  const ach = new Map<string, GenInvoice[]>();
  const stripe = new Map<string, GenInvoice[]>();
  for (const invoice of book.invoices) {
    if (!invoice.paidOn || invoice.paidOn < SIM_START) continue;
    if (invoice.method === "card") {
      const list = stripe.get(invoice.payoutOn!) ?? [];
      list.push(invoice);
      stripe.set(invoice.payoutOn!, list);
    } else {
      const key = `${invoice.paidOn}|${invoice.customerId}`;
      const list = ach.get(key) ?? [];
      list.push(invoice);
      ach.set(key, list);
    }
  }
  for (const [key, invoices] of ach) {
    const [date, customerId] = key.split("|") as [string, string];
    const name = names.get(customerId) ?? customerId;
    add({
      id: `bank_ach_${customerId}_${date}`,
      date,
      amount: invoices.reduce((s, i) => s + (i.paidAmount ?? 0), 0),
      description: `ACH CREDIT customer payment ${invoices.map((i) => i.id).join(" ")} ${name}`,
      counterparty: name,
    });
  }
  // Card charges settle two business days later; Stripe pays out each day's available funds as one deposit.
  for (const [payoutOn, invoices] of stripe) {
    add({
      id: `bank_po_${payoutOn}`,
      date: payoutOn,
      amount: invoices.reduce((s, i) => s + (i.net ?? 0), 0),
      description: `STRIPE PAYOUT po_${payoutOn} ${invoices.map((i) => i.id).join(" ")}`,
      counterparty: "Stripe",
    });
  }
  for (const run of roster.runs) {
    add({
      id: `bank_${run.id}_net`,
      date: run.date,
      amount: -run.netPay,
      description: `GUSTO PAYROLL NET PAY ${run.id}`,
      counterparty: "Gusto",
    });
    add({
      id: `bank_${run.id}_tax`,
      date: run.date,
      amount: -(run.amount - run.netPay),
      description: `GUSTO PAYROLL TAXES AND BENEFITS ${run.id}`,
      counterparty: "Gusto",
    });
  }
  for (const bill of bills) addBill(add, bill);
  for (const raise of spec.equity)
    add({
      id: `bank_eq_${raise.date}`,
      date: raise.date,
      amount: raise.amount,
      description: `WIRE IN equity ${raise.label} eq_${raise.date}`,
      counterparty: "Series B investors",
    });
  return byDay;
}

function addBill(add: (posting: Posting) => void, bill: GenBill) {
  if (bill.payOn < SIM_START) return;
  add({
    id: `bank_${bill.id}`,
    date: dueDay(bill),
    amount: -bill.amount,
    description: billDescription(bill),
    counterparty: bill.vendor,
  });
}

/** Accrued cents x basis points x days, over 10,000 x 365, rounded half up once. */
const yearFraction = (accrual: bigint) => Number((accrual + 1_825_000n) / 3_650_000n);

const STEP = 25_000_000;
const roundUp = (amount: number) => Math.ceil(amount / STEP) * STEP;
const roundDown = (amount: number) => Math.floor(amount / STEP) * STEP;

/** Open receivables at most 90 days past due, the lender's eligible collateral. */
function eligibleReceivables(book: Book, day: string): number {
  const cutoff = addDays(day, -90);
  let total = 0;
  for (const invoice of book.invoices) {
    if (invoice.issued > day || invoice.due < cutoff) continue;
    if (
      (invoice.paidOn && invoice.paidOn <= day) ||
      (invoice.writtenOffOn && invoice.writtenOffOn <= day)
    )
      continue;
    total += invoice.amount;
  }
  return total;
}

export function generateTimeline(spec: ProfileSpec, seed: number, end: string): Timeline {
  const book = generateBook(seed, spec, end);
  const roster = generateRoster(seed, spec, book.bookings, end);
  const cards = generateCards(seed, SIM_START, end);
  const bills = generateBills(seed, spec, book, roster, cards, end);
  const byDay = scheduledPostings(book, roster, bills, spec);
  const billByPosting = new Map(bills.map((b) => [`bank_${b.id}`, b]));
  const posted: BankTxn[] = [];
  const balances = new Map<string, number>();
  const drawnOn = new Map<string, number>();
  const { revolver, termLoan } = spec;
  let balance = spec.startCash;
  let drawn = revolver.drawn;
  let principal = termLoan?.principal ?? 0;
  // Interest accrues as exact numerators of cents x basis points x days; divided once per bill.
  let revolverAccrual = 0n;
  let feeAccrual = 0n;
  let loanAccrual = 0n;
  let depositAccrual = 0n;
  let openingCash = balance;
  const post = (txn: BankTxn) => {
    posted.push(txn);
    balance += txn.amount;
  };

  for (let day = SIM_START; day <= end; day = addDays(day, 1)) {
    if (day === WINDOW_START) openingCash = balance;
    if (weekday(day) === 1 && isBusinessDay(day)) {
      let outflows = 0;
      for (let k = 0; k < 7; k++)
        for (const p of byDay.get(addDays(day, k)) ?? []) if (p.amount < 0) outflows -= p.amount;
      const projected = balance - spec.restrictedCash - outflows;
      const base = Math.min(
        revolver.limit,
        mulDiv(eligibleReceivables(book, day), revolver.advanceBps, 10_000),
      );
      const available = Math.max(0, roundDown(base - drawn));
      if (projected < revolver.floor && available > 0) {
        const draw = Math.min(available, roundUp(revolver.floor - projected));
        drawn += draw;
        post({
          id: `bank_rev_draw_${day}`,
          date: day,
          amount: draw,
          description: `CREDIT LINE DRAWDOWN rev_draw_${day} ${revolver.lender}`,
          counterparty: revolver.lender,
        });
      } else if (projected > revolver.ceiling && drawn > 0) {
        const repay = Math.min(drawn, roundDown(projected - revolver.ceiling));
        if (repay > 0) {
          drawn -= repay;
          post({
            id: `bank_rev_repay_${day}`,
            date: day,
            amount: -repay,
            description: `CREDIT LINE REPAYMENT rev_repay_${day} ${revolver.lender}`,
            counterparty: revolver.lender,
          });
        }
      }
    }
    // Inflows first, then outflows; a non-critical bill that would overdraw the operating
    // account is held a week (payables stretched), the way a company short of cash triages.
    const today = (byDay.get(day) ?? []).sort(
      (a, b) => Number(a.amount < 0) - Number(b.amount < 0) || a.id.localeCompare(b.id),
    );
    for (const posting of today) {
      const bill = billByPosting.get(posting.id);
      if (bill && !bill.critical && balance + posting.amount < spec.restrictedCash) {
        bill.payOn = onOrAfterBusinessDay(addDays(day, 7));
        const moved = { ...posting, date: bill.payOn };
        byDay.set(bill.payOn, [...(byDay.get(bill.payOn) ?? []), moved]);
        continue;
      }
      post(posting);
      if (posting.id.startsWith("bank_bill_principal_")) principal += posting.amount;
    }
    revolverAccrual += BigInt(drawn) * BigInt(revolver.rateBps);
    feeAccrual += BigInt(revolver.limit - drawn) * BigInt(revolver.unusedBps);
    if (termLoan) loanAccrual += BigInt(principal) * BigInt(termLoan.rateBps);
    if (balance > 0) depositAccrual += BigInt(balance) * 360n;
    const month = monthOf(day);
    if (dayOfMonth(day) === 25) {
      // The lender bills the period ending the 25th; it auto-debits on the 1st.
      const due = firstOfMonth(nextMonth(month));
      const interestBills: GenBill[] = [
        {
          id: `bill_lineinterest_${month}`,
          vendor: `${revolver.lender} credit line interest`,
          amount: yearFraction(revolverAccrual),
          received: day,
          due,
          payOn: onOrBeforeBusinessDay(due),
          critical: true,
          kind: "interest",
        },
      ];
      if (termLoan && loanAccrual > 0n)
        interestBills.push({
          id: `bill_loaninterest_${month}`,
          vendor: `${termLoan.lender} term loan interest`,
          amount: yearFraction(loanAccrual),
          received: day,
          due,
          payOn: onOrBeforeBusinessDay(due),
          critical: true,
          kind: "interest",
        });
      // The unused-commitment fee is billed quarterly, so interest bills track the drawn balance.
      if (["03", "06", "09", "12"].includes(month.slice(5))) {
        interestBills.push({
          id: `bill_linefee_${month}`,
          vendor: `${revolver.lender} unused line fee (interest expense)`,
          amount: yearFraction(feeAccrual),
          received: day,
          due,
          payOn: onOrBeforeBusinessDay(due),
          critical: true,
          kind: "interest",
        });
        feeAccrual = 0n;
      }
      revolverAccrual = 0n;
      loanAccrual = 0n;
      for (const bill of interestBills) {
        if (bill.amount <= 0) continue;
        bills.push(bill);
        addBill((p) => byDay.set(p.date, [...(byDay.get(p.date) ?? []), p]), bill);
      }
    }
    if (isBusinessDay(day) && onOrBeforeBusinessDay(dayIn(month, 31)) === day) {
      const earned = yearFraction(depositAccrual);
      depositAccrual = 0n;
      if (earned > 0)
        post({
          id: `bank_int_${month}`,
          date: day,
          amount: earned,
          description: `INTEREST EARNED money market sweep int_${month}`,
          counterparty: "Pacific Commerce Bank",
        });
    }
    if (!Number.isSafeInteger(balance)) throw new Error("cash left the safe integer range");
    balances.set(day, balance);
    drawnOn.set(day, drawn);
  }
  posted.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return {
    spec,
    seed,
    end,
    book,
    roster,
    cards,
    bills,
    bankTxns: posted,
    balances,
    drawn: drawnOn,
    openingCash,
  };
}
