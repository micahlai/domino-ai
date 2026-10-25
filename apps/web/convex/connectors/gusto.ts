import { PayrollRunSchema } from "@domino/contracts";
import { z } from "zod";
import type { Fetcher, Skip, Translated } from "./types";
import { MAX_PAGES, cents, getJson, keepValid, localPath, parseEach } from "./vendorHttp";

/**
 * Gusto connector: payrolls with totals from the Gusto-shaped mock
 * (/vendor/gusto/v1/companies/:company_uuid/payrolls), following the Link rel="next" header.
 * A run's cash cost is company_debit (gross pay plus employer taxes); the translator checks
 * that the totals add up before trusting it.
 */
export type GustoRaw = { payrolls: unknown[]; pages: number };

const NEXT = /<([^>]+)>;\s*rel="next"/;

export async function fetchGusto(fetcher: Fetcher, companyUuid: string): Promise<GustoRaw> {
  const prefix = `/vendor/gusto/v1/companies/${encodeURIComponent(companyUuid)}/payrolls`;
  const payrolls: unknown[] = [];
  let path: string | null = `${prefix}?page=1&per=100`;
  let pages = 0;
  while (path) {
    if (++pages > MAX_PAGES) throw new Error("gusto payrolls did not finish paging");
    const { body, res } = await getJson(fetcher, path);
    payrolls.push(...z.array(z.unknown()).parse(body));
    const next = NEXT.exec(res.headers.get("link") ?? "")?.[1];
    path = next ? localPath(next, prefix) : null;
  }
  return { payrolls, pages };
}

const money = z.string().regex(/^-?\d+\.\d{2}$/);
const Payroll = z.object({
  payroll_uuid: z.string(),
  check_date: z.string(),
  processed: z.boolean(),
  totals: z.object({
    company_debit: money,
    gross_pay: money,
    employer_taxes: money,
    employee_taxes: money,
    net_pay: money,
  }),
});

export interface GustoLinks {
  /** Processed runs, to tie out against the bank debit with the same reference. */
  processed: { id: string; date: string; amount: number }[];
}

export function translateGusto(raw: GustoRaw): Translated<GustoLinks> {
  const skipped: Skip[] = [];
  const rows = parseEach(Payroll, raw.payrolls, "Gusto payroll", skipped).filter((p) => {
    const t = p.totals;
    const adds =
      cents(t.gross_pay) + cents(t.employer_taxes) === cents(t.company_debit) &&
      cents(t.net_pay) + cents(t.employee_taxes) === cents(t.gross_pay);
    if (!adds) skipped.push({ id: p.payroll_uuid, reason: "payroll totals do not add up" });
    return adds;
  });
  const payroll = keepValid(
    PayrollRunSchema,
    rows.map((p) => ({
      id: p.payroll_uuid,
      date: p.check_date,
      amount: cents(p.totals.company_debit),
    })),
    "payroll run",
    skipped,
  );
  return {
    lists: { payroll },
    links: {
      processed: rows
        .filter((p) => p.processed)
        .map((p) => ({
          id: p.payroll_uuid,
          date: p.check_date,
          amount: cents(p.totals.company_debit),
        })),
    },
    skipped,
    recordsIn: raw.payrolls.length,
    notes: [],
  };
}
