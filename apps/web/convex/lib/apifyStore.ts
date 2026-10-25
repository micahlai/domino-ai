/**
 * The growing toolbox's Apify side (pure apart from the injected fetch). Capabilities an agent
 * can need, the Apify Store search that finds an actor for one (GET /v2/store, a free public
 * listing: https://docs.apify.com/api/v2/store-get), how an actor is picked from the results,
 * and the input Domino can build for the actors it knows how to run. Listing never runs an
 * actor; runs go through the capped reservations in fieldApify.ts.
 */
import { APIFY_ACTOR, ApifyError } from "./apify";

export type Capability = "web_search" | "website_check";

export type StoreActor = {
  actorId: string;
  name: string;
  description: string;
  url?: string;
  pricing?: string;
  users: number;
};

export const CAPABILITIES: Record<Capability, { label: string; query: string; seed?: StoreActor }> =
  {
    web_search: {
      label: "Public web search",
      query: "google search results scraper",
      seed: {
        actorId: APIFY_ACTOR.id,
        name: APIFY_ACTOR.name,
        description: "Google Search results: titles, links and snippets.",
        url: "https://apify.com/apify/google-search-scraper",
        users: 0,
      },
    },
    website_check: { label: "Company website check", query: "website content crawler" },
  };

/** Actors Domino can build an input for. Others can be added to the toolbox but not run. */
export const RUNNABLE = new Set<string>([APIFY_ACTOR.id, "apify/website-content-crawler"]);

const STORE = "https://api.apify.com/v2/store";
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Store items -> actors; malformed items are skipped. */
export function parseStore(body: unknown): { total: number; actors: StoreActor[] } {
  const root =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const data =
    root?.data && typeof root.data === "object" && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : null;
  if (!data || !Array.isArray(data.items)) throw new ApifyError("parse");
  const actors: StoreActor[] = [];
  for (const raw of data.items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const it = raw as Record<string, unknown>;
    const owner = str(it.username);
    const name = str(it.name);
    if (!owner || !name) continue;
    const stats =
      it.stats && typeof it.stats === "object" && !Array.isArray(it.stats)
        ? (it.stats as Record<string, unknown>)
        : null;
    const pricingInfo =
      it.currentPricingInfo &&
      typeof it.currentPricingInfo === "object" &&
      !Array.isArray(it.currentPricingInfo)
        ? (it.currentPricingInfo as Record<string, unknown>)
        : null;
    const pricing = str(pricingInfo?.pricingModel);
    actors.push({
      actorId: `${owner}/${name}`,
      name: clip(str(it.title) || name, 120),
      description: clip(str(it.description), 300),
      ...(str(it.url) && { url: clip(str(it.url), 300) }),
      ...(pricing && { pricing }),
      users:
        typeof stats?.totalUsers === "number" && Number.isFinite(stats.totalUsers)
          ? stats.totalUsers
          : 0,
    });
  }
  return { total: typeof data.total === "number" ? data.total : actors.length, actors };
}

/** One free Store search. The token is optional (the listing is public). */
export async function searchStore(
  query: string,
  opts: { token?: string; fetch?: Fetch; limit?: number } = {},
): Promise<{ total: number; actors: StoreActor[] }> {
  const fetchImpl: Fetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const params = new URLSearchParams({ search: query, limit: String(opts.limit ?? 10) });
  let res: Response;
  try {
    res = await fetchImpl(`${STORE}?${params}`, {
      headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
    });
  } catch {
    throw new ApifyError("http");
  }
  if (res.status === 429) throw new ApifyError("rate_limited");
  if (!res.ok) throw new ApifyError("http");
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApifyError("parse");
  }
  return parseStore(body);
}

/**
 * The actor to add for a capability: one Domino can run first, then official Apify actors, then
 * the most used; ties keep the Store's order. Undefined when the search found nothing.
 */
export function pickActor(actors: StoreActor[]): { actor: StoreActor; why: string } | undefined {
  const score = (a: StoreActor) =>
    (RUNNABLE.has(a.actorId) ? 2 : 0) + (a.actorId.startsWith("apify/") ? 1 : 0);
  const ranked = actors
    .map((a, i) => ({ a, i }))
    .sort((x, y) => score(y.a) - score(x.a) || y.a.users - x.a.users || x.i - y.i);
  const top = ranked[0]?.a;
  if (!top) return undefined;
  const why = RUNNABLE.has(top.actorId)
    ? "an official Apify actor Domino can run"
    : top.actorId.startsWith("apify/")
      ? "an official Apify actor"
      : "the most used match";
  return { actor: top, why };
}

/** Input for one page of a company website with the Website Content Crawler. */
export function websiteInput(url: string) {
  return {
    startUrls: [{ url }],
    maxCrawlPages: 1,
    maxCrawlDepth: 0,
    crawlerType: "cheerio",
    saveMarkdown: true,
    saveHtml: false,
    saveFiles: false,
    saveScreenshots: false,
  };
}

/**
 * A counterparty's own website among its search results: a result whose host contains the
 * name's letters (spaces and punctuation removed). Undefined when none does.
 */
export function websiteOf(name: string, urls: string[]): string | undefined {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (slug.length < 4) return undefined;
  for (const u of urls) {
    try {
      const host = new URL(u).hostname.replace(/^www\./, "").toLowerCase();
      if (host.replace(/[^a-z0-9]/g, "").includes(slug)) return `https://${host}/`;
    } catch {
      // not a URL
    }
  }
  return undefined;
}
