import { keyedInt } from "../create.ts";
import type { OperatingCompanyId } from "./types.ts";

/**
 * Company-specific operating texture for the companies the switcher shows. Every value is a
 * synthetic, illustrative assumption sized to the company (not a reported figure). Reported
 * totals still reconcile exactly: these knobs only move timing and the split inside totals,
 * except future-only items (insurance renewal, pipeline) after the observation cutoff.
 * Legacy demo ids return null and keep their original, hash-locked output.
 */
export interface Realism {
  /** Names for the 24 synthetic customer pools, largest-weight pool first in the list order. */
  customers: readonly string[];
  /** Linear growth of monthly cash costs per month, in basis points; all of it goes to payroll. */
  payrollGrowthBp: number;
  /** Customer pool indexes that pay chronically late, and how late (days past due). */
  late: readonly number[];
  lateDays: readonly [number, number];
  /** Pools that usually pay a few days before due. */
  early: readonly number[];
  /** The largest pool; its latest receivable is long overdue at the cutoff. */
  big: number;
  /** Cloud vendor uplift and its cadence (months), from contract renewals. */
  cloudRiseBp: number;
  cloudRiseEveryMonths: number;
  /** Quarterly sales and use tax remittance, as a share of the month's supplier cash. */
  taxBp: number;
  /** Annual insurance premium (share of a month's supplier cash) and days after the cutoff. */
  insuranceBp: number;
  insuranceDays: number;
  /** Open expansion deals (share of quarterly revenue each, days to close after the cutoff). */
  pipeline: readonly { bp: number; days: number; pool: number }[];
  /** Closed expansion history used for the win rate. */
  won: number;
  lost: number;
}

const universities = [
  "Marlow Hill University",
  "Eastvale State University",
  "Corbin College of Nursing",
  "Ridgefield School of Law",
  "Lakeport University",
  "Saint Ansel College",
  "Harrowgate Business School",
  "Pinecrest University",
  "Westmont Tech Institute",
  "Calder Valley College",
  "Northam University",
  "Brennan School of Public Health",
  "Ashby College of Engineering",
  "Glenmoor University",
  "Ferris Point College",
  "Halden Medical School",
  "Oakridge State College",
  "Sutter Bay University",
  "Whitlock Graduate School",
  "Kingsbury College",
  "Merriton University",
  "Tamsin School of Social Work",
  "Redfield Polytechnic",
  "Varden University",
];
const workManagement = [
  "Brightwave Retail",
  "Kelso Logistics",
  "Arden Health Partners",
  "Lumen Media Group",
  "Northpeak Financial",
  "Corvid Games",
  "Fairhaven Hotels",
  "Quillon Software",
  "Meridale Foods",
  "Stonebridge Insurance",
  "Tessaro Fashion",
  "Orbiton Telecom",
  "Halcyon Biotech",
  "Pemberly Publishing",
  "Granite Peak Energy",
  "Vellum Legal",
  "Sorrel Agency",
  "Bluecart Commerce",
  "Ironwood Manufacturing",
  "Cascade Education",
  "Drummond Realty",
  "Wrenfield Nonprofit Alliance",
  "Atlas Freightworks",
  "Juniper Clinics",
];
const devops = [
  "Vector Systems",
  "Ostrander Bank",
  "Kitebird Aerospace",
  "Calloway County Records Office",
  "Pallas Automotive",
  "Nimbus Payments",
  "Greyline Security",
  "Corrigan Telecom",
  "Starling Health Network",
  "Tidewater Energy",
  "Quarrystone Gaming",
  "Hexapod Robotics",
  "Lattice Retail Group",
  "Bramble Insurance",
  "Sierra Grid Utilities",
  "Moxley Media",
  "Paragon Chip Design",
  "Westbrook University IT",
  "Orchid Pharma",
  "Fennick Logistics",
  "Cobalt Defense Labs",
  "Rivermark Credit Union",
  "Zephyr Mobility",
  "Ambergate Analytics",
];

const PROFILES: Partial<Record<OperatingCompanyId, Omit<Realism, "late" | "early" | "big">>> = {
  // 2U: university partners on long approval cycles; modest hiring after 2023 cost cuts.
  "2u": {
    customers: universities,
    payrollGrowthBp: 40,
    lateDays: [18, 40],
    cloudRiseBp: 500,
    cloudRiseEveryMonths: 3,
    taxBp: 300,
    insuranceBp: 2_500,
    insuranceDays: 62,
    pipeline: [
      { bp: 90, days: 24, pool: 3 },
      { bp: 140, days: 45, pool: 7 },
      { bp: 60, days: 66, pool: 12 },
    ],
    won: 2,
    lost: 3,
  },
  // Taskline (Asana-like): broad mid-market base, flat-to-modest hiring, annual cloud uplift.
  "asana-current": {
    customers: workManagement,
    payrollGrowthBp: 70,
    lateDays: [12, 30],
    cloudRiseBp: 900,
    cloudRiseEveryMonths: 6,
    taxBp: 400,
    insuranceBp: 3_000,
    insuranceDays: 37,
    pipeline: [
      { bp: 60, days: 18, pool: 2 },
      { bp: 45, days: 33, pool: 9 },
      { bp: 80, days: 52, pool: 15 },
      { bp: 35, days: 70, pool: 20 },
    ],
    won: 3,
    lost: 2,
  },
  // CodeHarbor (GitLab-like): enterprise and public-sector buyers, faster hiring.
  "gitlab-current": {
    customers: devops,
    payrollGrowthBp: 110,
    lateDays: [20, 45],
    cloudRiseBp: 700,
    cloudRiseEveryMonths: 3,
    taxBp: 350,
    insuranceBp: 2_000,
    insuranceDays: 68,
    pipeline: [
      { bp: 120, days: 29, pool: 1 },
      { bp: 70, days: 47, pool: 6 },
      { bp: 50, days: 61, pool: 11 },
    ],
    won: 4,
    lost: 3,
  },
};

export function realism(company: OperatingCompanyId, seed: number): Realism | null {
  const p = PROFILES[company];
  if (!p) return null;
  // Seeded but company-keyed, so companies never share the same late or early payers.
  const pick = (key: string, n: number, taken: Set<number>) => {
    const out: number[] = [];
    for (let k = 0; out.length < n; k++) {
      const i = keyedInt(seed, `${company}/${key}/${k}`, 1, 23);
      if (!taken.has(i)) {
        taken.add(i);
        out.push(i);
      }
    }
    return out;
  };
  const taken = new Set([0]);
  const late = pick("late", company === "gitlab-current" ? 5 : company === "2u" ? 4 : 3, taken);
  const early = pick("early", company === "asana-current" ? 4 : 2, taken);
  return { ...p, late, early, big: 0 };
}
