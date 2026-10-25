import { type Snapshot, SnapshotSchema } from "@domino/contracts";
import { DOCUMENTS } from "./docs";
import { type SourceName, openapi } from "./openapi";
import * as src from "./sources";
import { isVendorPath, routeVendor } from "./vendors";

/**
 * Mock source APIs as one Fetch handler: native Request in, Response out, so the Node server
 * and a later Convex HTTP route can share it. No fs, env or network here.
 * A documented mock contract, not compatibility with the real providers.
 */
export interface MockHandlerOptions {
  /** Server-side key every request must send as x-api-key. Missing or empty fails closed. */
  apiKey: string | undefined;
  /** Observable snapshot only. Extra keys (private world state) are stripped by the parse. */
  snapshot: () => Snapshot | Promise<Snapshot>;
}

export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 10;

type Item = Record<string, unknown>;
type Envelope = (data: Item[], next: Next, path: string) => Response;
interface Next {
  /** Last returned id when another page exists */
  lastId: string | null;
  cursor: (id: string) => string;
}
interface Collection {
  source: SourceName;
  items: (s: Snapshot) => Item[];
  idKey: string;
  /** Query parameter carrying the cursor */
  cursorParam: string;
  limitParam: string;
  /** Stripe pages by raw object id; others use opaque cursors */
  rawIdCursor?: boolean;
  envelope: Envelope;
}

const stripeList: Envelope = (data, next, path) =>
  json(200, { object: "list", url: path, data, has_more: next.lastId !== null });
const keyed =
  (key: string): Envelope =>
  (data, next) =>
    json(200, { [key]: data, next_cursor: next.lastId && next.cursor(next.lastId) });

function stripe(items: Collection["items"]): Collection {
  return {
    source: "stripe",
    items,
    idKey: "id",
    cursorParam: "starting_after",
    limitParam: "limit",
    rawIdCursor: true,
    envelope: stripeList,
  };
}

const COLLECTIONS: Record<string, Collection> = {
  "/stripe/v1/customers": stripe(src.stripeCustomers),
  "/stripe/v1/invoices": stripe(src.stripeInvoices),
  "/stripe/v1/payouts": stripe(src.stripePayouts),
  "/stripe/v1/pending_payouts": stripe(src.stripePendingPayouts),
  "/stripe/v1/balance_transactions": stripe(src.stripeBalanceTransactions),
  "/stripe/v1/billing_plans": stripe(src.stripeBillingPlans),
  "/crm/crm/v3/objects/deals": {
    source: "crm",
    items: src.crmDeals,
    idKey: "id",
    cursorParam: "after",
    limitParam: "limit",
    envelope: (data, next) =>
      json(200, {
        results: data,
        ...(next.lastId && { paging: { next: { after: next.cursor(next.lastId) } } }),
      }),
  },
  "/cards/developer/v1/transactions": {
    source: "cards",
    items: src.cardTransactions,
    idKey: "id",
    cursorParam: "start",
    limitParam: "page_size",
    envelope: (data, next) =>
      json(200, { data, page: { next: next.lastId && next.cursor(next.lastId) } }),
  },
  "/books/v1/bills": {
    source: "books",
    items: src.bookBills,
    idKey: "Id",
    cursorParam: "cursor",
    limitParam: "limit",
    envelope: keyed("Bill"),
  },
  "/books/v1/accounts": {
    source: "books",
    items: src.bookAccounts,
    idKey: "Id",
    cursorParam: "cursor",
    limitParam: "limit",
    envelope: keyed("Account"),
  },
  "/bank/v1/transactions": {
    source: "bank",
    items: src.bankTransactions,
    idKey: "id",
    cursorParam: "cursor",
    limitParam: "limit",
    envelope: keyed("transactions"),
  },
  "/docs/documents": {
    source: "docs",
    items: () =>
      DOCUMENTS.map(({ id, title, filename }) => ({
        id,
        title,
        filename,
        content_type: "text/plain",
        text_url: `/docs/documents/${id}/text`,
        synthetic: true,
      })),
    idKey: "id",
    cursorParam: "cursor",
    limitParam: "limit",
    envelope: keyed("documents"),
  },
};

const PAYROLL: Omit<Collection, "items"> = {
  source: "payroll",
  idKey: "payroll_uuid",
  cursorParam: "cursor",
  limitParam: "limit",
  envelope: (data, next) => {
    const response = json(200, data);
    if (next.lastId) response.headers.set("x-next-cursor", next.cursor(next.lastId));
    return response;
  },
};

const SOURCES: SourceName[] = ["stripe", "crm", "cards", "books", "payroll", "bank", "docs"];
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-domino-synthetic": "true",
    },
  });
}

function text(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-domino-synthetic": "true",
    },
  });
}

const fail = (status: number, code: string, message: string) =>
  json(status, { error: { code, message } });

/** Constant-time comparison so response timing does not reveal the key. */
function sameKey(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function encodeCursor(path: string, id: string): string {
  return btoa(encodeURIComponent(JSON.stringify([path, id])))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function decodeCursor(path: string, cursor: string): string {
  try {
    if (!/^[A-Za-z0-9_-]{1,1024}$/.test(cursor)) throw new Error();
    const parsed: unknown = JSON.parse(
      decodeURIComponent(atob(cursor.replaceAll("-", "+").replaceAll("_", "/"))),
    );
    if (Array.isArray(parsed) && parsed.length === 2 && parsed[0] === path) {
      const id = parsed[1];
      if (typeof id === "string") return id;
    }
  } catch {}
  throw new HttpError(400, "invalid_cursor", "The page cursor is not valid for this list.");
}

function single(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);
  if (values.length > 1) throw new HttpError(400, "invalid_request", `Repeated ${name}.`);
  return values[0];
}

function parseLimit(raw: string | undefined, name: string): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const limit = /^\d{1,3}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(limit >= 1 && limit <= MAX_LIMIT))
    throw new HttpError(400, "invalid_limit", `${name} must be an integer from 1 to ${MAX_LIMIT}.`);
  return limit;
}

function listPage(c: Omit<Collection, "items">, all: Item[], path: string, url: URL): Response {
  const limit = parseLimit(single(url.searchParams, c.limitParam), c.limitParam);
  const rawCursor = single(url.searchParams, c.cursorParam);
  // Code-unit order by id is stable across reloads and inserts.
  const items = [...all].sort((x, y) => {
    const a = String(x[c.idKey]);
    const b = String(y[c.idKey]);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  let start = 0;
  if (rawCursor !== undefined) {
    const id = c.rawIdCursor ? rawCursor : decodeCursor(path, rawCursor);
    const at = items.findIndex((item) => item[c.idKey] === id);
    if (at < 0) throw new HttpError(400, "invalid_cursor", "The page cursor is not in this list.");
    start = at + 1;
  }
  const data = items.slice(start, start + limit);
  const last = data.at(-1);
  const hasMore = start + limit < items.length;
  return c.envelope(
    data,
    {
      lastId: hasMore && last ? String(last[c.idKey]) : null,
      cursor: (id) => encodeCursor(path, id),
    },
    path,
  );
}

async function route(path: string, url: URL, load: () => Promise<Snapshot>): Promise<Response> {
  if (path === "/health") {
    const s = await load();
    return json(200, { ok: true, synthetic: true, companyId: s.companyId, asOf: s.asOf });
  }
  const source = path.match(/^\/([a-z]+)\/openapi\.json$/)?.[1];
  if (source && (SOURCES as string[]).includes(source))
    return json(200, openapi(source as SourceName));

  if (isVendorPath(path)) {
    const vendor = routeVendor(path, url, await load());
    if (vendor) return vendor;
  }
  const collection = COLLECTIONS[path];
  if (collection) return listPage(collection, collection.items(await load()), path, url);

  const payroll = path.match(/^\/payroll\/v1\/companies\/([^/]+)\/payrolls$/);
  if (payroll?.[1] !== undefined) {
    const s = await load();
    if (payroll[1] !== s.companyId)
      throw new HttpError(404, "not_found", "No company with that id.");
    return listPage(PAYROLL, src.payrolls(s), path, url);
  }

  const doc = path.match(/^\/docs\/documents\/([^/]+)\/text$/);
  if (doc?.[1] !== undefined) {
    const id = doc[1];
    const found = ID_PATTERN.test(id) ? DOCUMENTS.find((d) => d.id === id) : undefined;
    if (!found) throw new HttpError(404, "not_found", "No document with that id.");
    return text(found.text);
  }
  throw new HttpError(404, "not_found", "No route for this path.");
}

export function createMockHandler(
  options: MockHandlerOptions,
): (req: Request) => Promise<Response> {
  const load = async () => {
    try {
      return SnapshotSchema.parse(await options.snapshot());
    } catch {
      throw new HttpError(503, "data_unavailable", "Company data could not be loaded.");
    }
  };
  return async (req) => {
    const expected = options.apiKey;
    if (!expected) return fail(503, "not_configured", "The mock API key is not configured.");
    const given = req.headers.get("x-api-key");
    if (given === null || !sameKey(given, expected))
      return fail(401, "unauthorized", "Missing or invalid x-api-key header.");
    if (req.method !== "GET") {
      const response = fail(405, "method_not_allowed", "Only GET is supported.");
      response.headers.set("allow", "GET");
      return response;
    }
    try {
      const url = new URL(req.url);
      return await route(url.pathname, url, load);
    } catch (error) {
      if (error instanceof HttpError) return fail(error.status, error.code, error.message);
      return fail(500, "internal", "Unexpected mock server error.");
    }
  };
}
