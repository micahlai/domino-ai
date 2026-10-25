/**
 * Real Apify actor runs for the Field research agent: public web risk signals (layoffs, funding,
 * bankruptcy, lawsuits, acquisitions, leadership changes) about the company's top customers and
 * vendors. One run of the public Google Search Results Scraper per counterparty, through the
 * official Apify API v2 (https://docs.apify.com/api/v2):
 *   POST /v2/acts/apify~google-search-scraper/runs?waitForFinish=60&timeout=..&maxTotalChargeUsd=..
 *   GET  /v2/actor-runs/{runId}?waitForFinish=60   (only while the run is not finished)
 *   GET  /v2/datasets/{datasetId}/items?clean=true&format=json&limit=..
 * The token travels in the Authorization header only and never appears in errors or logs.
 *
 * Simulated customers have fictional names. A search result counts as a signal only when its
 * title or snippet contains the searched name; otherwise the honest outcome is "no public
 * signals found". Nothing here invents a result. Callers enforce the run caps and the cache
 * (fieldApify.ts); this file is pure apart from the injected fetch.
 */

export const APIFY_ACTOR = {
  /** Tool id on log rows (owner/name). */
  id: "apify/google-search-scraper",
  /** Path form for the API (owner~name). */
  path: "apify~google-search-scraper",
  /** Shown as the tool label on the map. */
  name: "Google Search Results Scraper",
} as const;

export const APIFY_LIMITS = {
  /** Live actor runs per analyst run (one ingest). Cached counterparties cost nothing. */
  runsPerAnalystRun: 3,
  /** Live actor runs per UTC day across all companies (each about $0.005 at list price). */
  runsPerDay: 20,
  /** Search results kept per counterparty. */
  maxResults: 5,
  /** Actor run timeout on Apify's side, seconds. */
  timeoutSecs: 60,
  /** Per-run spending cap passed to Apify; the actor's minimum allowed value. */
  maxTotalChargeUsd: 0.5,
  /** One cached search answers for this long. */
  cacheMs: 24 * 60 * 60_000,
  /** Counterparties considered per analyst run (top customers and vendors, interleaved). */
  counterparties: 6,
} as const;

export const APIFY_TOKEN_ENV = "APIFY_TOKEN";
const API = "https://api.apify.com/v2";

export type SignalKind =
  | "layoffs"
  | "funding"
  | "bankruptcy"
  | "lawsuit"
  | "acquisition"
  | "leadership";

export type Signal = {
  title: string;
  url: string;
  /** Host name of the result, e.g. "reuters.com". */
  source: string;
  /** Date as Google shows it ("Oct 3, 2026", "3 days ago"), when it shows one. */
  date?: string;
  snippet: string;
  kinds: SignalKind[];
};

export type ActorRun = {
  remoteRunId: string;
  datasetId: string;
  status: string;
  /** Dataset items (one per Google results page). */
  itemCount: number;
  /** Organic results across those items, before the name filter. */
  resultCount: number;
  usageUsd?: number;
  signals: Signal[];
};

export type ApifyFailure =
  | "config"
  | "auth"
  | "payment"
  | "rate_limited"
  | "timeout"
  | "run_failed"
  | "http"
  | "parse";

export class ApifyError extends Error {
  constructor(
    readonly category: ApifyFailure,
    readonly remoteRunId?: string,
  ) {
    super(`Apify ${category}${remoteRunId ? ` (run ${remoteRunId})` : ""}`);
  }
}

// Descriptive words the simulated books append to vendor names ("Stratus Cloud hosting").
const TRAILING = new Set(
  [
    "software",
    "services",
    "service",
    "hosting",
    "contractors",
    "agency",
    "statement",
    "remittance",
    "rent",
    "office",
    "sales",
    "tax",
    "card",
    "equipment",
    "hardware",
    "legal",
    "accounting",
    "marketing",
    "design",
    "qa",
    "data",
    "enrichment",
    "warehouse",
    "monitoring",
    "workspace",
    "development",
    "capitalized",
    "term",
    "loan",
    "principal",
    "interest",
    "payment",
    "payments",
  ].map((w) => w.toLowerCase()),
);

/** The name to search: parentheses and trailing descriptive words removed, at least one word. */
export function searchName(name: string): string {
  const words = name
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && TRAILING.has((words.at(-1) ?? "").toLowerCase())) words.pop();
  return words.join(" ").trim() || name.trim();
}

/**
 * A category the books use instead of a business ("Operations vendors", "Cloud provider",
 * "SOFTWARE VENDORS"): several words, nothing capitalized after the first, or all capitals.
 * Searching it would only spend a run on noise.
 */
export function isGenericName(name: string): boolean {
  const words = searchName(name)
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w));
  if (words.length < 2) return false;
  if (words.join(" ") === words.join(" ").toUpperCase()) return true;
  return words.slice(1).every((w) => w === w.toLowerCase());
}

/** Cache key: the search name, lower case, single spaces. */
export const signalKey = (name: string) => normalize(searchName(name));

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&]+/gu, " ")
    .trim();

export function signalQuery(name: string): string {
  return `"${searchName(name)}" (layoffs OR funding OR bankruptcy OR lawsuit OR acquisition OR CEO)`;
}

export function actorInput(name: string) {
  return {
    queries: signalQuery(name),
    maxPagesPerQuery: 1,
    countryCode: "us",
    languageCode: "en",
    quickDateRange: "y1",
    mobileResults: false,
    saveHtml: false,
    saveHtmlToKeyValueStore: false,
    includeUnfilteredResults: false,
    includeIcons: false,
  };
}

const KINDS: [SignalKind, RegExp][] = [
  ["layoffs", /\blay(?:s|ing)?[ -]?offs?\b|\blaid off\b|\bjob cuts?\b|\bredundanc/i],
  ["funding", /\bfunding\b|\braise[sd]?\b|\bseries [a-f]\b|\binvestment\b|\bipo\b/i],
  ["bankruptcy", /\bbankrupt|\bchapter (?:7|11)\b|\binsolven|\breceivership\b|\bliquidat/i],
  ["lawsuit", /\blawsuits?\b|\bsue[sd]?\b|\blitigation\b|\bclass action\b|\bsettle(?:s|d|ment)\b/i],
  ["acquisition", /\bacquir|\bacquisition\b|\bmerger\b|\bbuyout\b|\btakeover\b/i],
  ["leadership", /\bceo\b|\bcfo\b|\bsteps? down\b|\bresign|\bappoint|\bnames new\b/i],
];

const DATE_PREFIX =
  /^((?:[A-Z][a-z]{2} \d{1,2}, \d{4})|(?:\d+ (?:minute|hour|day|week|month|year)s? ago))\s*[—–-]\s*/;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Dataset items of the Google Search Results Scraper -> signals that mention the name. Items
 * without organicResults are ignored; malformed results are skipped, never repaired.
 */
export function parseSearchItems(
  items: unknown,
  name: string,
): { itemCount: number; resultCount: number; signals: Signal[] } {
  if (!Array.isArray(items)) throw new ApifyError("parse");
  const phrase = normalize(searchName(name));
  const signals: Signal[] = [];
  let resultCount = 0;
  const seen = new Set<string>();
  for (const item of items) {
    const organic = (item as { organicResults?: unknown })?.organicResults;
    if (!Array.isArray(organic)) continue;
    for (const r of organic) {
      const row = r as Record<string, unknown>;
      const url = str(row.url);
      const title = str(row.title);
      if (!url || !title) continue;
      resultCount += 1;
      let snippet = str(row.description);
      // Recorded runs give ISO timestamps ("2026-02-23T12:00:00.000Z"); keep the day.
      let date = str(row.date).replace(/^(\d{4}-\d{2}-\d{2})T[\d:.]+Z$/, "$1") || undefined;
      const prefix = DATE_PREFIX.exec(snippet);
      if (prefix) {
        date ??= prefix[1];
        snippet = snippet.slice(prefix[0].length);
      }
      if (!phrase || !` ${normalize(`${title} ${snippet}`)} `.includes(` ${phrase} `)) continue;
      if (seen.has(url) || signals.length >= APIFY_LIMITS.maxResults) continue;
      seen.add(url);
      const text = `${title} ${snippet}`;
      signals.push({
        title: clip(title, 200),
        url: clip(url, 500),
        source: hostOf(url),
        ...(date && { date: clip(date, 40) }),
        snippet: clip(snippet, 300),
        kinds: KINDS.filter(([, re]) => re.test(text)).map(([k]) => k),
      });
    }
  }
  return { itemCount: items.length, resultCount, signals };
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);

type RunData = {
  id?: unknown;
  status?: unknown;
  defaultDatasetId?: unknown;
  usageTotalUsd?: unknown;
};

async function call(fetchImpl: Fetch, token: string, path: string, init: RequestInit = {}) {
  let res: Response;
  try {
    res = await fetchImpl(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  } catch {
    throw new ApifyError("http");
  }
  if (res.status === 401 || res.status === 403) throw new ApifyError("auth");
  if (res.status === 402) throw new ApifyError("payment");
  if (res.status === 429) throw new ApifyError("rate_limited");
  if (!res.ok) throw new ApifyError("http");
  try {
    return (await res.json()) as unknown;
  } catch {
    throw new ApifyError("parse");
  }
}

const runOf = (body: unknown): RunData => {
  const data = (body as { data?: RunData } | null)?.data;
  if (!data || typeof data.id !== "string") throw new ApifyError("parse");
  return data;
};

/**
 * One actor run for one counterparty: start (waits up to 60 s), at most `polls` more waits of
 * 60 s, then the dataset items. A run that is still going is aborted and reported as timeout.
 */
export async function runSignalSearch(
  token: string,
  name: string,
  opts: { fetch?: Fetch; polls?: number } = {},
): Promise<ActorRun> {
  const fetchImpl: Fetch = opts.fetch ?? ((input, init) => fetch(input, init));
  if (!token.trim()) throw new ApifyError("config");
  const params = new URLSearchParams({
    waitForFinish: "60",
    timeout: String(APIFY_LIMITS.timeoutSecs),
    maxTotalChargeUsd: String(APIFY_LIMITS.maxTotalChargeUsd),
  });
  let run = runOf(
    await call(fetchImpl, token, `/acts/${APIFY_ACTOR.path}/runs?${params}`, {
      method: "POST",
      body: JSON.stringify(actorInput(name)),
    }),
  );
  const id = run.id as string;
  for (let i = 0; i < (opts.polls ?? 1) && !TERMINAL.has(String(run.status)); i++)
    run = runOf(await call(fetchImpl, token, `/actor-runs/${id}?waitForFinish=60`));
  if (!TERMINAL.has(String(run.status))) {
    await call(fetchImpl, token, `/actor-runs/${id}/abort`, { method: "POST" }).catch(() => null);
    throw new ApifyError("timeout", id);
  }
  if (run.status === "TIMED-OUT") throw new ApifyError("timeout", id);
  if (run.status !== "SUCCEEDED") throw new ApifyError("run_failed", id);
  const datasetId = typeof run.defaultDatasetId === "string" ? run.defaultDatasetId : "";
  if (!datasetId) throw new ApifyError("parse", id);
  const items = await call(
    fetchImpl,
    token,
    `/datasets/${datasetId}/items?clean=true&format=json&limit=5`,
  ).catch((e: unknown) => {
    throw e instanceof ApifyError ? new ApifyError(e.category, id) : new ApifyError("http", id);
  });
  let parsed: ReturnType<typeof parseSearchItems>;
  try {
    parsed = parseSearchItems(items, name);
  } catch {
    throw new ApifyError("parse", id);
  }
  // Charges settle just after the run finishes, so read the final cost once more (free call).
  const settled = await call(fetchImpl, token, `/actor-runs/${id}`)
    .then(runOf)
    .catch(() => run);
  if (typeof settled.usageTotalUsd === "number") run = settled;
  return {
    remoteRunId: id,
    datasetId,
    status: "SUCCEEDED",
    ...parsed,
    ...(typeof run.usageTotalUsd === "number" && { usageUsd: run.usageTotalUsd }),
  };
}

/** One line per signal for the map and the research report. */
export function signalLines(name: string, signals: Signal[]): string[] {
  if (signals.length === 0) return [`No public signals found for ${name}`];
  return signals.map(
    (s) =>
      `${s.title} (${[s.source, s.date].filter(Boolean).join(", ")})${
        s.kinds.length > 0 ? ` [${s.kinds.join(", ")}]` : ""
      }`,
  );
}

// "$20M" in a headline would read as a new money amount in the CREAO note; the facts redact it.
const MONEY = /-?\$\s?\d[\d,]*(?:\.\d+)?\s?[KMB]?/gi;

/**
 * Compact facts for the CREAO counterparty job: at most two headlines, money amounts redacted,
 * and the caveat that a same-name business may not be this counterparty.
 */
export function signalFacts(
  search: { remoteRunId: string; fetchedAt: string; signals: Signal[] } | undefined,
): string[] {
  if (!search) return [];
  const day = search.fetchedAt.slice(0, 10);
  if (search.signals.length === 0)
    return [`Public web search (Apify run ${search.remoteRunId}, ${day}): no public signals found`];
  return [
    `Public web search (Apify run ${search.remoteRunId}, ${day}): ${search.signals.length} results mention this name; a same-name business may be a different company`,
    ...search.signals
      .slice(0, 2)
      .map(
        (s) =>
          `Headline${s.kinds.length > 0 ? ` (${s.kinds.join(", ")})` : ""}: ${clip(
            s.title.replace(MONEY, "[amount]"),
            140,
          )} (${[s.source, s.date].filter(Boolean).join(", ")})`,
      ),
  ];
}

/** Top customers and vendors, interleaved by rank (customer 1, vendor 1, customer 2, ...). */
export function searchOrder<T extends { role: "customer" | "vendor"; rank: number }>(
  counterparties: T[],
): T[] {
  return [...counterparties]
    .sort((a, b) => a.rank - b.rank || (a.role === b.role ? 0 : a.role === "customer" ? -1 : 1))
    .slice(0, APIFY_LIMITS.counterparties);
}
