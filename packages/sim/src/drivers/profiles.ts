/**
 * Company profiles for the picker. One vertical (a B2B SaaS analytics company, Kestrel Data,
 * about $15M ARR, ~80 people) under four situations. Every profile shares the same seeded
 * identities, so the same customer or employee draws the same way in every profile; only the
 * drivers below differ. Amounts are integer cents.
 */
export const PROFILE_IDS = ["kestrel", "kestrel-churn", "kestrel-late", "kestrel-crunch"] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];
export const isProfileId = (value: string): value is ProfileId =>
  (PROFILE_IDS as readonly string[]).includes(value);

const M = (dollars: number) => dollars * 100;

export interface RevolverSpec {
  lender: string;
  limit: number;
  /** Drawn balance on SIM_START */
  drawn: number;
  /** Annual rate on the drawn balance */
  rateBps: number;
  /** Annual fee on the undrawn commitment */
  unusedBps: number;
  /** Borrowing base: this share of open receivables at most 90 days past due */
  advanceBps: number;
  /** Weekly treasury check: draw when usable cash after the next 7 days of known outflows is below this */
  floor: number;
  /** Repay when usable cash after the next 7 days of known outflows is above this */
  ceiling: number;
}

export interface TermLoanSpec {
  lender: string;
  /** Outstanding principal on SIM_START */
  principal: number;
  rateBps: number;
  /** First principal installment, due on the 1st of this month */
  amortizesFrom: string;
  monthlyPrincipal: number;
}

export interface ProfileSpec {
  id: ProfileId;
  name: string;
  /** One paragraph: what is happening at this company and what Domino should find */
  story: string;
  /** Bank balance on SIM_START (lease collateral included) */
  startCash: number;
  /** Letter-of-credit collateral for the office lease, counted in the bank balance */
  restrictedCash: number;
  /** Lender's minimum unrestricted cash, the same $3M as the loan document fixture */
  minimumCash: number;
  revolver: RevolverSpec;
  termLoan?: TermLoanSpec;
  equity: { date: string; amount: number; label: string }[];
  /** New-logo bookings relative to plan, in basis points */
  bookingsBps: number;
  /** Hires on top of the base plan: role, count, first start Monday, spacing in days */
  extraHires: { role: string; count: number; from: string; everyDays: number }[];
  /** Year-end bonus paid in the December 15 run, as a share of base salary */
  decemberBonusBps: number;
  /** Monthly office rent; a step-up applies from `from` */
  rent: { base: number; stepUp?: { from: string; amount: number } };
  /** Leasehold improvement progress bills: [received, due, amount] */
  buildout: [string, string, number][];
  /** The top customer gives notice, stops paying and settles its last invoice short */
  topCustomerLeaves?: { noticeOn: string; settleOn: string; settleBps: number };
  /**
   * Calibrates startCash (deterministically, per seed) so the lowest usable cash in the 13
   * forecast weeks after the creation date is about this amount, whatever the seed's bookings.
   */
  lowestUsableAfterCreation?: number;
  /** The largest ACH payers pay their invoices issued from `issuedFrom` 30 to 60 days late */
  majorsPayLate?: { count: number; issuedFrom: string; lateDays: [number, number] };
}

const BASE = {
  restrictedCash: M(600_000),
  minimumCash: M(3_000_000),
  revolver: {
    lender: "Pacific Commerce Bank",
    limit: M(5_000_000),
    drawn: 0,
    rateBps: 775,
    unusedBps: 25,
    advanceBps: 8_000,
    floor: M(7_600_000),
    ceiling: M(10_500_000),
  },
  equity: [] as ProfileSpec["equity"],
  bookingsBps: 10_000,
  extraHires: [] as ProfileSpec["extraHires"],
  decemberBonusBps: 0,
  rent: { base: M(92_000) },
  buildout: [] as ProfileSpec["buildout"],
} satisfies Partial<ProfileSpec>;

const SERIES_B_EXTENSION = {
  date: "2026-06-10",
  amount: M(9_000_000),
  label: "Series B extension preferred stock",
};

export const PROFILES: Record<ProfileId, ProfileSpec> = {
  kestrel: {
    ...BASE,
    id: "kestrel",
    name: "Kestrel Data",
    story:
      "Kestrel Data is a healthy B2B analytics SaaS company with about $21M ARR: roughly 22 enterprise and 78 mid-market customers that prepay annually or quarterly (or monthly) on net 30 to 60 terms by ACH, plus about 108 self-serve customers paying monthly by card through Stripe. About 87 people are paid semi-monthly through Gusto. It carried $1.75M on its $5M credit line through the winter, closed a $9M Series B extension in June and repaid the line. Usable cash is about $14.6M and stays far above the lender's $3M minimum for the next 13 weeks; the main forecast uncertainty is ordinary collection timing. (Figures are for the default seed 1.)",
    startCash: M(9_400_000),
    equity: [SERIES_B_EXTENSION],
  },
  "kestrel-churn": {
    ...BASE,
    id: "kestrel-churn",
    name: "Kestrel Data (top customer leaving)",
    story:
      "The same company, but its largest customer, Halcyon Freight ($1.14M ARR, billed $285,000 quarterly on net 60), was acquired and gave notice on October 5 that it will not renew on November 16. Its renewal deal is marked lost, its billing plan ends November 15, and it is withholding its last quarterly invoice (due October 15) over a service-credit dispute; it settles that invoice at 60% ($171,000) on November 20. Cash stays above the lender's minimum, but a forecast that counts the open invoice at face value is $114,000 too high, and recurring revenue drops about 5.5% from mid-November.",
    startCash: M(9_400_000),
    equity: [SERIES_B_EXTENSION],
    topCustomerLeaves: { noticeOn: "2026-10-05", settleOn: "2026-11-20", settleBps: 6_000 },
  },
  "kestrel-late": {
    ...BASE,
    id: "kestrel-late",
    name: "Kestrel Data (big customers paying late)",
    story:
      "The same company, but since April its ten largest ACH customers by billing pay 30 to 60 days after the due date (procurement freezes and new AP portals) while everyone else pays normally. Receivables days climb from about 45 to about 83 and the collection period from about 54 to 59 days; on the current date 16 invoices worth about $3.7M are overdue. A forecast that assumes invoices are paid on their due dates puts all of that cash in the first week, while the history shows it will arrive one to two months later. (Figures are for the default seed 1.)",
    startCash: M(9_400_000),
    equity: [SERIES_B_EXTENSION],
    majorsPayLate: { count: 10, issuedFrom: "2026-04-01", lateDays: [30, 60] },
  },
  "kestrel-crunch": {
    ...BASE,
    id: "kestrel-crunch",
    name: "Kestrel Data (cash crunch)",
    story:
      "The same product, but the company raised venture debt instead of equity: a $6M term loan at 11.5% that began amortizing $250,000 a month in October, plus a $4M credit line with $2.75M drawn and no more room under its receivables borrowing base. It hired 18 people ahead of plan between June and October while new bookings came in at half of plan, signed a larger office lease (rent rises from $92,000 to $131,000 in January, with leasehold build-out billed in November and December) and committed to a 10% year-end bonus paid December 15. Usable cash is about $6M today. The bonus payroll takes it below the lender's $3M minimum on December 15, and by late January it is down to about $0.3M even after holding non-critical vendor bills; a forecast from the current records shows the breach by the week of December 28. An insider bridge round arrives February 11, after the 13 weeks. (Starting cash is calibrated per seed so the low is about $0.3M; figures are for the default seed 1.)",
    startCash: M(12_600_000),
    revolver: {
      ...BASE.revolver,
      limit: M(4_000_000),
      drawn: M(2_750_000),
      rateBps: 850,
      floor: M(3_600_000),
      // A company short of cash keeps what it draws.
      ceiling: M(50_000_000),
    },
    termLoan: {
      lender: "Meridian Growth Capital",
      principal: M(6_000_000),
      rateBps: 1_150,
      amortizesFrom: "2026-10",
      monthlyPrincipal: M(250_000),
    },
    equity: [
      {
        date: "2027-02-11",
        amount: M(5_000_000),
        label: "insider bridge preferred stock",
      },
    ],
    bookingsBps: 5_000,
    extraHires: [
      { role: "engineer", count: 10, from: "2026-06-01", everyDays: 14 },
      { role: "account_exec", count: 5, from: "2026-06-15", everyDays: 21 },
      { role: "marketing", count: 3, from: "2026-07-06", everyDays: 28 },
    ],
    decemberBonusBps: 1_000,
    lowestUsableAfterCreation: M(300_000),
    rent: { base: M(92_000), stepUp: { from: "2027-01", amount: M(131_000) } },
    buildout: [
      ["2026-10-26", "2026-11-25", M(240_000)],
      ["2026-11-30", "2026-12-30", M(185_000)],
    ],
  },
};
