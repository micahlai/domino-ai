/**
 * Hand-written fixtures for Kestrel Data. The UI builds against these until the real
 * engine is ready. Numbers are placeholders but follow every rule in the contracts.
 * Import with: import { fixtures } from "@domino/contracts/fixtures";
 */
import type {
  Branch,
  Domino,
  FixCandidate,
  Forecast,
  ForecastWeek,
  HistoryWeek,
  PastEvent,
  ResilienceReport,
  RiskEvent,
  Universe,
} from "../branches";
import type { Cents, CompanyModel, Constraint, Snapshot } from "../core";

const D = (dollars: number): Cents => Math.round(dollars * 100);
const K = (thousands: number): Cents => D(thousands * 1000);

export const WEEK_STARTS = [
  "2026-11-02",
  "2026-11-09",
  "2026-11-16",
  "2026-11-23",
  "2026-11-30",
  "2026-12-07",
  "2026-12-14",
  "2026-12-21",
  "2026-12-28",
  "2027-01-04",
  "2027-01-11",
  "2027-01-18",
  "2027-01-25",
] as const;

const RESTRICTED = K(600);
const OPENING_CASH = K(4500);
const WEEKLY_OUTFLOW = K(520);

/** Build a 13-week forecast from a list of usable-cash values (in thousands of dollars). */
export function forecastFromUsable(usableK: number[]): Forecast {
  if (usableK.length !== 13) throw new Error("need 13 weeks");
  let opening = OPENING_CASH;
  const weeks: ForecastWeek[] = usableK.map((u, i) => {
    const usable = K(u);
    const closing = usable + RESTRICTED;
    const outflow = WEEKLY_OUTFLOW;
    const inflow = closing - opening + outflow;
    const week: ForecastWeek = {
      weekStart: WEEK_STARTS[i]!,
      opening,
      inflow,
      outflow,
      closing,
      usable,
    };
    opening = closing;
    return week;
  });
  const low = weeks.reduce((a, b) => (b.usable < a.usable ? b : a));
  return { weeks, lowPoint: { weekStart: low.weekStart, usable: low.usable } };
}

export const snapshot: Snapshot = {
  companyId: "kestrel",
  asOf: "2026-10-30",
  cashOnHand: OPENING_CASH,
  restrictedCash: RESTRICTED,
  customers: [
    { id: "cus_acme", name: "Acme Logistics", paymentTermsDays: 30 },
    { id: "cus_northwind", name: "Northwind Health", paymentTermsDays: 60 },
    { id: "cus_brightpath", name: "Brightpath Retail", paymentTermsDays: 30 },
    { id: "cus_cobalt", name: "Cobalt Labs", paymentTermsDays: 30 },
  ],
  invoices: [
    {
      id: "inv_acme_2027",
      customerId: "cus_acme",
      amount: K(240),
      issued: "2026-10-26",
      due: "2026-11-25",
    },
    {
      id: "inv_nw_q4",
      customerId: "cus_northwind",
      amount: K(250),
      issued: "2026-10-01",
      due: "2026-11-30",
    },
    {
      id: "inv_bp_nov",
      customerId: "cus_brightpath",
      amount: K(36),
      issued: "2026-11-01",
      due: "2026-12-01",
    },
    {
      id: "inv_cobalt_2027",
      customerId: "cus_cobalt",
      amount: K(96),
      issued: "2026-10-15",
      due: "2026-11-14",
    },
  ],
  bankTxns: [
    {
      id: "txn_001",
      date: "2026-10-27",
      amount: K(120),
      description: "STRIPE PAYOUT",
      counterparty: "Stripe",
    },
    {
      id: "txn_002",
      date: "2026-10-30",
      amount: -K(600),
      description: "GUSTO PAYROLL",
      counterparty: "Gusto",
    },
  ],
  bills: [
    {
      id: "bill_cloud_q1",
      vendor: "Cloud provider",
      amount: K(210),
      due: "2027-01-01",
      critical: true,
    },
    {
      id: "bill_agency_nov",
      vendor: "Northlight Marketing",
      amount: K(45),
      due: "2026-11-15",
      critical: false,
    },
    {
      id: "bill_rent_nov",
      vendor: "Office landlord",
      amount: K(62),
      due: "2026-11-05",
      critical: true,
    },
  ],
  cardTxns: [
    { id: "card_001", date: "2026-10-28", amount: K(4.2), merchant: "FIGMA", category: "Software" },
    {
      id: "card_002",
      date: "2026-10-29",
      amount: K(11.8),
      merchant: "DATADOG INC",
      category: "Software",
    },
  ],
  payroll: [
    { id: "pay_1106", date: "2026-11-06", amount: K(600) },
    { id: "pay_1120", date: "2026-11-20", amount: K(600) },
  ],
  deals: [
    {
      id: "deal_acme_renewal",
      customerId: "cus_acme",
      amount: K(240),
      stage: "won",
      expectedClose: "2026-10-20",
      signed: true,
    },
    {
      id: "deal_nw_expansion",
      customerId: "cus_northwind",
      amount: K(120),
      stage: "won",
      expectedClose: "2026-11-10",
      signed: false,
    },
  ],
};

export const constraints: Constraint[] = [
  {
    id: "con_lender_min",
    label: "Lender's minimum",
    kind: "min_cash",
    limit: K(3000),
    evidence: {
      source: "document",
      ref: "loan-agreement.pdf#7.2",
      quote: "Borrower shall maintain Unrestricted Cash of not less than $3,000,000 at all times.",
      note: "The loan counts only unrestricted cash. Lease collateral does not count.",
    },
  },
  {
    id: "con_runway",
    label: "Runway policy",
    kind: "min_runway_months",
    limit: 18,
    evidence: {
      source: "document",
      ref: "board-policy.pdf#2",
      note: "The board requires 18 months of runway.",
    },
  },
];

export const model: CompanyModel = {
  version: 3,
  customerDelayDays: {
    cus_acme: { mean: 21, p90: 45, samples: 6 },
    cus_northwind: { mean: 4, p90: 9, samples: 8 },
    cus_brightpath: { mean: 2, p90: 5, samples: 10 },
    cus_cobalt: { mean: 6, p90: 12, samples: 5 },
  },
  recurringSpend: [{ label: "Software subscriptions", amount: K(38), everyDays: 30 }],
  rules: [
    {
      id: "rule_acme_late",
      text: "Acme pays about 3 weeks after the due date. Forecast Acme cash 21 days late.",
      evidence: [
        { source: "stripe", ref: "inv_acme_2026q2", note: "Paid 24 days late" },
        { source: "stripe", ref: "inv_acme_2026q3", note: "Paid 19 days late" },
      ],
      approvedBy: "controller",
      errorBefore: 6.1,
      errorAfter: 3.4,
    },
  ],
};

const acmeEvidence = [
  { source: "stripe" as const, ref: "inv_acme_2027", note: "$240K invoice due Nov 25" },
  {
    source: "learned" as const,
    ref: "rule_acme_late",
    note: "Acme paid late on its last 2 invoices",
  },
];

const eventDominoes: Domino[] = [
  {
    order: 1,
    weekStart: "2026-11-23",
    label: "Acme pays its $240K invoice 45 days late",
    evidence: acmeEvidence,
  },
  {
    order: 2,
    weekStart: "2026-11-23",
    label: "Usable cash drops to $3.35M",
    causedBy: 1,
    evidence: [],
  },
  {
    order: 3,
    weekStart: "2026-11-30",
    label: "Usable cash falls below the lender's $3M minimum",
    constraintId: "con_lender_min",
    causedBy: 2,
    evidence: [constraints[0]!.evidence],
  },
  {
    order: 4,
    weekStart: "2026-12-07",
    label: "Two planned hires must pause",
    causedBy: 3,
    evidence: [],
  },
];

export const branches: Branch[] = [
  {
    id: "br_base",
    parentId: null,
    kind: "base",
    label: "Base forecast",
    changes: [],
    forecast: forecastFromUsable([
      3900, 3780, 3850, 3700, 3760, 3640, 3700, 3600, 3680, 3560, 3640, 3520, 3600,
    ]),
    dominoes: [],
    status: "draft",
  },
  {
    id: "br_acme_late",
    parentId: "br_base",
    kind: "event",
    label: "Acme pays 45 days late",
    probability: 0.7,
    changes: [{ kind: "delay_invoice", invoiceId: "inv_acme_2027", days: 45 }],
    forecast: forecastFromUsable([
      3900, 3780, 3700, 3350, 2950, 2900, 3050, 3150, 3250, 3200, 3300, 3250, 3350,
    ]),
    dominoes: eventDominoes,
    status: "draft",
  },
  {
    id: "br_fix_early_pay",
    parentId: "br_acme_late",
    kind: "fix",
    label: "Offer Acme 2% to pay now",
    changes: [
      { kind: "discount_early_pay", invoiceId: "inv_acme_2027", percent: 2, payOn: "2026-11-20" },
    ],
    forecast: forecastFromUsable([
      3900, 3780, 3700, 3585, 3185, 3135, 3285, 3150, 3250, 3200, 3300, 3250, 3350,
    ]),
    dominoes: [],
    status: "proposed",
  },
  {
    id: "br_fix_delay_hire",
    parentId: "br_acme_late",
    kind: "fix",
    label: "Delay one hire by a month",
    changes: [
      {
        kind: "shift_hire",
        label: "Senior engineer",
        monthlyCost: K(22),
        fromDate: "2026-11-16",
        toDate: "2026-12-16",
      },
    ],
    forecast: forecastFromUsable([
      3900, 3780, 3700, 3372, 2994, 2944, 3094, 3194, 3250, 3200, 3300, 3250, 3350,
    ]),
    dominoes: [
      {
        order: 1,
        weekStart: "2026-11-30",
        label: "Usable cash still dips below the lender's minimum",
        constraintId: "con_lender_min",
        evidence: [constraints[0]!.evidence],
      },
    ],
    status: "draft",
  },
  {
    id: "br_renewal_churn",
    parentId: "br_base",
    kind: "event",
    label: "Northwind does not renew",
    probability: 0.25,
    changes: [{ kind: "lose_invoice", invoiceId: "inv_nw_q4" }],
    forecast: forecastFromUsable([
      3900, 3780, 3850, 3700, 3580, 3460, 3520, 3420, 3500, 3380, 3460, 3340, 3420,
    ]),
    dominoes: [],
    status: "draft",
  },
];

export const risks: RiskEvent[] = [
  {
    id: "risk_acme_late",
    label: "Acme pays 45 days late",
    probability: 0.7,
    impactLowPoint: K(700),
    changes: [{ kind: "delay_invoice", invoiceId: "inv_acme_2027", days: 45 }],
    evidence: acmeEvidence,
  },
  {
    id: "risk_nw_churn",
    label: "Northwind does not renew",
    probability: 0.25,
    impactLowPoint: K(250),
    changes: [{ kind: "lose_invoice", invoiceId: "inv_nw_q4" }],
    evidence: [
      {
        source: "crm",
        ref: "deal_nw_expansion",
        note: "Marked won, but the contract is not signed",
      },
    ],
  },
];

export const fixes: FixCandidate[] = [
  {
    id: "fix_early_pay",
    label: "Offer Acme 2% to pay now",
    changes: [
      { kind: "discount_early_pay", invoiceId: "inv_acme_2027", percent: 2, payOn: "2026-11-20" },
    ],
    costNote: "Gives up $4,800 on a $240K invoice",
    risk: "low",
    evidence: acmeEvidence,
  },
  {
    id: "fix_delay_hire",
    label: "Delay one hire by a month",
    changes: [
      {
        kind: "shift_hire",
        label: "Senior engineer",
        monthlyCost: K(22),
        fromDate: "2026-11-16",
        toDate: "2026-12-16",
      },
    ],
    costNote: "Engineering roadmap slips by about two weeks",
    risk: "low",
    evidence: [{ source: "payroll", ref: "hiring-plan", note: "Start date is Nov 16" }],
  },
];

// ---------- Multiverse timeline fixtures ----------

/** 26 weeks of real history before today (Mondays), oldest first. */
export const history: HistoryWeek[] = Array.from({ length: 26 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 26) - (25 - i) * 7 * 86_400_000);
  const weekStart = d.toISOString().slice(0, 10);
  // A gentle wave, ending at today's $3.9M usable. Whole thousands, so cents stay integers.
  const usableK = 3900 + Math.round(Math.sin(i / 3) * 220) + (25 - i) * 18;
  return { weekStart, closing: K(usableK) + RESTRICTED, usable: K(usableK) };
});

export const pastEvents: PastEvent[] = [
  {
    id: "past_acme_q2",
    date: "2026-07-14",
    label: "Acme paid 24 days late",
    kind: "late_payment",
    amount: K(240),
    evidence: [{ source: "stripe", ref: "inv_acme_2026q2", note: "Due Jun 20, paid Jul 14" }],
  },
  {
    id: "past_cobalt_deal",
    date: "2026-08-03",
    label: "Cobalt Labs signed a $96K deal",
    kind: "big_deal",
    amount: K(96),
    evidence: [{ source: "crm", ref: "deal_cobalt_2026", note: "Closed won and signed" }],
  },
  {
    id: "past_acme_q3",
    date: "2026-09-08",
    label: "Acme paid 19 days late",
    kind: "late_payment",
    amount: K(240),
    evidence: [{ source: "stripe", ref: "inv_acme_2026q3", note: "Due Aug 20, paid Sep 8" }],
  },
  {
    id: "past_hires",
    date: "2026-09-21",
    label: "Six engineers joined",
    kind: "hire",
    amount: -K(66),
    evidence: [{ source: "payroll", ref: "pay_0925", note: "Payroll rose $66K per run" }],
  },
];

/** Extra risks so the multiverse has good and bad futures. */
export const moreRisks: RiskEvent[] = [
  {
    id: "risk_cloud_spike",
    label: "Cloud bill jumps 30%",
    probability: 0.3,
    impactLowPoint: K(63),
    changes: [{ kind: "remove_cash", date: "2027-01-01", amount: K(63), label: "Cloud overage" }],
    evidence: [{ source: "ramp", ref: "cloud-usage", note: "Usage up 22% in 4 weeks" }],
  },
  {
    id: "risk_brightpath_fail",
    label: "Brightpath goes out of business",
    probability: 0.05,
    impactLowPoint: K(36),
    changes: [{ kind: "lose_invoice", invoiceId: "inv_bp_nov" }],
    evidence: [{ source: "learned", ref: "news", note: "Retail sector layoffs (example)" }],
  },
  {
    id: "risk_big_deal_early",
    label: "Cobalt expansion closes early",
    probability: 0.2,
    impactLowPoint: -K(150),
    changes: [{ kind: "add_cash", date: "2026-11-27", amount: K(150), label: "Cobalt expansion" }],
    evidence: [{ source: "crm", ref: "deal_cobalt_expansion", note: "Stage: contract sent" }],
  },
];

const BASE_USABLE_K = [
  3900, 3780, 3850, 3700, 3760, 3640, 3700, 3600, 3680, 3560, 3640, 3520, 3600,
];
/** Cash effect of each risk by week (thousands), relative to base. */
const SHOCK_K: Record<string, number[]> = {
  risk_acme_late: [0, 0, -150, -350, -810, -740, -650, -450, -430, -360, -340, -270, -250],
  risk_nw_churn: [0, 0, 0, 0, -250, -250, -250, -250, -250, -250, -250, -250, -250],
  risk_cloud_spike: [0, 0, 0, 0, 0, 0, 0, 0, -63, -63, -63, -63, -63],
  risk_brightpath_fail: [0, 0, 0, 0, -36, -36, -36, -36, -36, -36, -36, -36, -36],
  risk_big_deal_early: [0, 0, 0, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150],
};
/** Cash effect of each fix by week (thousands). */
const FIX_K: Record<string, number[]> = {
  fix_early_pay: [0, 0, 80, 200, 330, 300, 260, 200, 180, 150, 130, 100, 80],
  fix_delay_hire: [0, 0, 0, 22, 44, 44, 44, 44, 0, 0, 0, 0, 0],
};

function universe(riskIds: string[], fixIds: string[], allRisks: RiskEvent[]): Universe {
  const usable = BASE_USABLE_K.map((v, w) => {
    let u = v;
    for (const r of riskIds) u += SHOCK_K[r]?.[w] ?? 0;
    // A fix only helps in universes that contain the risk it targets.
    if (riskIds.includes("risk_acme_late")) for (const f of fixIds) u += FIX_K[f]?.[w] ?? 0;
    return u;
  });
  const forecast = forecastFromUsable(usable);
  const firstBreak = forecast.weeks.find((w) => w.usable < K(3000));
  const labels = riskIds.map((id) => allRisks.find((r) => r.id === id)?.label ?? id);
  const probability = riskIds.reduce(
    (p, id) => p * (allRisks.find((r) => r.id === id)?.probability ?? 1),
    1,
  );
  return {
    id: `u_${riskIds.join("+") || "base"}${fixIds.length ? `_with_${fixIds.join("+")}` : ""}`,
    label: labels.length ? labels.join(" + ") : "Base forecast",
    riskIds,
    fixIds,
    probability,
    survives: !firstBreak,
    ...(firstBreak ? { breaksAt: firstBreak.weekStart, brokenConstraintId: "con_lender_min" } : {}),
    forecast,
  };
}

function report(fixIds: string[]): ResilienceReport {
  const all = [...risks, ...moreRisks];
  const ids = all.map((r) => r.id);
  const combos: string[][] = [
    [],
    ...ids.map((id) => [id]),
    ["risk_acme_late", "risk_nw_churn"],
    ["risk_acme_late", "risk_cloud_spike"],
    ["risk_nw_churn", "risk_cloud_spike"],
    ["risk_acme_late", "risk_big_deal_early"],
    ["risk_acme_late", "risk_nw_churn", "risk_cloud_spike"],
  ];
  const universes = combos.map((c) => universe(c, fixIds, all));
  const weight = universes.reduce((s, u) => s + u.probability, 0);
  const survived = universes.filter((u) => u.survives);
  return {
    universes,
    survivalRate: survived.reduce((s, u) => s + u.probability, 0) / weight,
    survivedCount: survived.length,
    breakingPoints: [
      { label: "Acme paying 38 or more days late", threshold: 38, unit: "days_late" },
      {
        label: "Losing $420K or more of renewals this quarter",
        threshold: K(420),
        unit: "cents_lost",
      },
    ],
    appliedFixIds: fixIds,
  };
}

/** Multiverse with no fixes, and with the two suggested fixes applied. */
export const resilience = report([]);
export const resilienceWithFixes = report(["fix_early_pay", "fix_delay_hire"]);

export const fixtures = {
  snapshot,
  constraints,
  model,
  branches,
  risks,
  moreRisks,
  fixes,
  history,
  pastEvents,
  resilience,
  resilienceWithFixes,
};
