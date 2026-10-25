import type { PayrollRun, Snapshot } from "@domino/contracts";
import { dollars } from "../sources";
import { type Item, type VendorRoute, intParam, json, sortBy } from "./common";

/**
 * Gusto-shaped mock: GET /v1/companies/:company_uuid/payrolls?page=&per= (per 1-100, default
 * 25). Returns a bare array with a `Link: <...>; rel="next"` header while more pages exist.
 * Totals are decimal dollar strings, like the real API.
 */

/**
 * Splits the run's total cash cost into Gusto's totals with integer cents only, so that
 * gross_pay + employer_taxes == company_debit and net_pay + employee_taxes == gross_pay exactly.
 * The rates are mock assumptions (7.65% employer FICA, 22% employee withholding).
 */
export function payrollTotals(run: PayrollRun) {
  const debit = run.amount;
  const employerTaxes = Math.floor((debit * 765) / 10_765);
  const gross = debit - employerTaxes;
  const employeeTaxes = Math.floor((gross * 22) / 100);
  return {
    company_debit: dollars(debit),
    gross_pay: dollars(gross),
    employer_taxes: dollars(employerTaxes),
    employee_taxes: dollars(employeeTaxes),
    net_pay: dollars(gross - employeeTaxes),
    reimbursements: "0.00",
  };
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function payrolls(s: Snapshot): Item[] {
  return s.payroll.map((p) => ({
    payroll_uuid: p.id,
    company_uuid: s.companyId,
    check_date: p.date,
    processed: p.date <= s.asOf,
    pay_period: { start_date: addDays(p.date, -18), end_date: addDays(p.date, -5) },
    totals: payrollTotals(p),
  }));
}

const error = (status: number, key: string, message: string) =>
  json(status, { errors: [{ error_key: key, category: "invalid_attribute_value", message }] });

export const gustoRoute: VendorRoute = (rest, url, s) => {
  const m = rest.match(/^\/v1\/companies\/([^/]+)\/payrolls$/);
  if (!m) return null;
  if (decodeURIComponent(m[1] ?? "") !== s.companyId)
    return json(404, {
      errors: [{ error_key: "company_uuid", category: "not_found", message: "Company not found." }],
    });
  const page = intParam(url, "page", 1, 100_000) ?? 1;
  const per = intParam(url, "per", 1, 100) ?? 25;
  if (Number.isNaN(page) || Number.isNaN(per)) return error(422, "per", "page >= 1, per 1 to 100.");
  const items = sortBy(payrolls(s), "payroll_uuid");
  const pages = Math.max(1, Math.ceil(items.length / per));
  const headers: Record<string, string> = {
    "x-total-count": String(items.length),
    "x-total-pages": String(pages),
  };
  if (page < pages) {
    const next = new URL(url);
    next.searchParams.set("page", String(page + 1));
    next.searchParams.set("per", String(per));
    headers.link = `<${next.toString()}>; rel="next"`;
  }
  return json(200, items.slice((page - 1) * per, page * per), headers);
};
