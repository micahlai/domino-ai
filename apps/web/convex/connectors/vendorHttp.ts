import type { z } from "zod";
import type { Fetcher, Skip } from "./types";

/** Reads one mock response as JSON; non-2xx answers become errors carrying the vendor body. */
export async function getJson(
  fetcher: Fetcher,
  path: string,
): Promise<{ body: unknown; res: Response }> {
  const res = await fetcher(path);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new VendorError(path.split("?")[0] ?? path, res.status, body);
  return { body, res };
}

export class VendorError extends Error {
  constructor(
    readonly endpoint: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`${endpoint} answered ${status}`);
  }
}

/** Only path and query of a vendor "next" URL are followed, so a page link can never leave the mock. */
export function localPath(next: string, prefix: string): string {
  const u = new URL(next, "http://mocks.local");
  if (!u.pathname.startsWith(prefix)) throw new Error(`next page link leaves ${prefix}`);
  return `${u.pathname}${u.search}`;
}

export const MAX_PAGES = 500;

/** Decimal dollars (number or string, at most 2 places) to integer cents, exactly. */
export function cents(value: number | string): number {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(typeof value === "number" ? String(value) : value);
  if (!m) throw new Error(`not an exact dollar amount: ${value}`);
  const c = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(c)) throw new Error("amount is too large to be exact");
  return m[1] && c !== 0 ? -c : c;
}

/** Unix seconds to the UTC calendar date. */
export const day = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

/** The calendar date at the start of an ISO datetime ("2026-11-02T00:00:00Z" -> "2026-11-02"). */
export const dateOf = (iso: string) => iso.slice(0, 10);

/**
 * Validates each vendor record; a record that does not match is skipped with a reason
 * instead of failing the whole pull.
 */
export function parseEach<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  items: unknown[],
  what: string,
  skipped: Skip[],
  idOf: (raw: unknown) => string = rawId,
): T[] {
  const out: T[] = [];
  for (const item of items) {
    const r = schema.safeParse(item);
    if (r.success) out.push(r.data);
    else skipped.push({ id: idOf(item), reason: `does not match the ${what} shape` });
  }
  return out;
}

/** Canonical-contract check per record: anything the contract refuses is skipped, not kept. */
export function keepValid<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  records: { id: string }[],
  what: string,
  skipped: Skip[],
): T[] {
  const out: T[] = [];
  for (const record of records) {
    const r = schema.safeParse(record);
    if (r.success) out.push(r.data);
    else
      skipped.push({
        id: record.id,
        reason: `${what} fails the Domino contract at ${r.error.issues[0]?.path.join(".") || "record"}`,
      });
  }
  return out;
}

function rawId(raw: unknown): string {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const key of ["id", "Id", "transaction_id", "payroll_uuid", "account_id"])
      if (typeof r[key] === "string") return r[key] as string;
  }
  return "unknown";
}
