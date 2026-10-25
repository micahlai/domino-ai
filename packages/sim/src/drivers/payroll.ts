import {
  SIM_START,
  TODAY0,
  addDays,
  bps,
  chance,
  dayIn,
  daysBetween,
  int,
  keyed,
  lastOfMonth,
  maxDate,
  minDate,
  months,
  mulDiv,
  onOrBeforeBusinessDay,
} from "./basics.ts";
import type { Booking } from "./customers.ts";
import type { ProfileSpec } from "./profiles.ts";

/**
 * Payroll drivers: a headcount plan by role, attrition before the creation date with
 * backfills, semi-monthly pay (15th and month end, moved to the previous business day),
 * quarterly sales commissions, an optional December bonus, and employer payroll taxes with
 * annual wage bases (Social Security, Medicare, FUTA, California SUI and ETT), a 4% 401(k)
 * match and the employer share of health benefits, all collected by Gusto in each run.
 */
interface Role {
  salary: [number, number];
  initial: number;
  /** Cost of revenue (support and reliability) rather than operating expense */
  cogs: boolean;
}

export const ROLES: Record<string, Role> = {
  engineer: { salary: [150, 210], initial: 24, cogs: false },
  product: { salary: [140, 190], initial: 6, cogs: false },
  sre: { salary: [160, 200], initial: 5, cogs: true },
  support: { salary: [68, 92], initial: 8, cogs: true },
  success: { salary: [90, 125], initial: 6, cogs: false },
  account_exec: { salary: [110, 140], initial: 7, cogs: false },
  sdr: { salary: [60, 75], initial: 4, cogs: false },
  marketing: { salary: [105, 160], initial: 5, cogs: false },
  ga: { salary: [100, 170], initial: 6, cogs: false },
  exec: { salary: [220, 285], initial: 5, cogs: false },
};

/** Base hiring plan, every 26 days from December 2025, in this role order. */
const HIRE_ORDER = [
  "engineer",
  "account_exec",
  "engineer",
  "success",
  "sdr",
  "engineer",
  "support",
  "marketing",
  "engineer",
  "ga",
  "sre",
  "product",
];

export interface Employee {
  id: string;
  role: string;
  /** Annual base salary, cents */
  salary: number;
  start: string;
  end?: string;
  /** Hired inside the sim (laptop, recruiting fee and seat apply) */
  hiredInSim: boolean;
}

export interface GenRun {
  id: string;
  date: string;
  amount: number;
  /** Net pay debit; the rest is the taxes, deductions and benefits debit */
  netPay: number;
  gross: number;
  employerTaxes: number;
  cogsCost: number;
}

export interface Roster {
  employees: Employee[];
  runs: GenRun[];
  headcountOn: (date: string) => number;
}

const SS_WAGE_BASE: Record<string, number> = {
  "2025": 17_610_000,
  "2026": 18_450_000,
  // Not yet published when this was written; the 2026 base is carried forward.
  "2027": 18_450_000,
};
const SEVEN_K = 700_000;
const BENEFITS_PER_RUN = 57_500;
const WITHHOLDING_BPS = 3_400;

const mondayOnOrAfter = (date: string) => {
  let day = date;
  while (new Date(`${day}T00:00:00Z`).getUTCDay() !== 1) day = addDays(day, 1);
  return day;
};

function hire(seed: number, id: string, role: string, start: string, hiredInSim: boolean) {
  const r = keyed(seed, `employee:${id}`);
  const [low, high] = ROLES[role]!.salary;
  return { id, role, salary: int(r, low, high) * 100_000, start, hiredInSim };
}

/** Departures before the creation date only, so published future runs match what happens. */
function attrition(seed: number, employee: Employee, out: Employee[], depth: number) {
  out.push(employee);
  if (depth > 3) return;
  for (const month of months(maxDate(employee.start, SIM_START), TODAY0)) {
    const r = keyed(seed, `leave:${employee.id}:${month}`);
    if (!chance(r, 0.01)) continue;
    const end = int(r, 0, 1) === 0 ? dayIn(month, 15) : lastOfMonth(month);
    if (end <= addDays(employee.start, 60) || end >= TODAY0) continue;
    employee.end = end;
    const start = mondayOnOrAfter(addDays(end, int(r, 42, 63)));
    attrition(seed, hire(seed, `${employee.id}b`, employee.role, start, true), out, depth + 1);
    return;
  }
}

function roster(seed: number, spec: ProfileSpec, end: string): Employee[] {
  const planned: Employee[] = [];
  let n = 0;
  for (const [role, { initial }] of Object.entries(ROLES))
    for (let i = 0; i < initial; i++) {
      n++;
      const r = keyed(seed, `tenure:emp_${n}`);
      planned.push(
        hire(
          seed,
          `emp_${String(n).padStart(3, "0")}`,
          role,
          addDays(SIM_START, -int(r, 90, 2_000)),
          false,
        ),
      );
    }
  for (let k = 0; ; k++) {
    const start = mondayOnOrAfter(addDays("2025-12-01", 26 * k));
    if (start > end) break;
    planned.push(
      hire(
        seed,
        `emp_h${String(k).padStart(2, "0")}`,
        HIRE_ORDER[k % HIRE_ORDER.length]!,
        start,
        true,
      ),
    );
  }
  for (const extra of spec.extraHires)
    for (let k = 0; k < extra.count; k++) {
      const start = mondayOnOrAfter(addDays(extra.from, extra.everyDays * k));
      if (start <= end)
        planned.push(hire(seed, `emp_x_${extra.role}_${k}`, extra.role, start, true));
    }
  const out: Employee[] = [];
  for (const employee of planned) attrition(seed, employee, out, 0);
  return out;
}

interface Period {
  id: string;
  date: string;
  from: string;
  to: string;
}

function periods(end: string): Period[] {
  const out: Period[] = [];
  for (const month of months(SIM_START, end)) {
    const mid = dayIn(month, 15);
    const last = lastOfMonth(month);
    for (const [from, to] of [
      [`${month}-01`, mid],
      [dayIn(month, 16), last],
    ] as const) {
      const date = onOrBeforeBusinessDay(to);
      if (date >= SIM_START && date <= end) out.push({ id: `pay_${to}`, date, from, to });
    }
  }
  return out;
}

/** Quarterly commission pool (8% of new ARR from deals of $20k ARR or more), paid on the 15th of the second month after quarter end. */
function commissions(bookings: Booking[]): Map<string, number> {
  const pools = new Map<string, number>();
  for (const booking of bookings) {
    if (booking.arr < 2_000_000) continue;
    const month = Number(booking.date.slice(5, 7));
    const quarterEnd = Math.ceil(month / 3) * 3;
    const year = Number(booking.date.slice(0, 4));
    const payMonth = quarterEnd + 2 > 12 ? quarterEnd + 2 - 12 : quarterEnd + 2;
    const payYear = quarterEnd + 2 > 12 ? year + 1 : year;
    const key = `${payYear}-${String(payMonth).padStart(2, "0")}-15`;
    pools.set(key, (pools.get(key) ?? 0) + bps(booking.arr, 800));
  }
  return pools;
}

export function generateRoster(
  seed: number,
  spec: ProfileSpec,
  bookings: Booking[],
  end: string,
): Roster {
  const employees = roster(seed, spec, end);
  const pools = commissions(bookings);
  const ytd = new Map<string, number>();
  const ytdYear = new Map<string, string>();
  for (const e of employees) if (!e.hiredInSim) ytd.set(e.id, mulDiv(e.salary, 20, 24));
  for (const e of employees) if (!e.hiredInSim) ytdYear.set(e.id, "2025");
  const runs: GenRun[] = [];
  for (const period of periods(end)) {
    const year = period.date.slice(0, 4);
    const active = employees.filter(
      (e) => e.start <= period.to && (!e.end || e.end >= period.from),
    );
    const sellers = active.filter(
      (e) => e.role === "account_exec" && (!e.end || e.end >= period.to),
    );
    const pool = pools.get(period.to) ?? 0;
    const bonusDay = period.to === "2026-12-15" && spec.decemberBonusBps > 0;
    const run: GenRun = {
      id: period.id,
      date: period.date,
      amount: 0,
      netPay: 0,
      gross: 0,
      employerTaxes: 0,
      cogsCost: 0,
    };
    for (const e of active) {
      const first = maxDate(e.start, period.from);
      const last = e.end ? minDate(e.end, period.to) : period.to;
      const worked = daysBetween(first, last) + 1;
      const length = daysBetween(period.from, period.to) + 1;
      let gross = mulDiv(e.salary, worked, 24 * length);
      if (sellers.length > 0 && sellers.includes(e)) {
        const share = Math.floor(pool / sellers.length);
        gross += e === sellers[0] ? pool - share * (sellers.length - 1) : share;
      }
      if (bonusDay && e.start <= "2026-12-01") gross += bps(e.salary, spec.decemberBonusBps);
      if (ytdYear.get(e.id) !== year) {
        ytd.set(e.id, 0);
        ytdYear.set(e.id, year);
      }
      const before = ytd.get(e.id) ?? 0;
      const capped = (cap: number) => Math.max(0, Math.min(gross, cap - before));
      const taxes =
        bps(capped(SS_WAGE_BASE[year] ?? SS_WAGE_BASE["2027"]!), 620) +
        bps(gross, 145) +
        bps(capped(SEVEN_K), 60) +
        bps(capped(SEVEN_K), 340) +
        bps(capped(SEVEN_K), 10);
      ytd.set(e.id, before + gross);
      const benefits = !e.end || e.end >= period.to ? BENEFITS_PER_RUN : 0;
      const cost = gross + taxes + bps(gross, 400) + benefits;
      run.gross += gross;
      run.employerTaxes += taxes;
      run.amount += cost;
      run.netPay += gross - bps(gross, WITHHOLDING_BPS);
      if (ROLES[e.role]!.cogs) run.cogsCost += cost;
    }
    runs.push(run);
  }
  const headcountOn = (date: string) =>
    employees.filter((e) => e.start <= date && (!e.end || e.end >= date)).length;
  return { employees, runs, headcountOn };
}
