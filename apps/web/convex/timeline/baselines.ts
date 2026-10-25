import {
  BOUNDARY_INTEGER_MAX,
  type CompanyModel,
  CompanyModelSchema,
  type Constraint,
  ConstraintSchema,
  type Domino,
  DominoSchema,
  type Forecast,
  ForecastSchema,
  type HistoryWeek,
  HistoryWeekSchema,
  type PastEvent,
  PastEventSchema,
  type Snapshot,
  type WeeklySeedV1,
  canonicalJson,
  contentHashPreimage,
  parseWeeklySeedJson,
} from "@domino/contracts";
import { engine } from "@domino/engine";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import type { Doc } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";

// TL1 saved weekly baseline. Interface: kb/features/timeline/TL1-interface.md.
// The model and constraints are Timeline-local assumptions the person reviewed, not Field data.
// All validation runs before the single insert, so a rejected request writes nothing.

/** Frozen calculation method. Bump when the engine call sequence or stored outputs change. */
export const METHOD_VERSION = "timeline_weekly_baseline@1.0.0";
/** Weeks of real bank history saved for the past side of the timeline (build-spec §3). */
const HISTORY_WEEKS = 26;

// Bounds: a saved row must stay well under Convex's 1 MiB document limit.
const MAX_SEED_TEXT = 900_000;
const MAX_CANONICAL_SEED = 600_000;
const MAX_ASSUMPTION_TEXT = 64 * 1024;
const MAX_NOTE = 2_000;
const MAX_CONSTRAINTS = 32;
const MAX_LIST = 64;
const MAX_DAYS = 3_660;
const MAX_RUNWAY_MONTHS = 120;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;

export type SavedBaseline = {
  runId: string;
  companyId: string;
  companyName: string;
  seedHash: string;
  inputHash: string;
  methodVersion: string;
  assumptionNote: string;
  model: CompanyModel;
  constraints: Constraint[];
  seed: WeeklySeedV1;
  forecast: Forecast;
  dominoes: Domino[];
  history: HistoryWeek[];
  pastEvents: PastEvent[];
  savedAt: string;
};

function reject(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const firstIssue = (e: z.ZodError) => {
  const i = e.issues[0];
  return i ? `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}` : "invalid";
};

/** Bounded JSON text -> schema parse that must equal its input (no stripped unknown fields). */
function parseExactJson<T extends z.ZodTypeAny>(
  label: string,
  schema: T,
  text: string,
): z.output<T> {
  if (text.length > MAX_ASSUMPTION_TEXT) reject("INVALID_INPUT", `${label} JSON is too large`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    reject("INVALID_INPUT", `${label} is not valid JSON`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) reject("INVALID_INPUT", `${label}: ${firstIssue(parsed.error)}`);
  if (canonicalJson(raw) !== canonicalJson(parsed.data))
    reject("INVALID_INPUT", `${label} has fields that are not part of the contract`);
  return parsed.data;
}

const isCents = (n: number) => Number.isSafeInteger(n) && Math.abs(n) <= BOUNDARY_INTEGER_MAX;
const between = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi;
const blankOrLong = (s: string, max = 200) => s.trim().length === 0 || s.length > max;

function checkModel(model: CompanyModel, snapshot: Snapshot) {
  const bad = (message: string): never => reject("INVALID_INPUT", `Model: ${message}`);
  if (!Number.isSafeInteger(model.version)) bad("version must be a safe integer");
  const customers = new Set(snapshot.customers.map((c) => c.id));
  const delays = Object.entries(model.customerDelayDays);
  if (delays.length > snapshot.customers.length) bad("too many customer delays");
  for (const [customerId, d] of delays) {
    if (!customers.has(customerId)) bad(`customer ${customerId} is not in the seed`);
    if (!between(d.mean, -365, MAX_DAYS) || !between(d.p90, -365, MAX_DAYS))
      bad(`delay days for ${customerId} are out of range`);
    if (!Number.isSafeInteger(d.samples)) bad(`samples for ${customerId} must be an integer`);
  }
  if (model.recurringSpend.length > MAX_LIST) bad("too many recurring spend items");
  const labels = new Set<string>();
  for (const s of model.recurringSpend) {
    if (blankOrLong(s.label)) bad("recurring spend needs a short label");
    // The engine uses the label as the item id, so a repeat would be ambiguous.
    if (labels.has(s.label)) bad(`recurring spend label "${s.label}" is repeated`);
    labels.add(s.label);
    if (!isCents(s.amount) || s.amount <= 0)
      bad(`recurring spend "${s.label}" must be positive integer cents`);
    if (s.everyDays > 366) bad(`recurring spend "${s.label}" repeats less than once a year`);
  }
  if (model.rules.length > MAX_LIST) bad("too many rules");
}

function checkConstraints(constraints: Constraint[], snapshot: Snapshot) {
  const bad = (message: string): never => reject("INVALID_INPUT", `Constraints: ${message}`);
  if (constraints.length > MAX_CONSTRAINTS) bad("too many rules");
  const ids = new Set<string>();
  for (const c of constraints) {
    if (ids.has(c.id)) bad(`rule id ${c.id} is repeated`);
    ids.add(c.id);
    if (blankOrLong(c.label)) bad(`rule ${c.id} needs a short label`);
    if (c.kind === "min_cash" && !isCents(c.limit)) bad(`rule ${c.id} limit must be integer cents`);
    if (c.kind === "min_runway_months" && !between(c.limit, 0, MAX_RUNWAY_MONTHS))
      bad(`rule ${c.id} runway months must be 0 to ${MAX_RUNWAY_MONTHS}`);
    if (c.kind === "pay_by_date") {
      if (c.billId === undefined) bad(`rule ${c.id} must name a bill`);
      const matches = snapshot.bills.filter((b) => b.id === c.billId).length;
      if (matches !== 1) bad(`rule ${c.id} bill ${c.billId} must exist exactly once in the seed`);
      if (c.limit > MAX_DAYS) bad(`rule ${c.id} allows too many late days`);
    }
  }
}

async function parseSeed(seedJson: string) {
  if (seedJson.length > MAX_SEED_TEXT) reject("INVALID_SEED", "Seed JSON is too large");
  const parsed = parseWeeklySeedJson(seedJson);
  if (!parsed.success) reject("INVALID_SEED", `Seed: ${firstIssue(parsed.error)}`);
  const seed = parsed.data;
  const seedText = canonicalJson(seed);
  if (seedText.length > MAX_CANONICAL_SEED) reject("INVALID_SEED", "Seed is too large to save");
  if ((await sha256Hex(contentHashPreimage(seed))) !== seed.contentHash)
    reject("INVALID_SEED", "Seed contentHash does not match its content");
  return { seed, seedText };
}

const runIdFor = async (companyId: string, requestId: string) =>
  `timeline:baseline/${(await sha256Hex(canonicalJson([companyId, requestId]))).slice(0, 40)}`;

/** Validate, compute with the engine, and freeze one baseline. Retries return the saved run. */
export const save = mutation({
  args: {
    requestId: v.string(),
    seedJson: v.string(),
    modelJson: v.string(),
    constraintsJson: v.string(),
    assumptionNote: v.string(),
    reviewed: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (!REQUEST_ID.test(args.requestId))
      reject("INVALID_REQUEST", "requestId must be 8-128 letters, digits, '.', '_' or '-'");
    if (!args.reviewed) reject("NOT_REVIEWED", "Review the assumptions before saving");
    const assumptionNote = args.assumptionNote.trim();
    if (assumptionNote.length === 0 || assumptionNote.length > MAX_NOTE)
      reject("INVALID_INPUT", `Assumption note must be 1-${MAX_NOTE} characters`);

    const { seed, seedText } = await parseSeed(args.seedJson);
    const model = parseExactJson("Model", CompanyModelSchema, args.modelJson);
    const constraints = parseExactJson(
      "Constraints",
      z.array(ConstraintSchema),
      args.constraintsJson,
    );
    checkModel(model, seed.snapshot);
    checkConstraints(constraints, seed.snapshot);

    const companyId = seed.company.id;
    const seedHash = seed.contentHash;
    const inputHash = await sha256Hex(
      canonicalJson({
        seedHash,
        model,
        constraints,
        assumptionNote,
        methodVersion: METHOD_VERSION,
      }),
    );

    const prior = await ctx.db
      .query("timelineBaselines")
      .withIndex("by_company_and_requestId", (q) =>
        q.eq("companyId", companyId).eq("requestId", args.requestId),
      )
      .unique();
    if (prior) {
      if (prior.inputHash !== inputHash)
        reject("REQUEST_CONFLICT", "This requestId was already used with different inputs");
      return { runId: prior.runId, companyId, created: false };
    }
    // One seed id must name one content; a second content under the same id is ambiguous.
    const sameSeedId = await ctx.db
      .query("timelineBaselines")
      .withIndex("by_company_and_seedId", (q) => q.eq("companyId", companyId).eq("seedId", seed.id))
      .first();
    if (sameSeedId && sameSeedId.seedHash !== seedHash)
      reject("SEED_CONFLICT", "A different seed was already saved under this seed id");

    // Baseline: no scenario changes. Scheduled items annotate records the engine already
    // forecasts, so they are never added as extra cash.
    const forecast = ForecastSchema.parse(engine.forecast(seed.snapshot, model, []));
    const dominoes = z
      .array(DominoSchema)
      .parse(engine.dominoes(forecast, constraints, seed.snapshot, { model, changes: [] }));
    const history = z.array(HistoryWeekSchema).parse(engine.history(seed.snapshot, HISTORY_WEEKS));
    const pastEvents = z.array(PastEventSchema).parse(engine.pastEvents(seed.snapshot, model));

    const runId = await runIdFor(companyId, args.requestId);
    await ctx.db.insert("timelineBaselines", {
      runId,
      companyId,
      requestId: args.requestId,
      seedId: seed.id,
      seedHash,
      inputHash,
      methodVersion: METHOD_VERSION,
      assumptionNote,
      seedText,
      model,
      constraints,
      forecast,
      dominoes,
      history,
      pastEvents,
      savedAt: new Date().toISOString(),
    });
    return { runId, companyId, created: true };
  },
});

/** Saved output exactly as frozen. Parses and cross-checks the row; never runs the engine. */
function project(row: Doc<"timelineBaselines">): SavedBaseline {
  const parsedSeed = parseWeeklySeedJson(row.seedText);
  const model = CompanyModelSchema.safeParse(row.model);
  const constraints = z.array(ConstraintSchema).safeParse(row.constraints);
  const forecast = ForecastSchema.safeParse(row.forecast);
  const dominoes = z.array(DominoSchema).safeParse(row.dominoes);
  const history = z.array(HistoryWeekSchema).safeParse(row.history);
  const pastEvents = z.array(PastEventSchema).safeParse(row.pastEvents);
  if (
    !parsedSeed.success ||
    !model.success ||
    !constraints.success ||
    !forecast.success ||
    !dominoes.success ||
    !history.success ||
    !pastEvents.success ||
    parsedSeed.data.contentHash !== row.seedHash ||
    parsedSeed.data.company.id !== row.companyId ||
    parsedSeed.data.id !== row.seedId
  )
    reject("INTEGRITY", "Saved baseline failed its integrity check");
  const seed = parsedSeed.data;
  return {
    runId: row.runId,
    companyId: row.companyId,
    companyName: seed.company.name,
    seedHash: row.seedHash,
    inputHash: row.inputHash,
    methodVersion: row.methodVersion,
    assumptionNote: row.assumptionNote,
    model: model.data,
    constraints: constraints.data,
    seed,
    forecast: forecast.data,
    dominoes: dominoes.data,
    history: history.data,
    pastEvents: pastEvents.data,
    savedAt: row.savedAt,
  };
}

/** One saved baseline under its company, or null. Company scoping is lookup, not access control. */
export const get = query({
  args: { companyId: v.string(), runId: v.string() },
  handler: async (ctx, args): Promise<SavedBaseline | null> => {
    const row = await ctx.db
      .query("timelineBaselines")
      .withIndex("by_company_and_runId", (q) =>
        q.eq("companyId", args.companyId).eq("runId", args.runId),
      )
      .unique();
    return row ? project(row) : null;
  },
});
