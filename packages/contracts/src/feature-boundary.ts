import { z } from "zod";
import { CalendarDateSchema, flagRepeats } from "./checks";
import { IdSchema } from "./core";
import {
  HistoricalCaseSchema,
  type HistoricalFact,
  Sha256Schema,
  TimestampSchema,
} from "./historical";
import {
  CikSchema,
  CompanyKnowledgeSnapshotSchema,
  type QuarterRoleSchema,
  SealIdentitySchema,
  SemverSchema,
} from "./learning-loop";

/**
 * P0-C frozen exchange between the Field (company knowledge + agent workspace) and
 * Timeline (forecast timeline + simulations) features. Version 1.0.0. Additive: existing
 * schemas are reused unchanged. A breaking change needs a versioned proposal.
 *
 * Schemas check shape and internal consistency only. They do NOT prove a declared hash
 * matches the bytes: consumers recompute FEATURE_BOUNDARY_HASH digests (P0-H) and reject
 * tampered content. Cross-feature identity is a namespaced domain id, never a Convex
 * document id. Every record must equal its own parse: unknown fields anywhere (including
 * inside reused non-strict legacy shapes) and omitted defaults are rejected, so no
 * secret, provider packet or hidden reasoning can ride along and be silently dropped.
 */

type Path = (string | number)[];
const ms = (t: string): number => Date.parse(t);
const localDate = (t: string): string => t.slice(0, 10);
const NonBlank = z.string().refine((s) => s.trim().length > 0, "must not be blank");
const issuer =
  (ctx: z.RefinementCtx) =>
  (path: Path, message: string): void =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

export const FEATURE_BOUNDARY_VERSION = "1.0.0";

// ---------- Canonical hash ----------

/**
 * Hash scheme "sha256/domino-canonical-json-v1":
 *   digest = lowercase hex SHA-256 (FIPS 180-4) of the UTF-8 bytes of canonicalJson(value).
 * Which value is hashed:
 *   - CompanyKnowledgeSnapshot.contentHash and TimelineSeedV1.contentHash hash the record
 *     with its own top-level contentHash removed (contentHashPreimage). A seed's preimage
 *     includes the embedded snapshot WITH the snapshot's contentHash. This is the existing
 *     engine companySnapshot convention.
 *   - A public fixture hash is the digest of the whole fixture value.
 * Same bytes as @domino/agents canonicalJson/hashInput and the engine snapshot serializer
 * for plain JSON data. Intended to match RFC 8785 (JCS) for these values; not separately
 * conformance tested.
 */
export const FEATURE_BOUNDARY_HASH = {
  scheme: "sha256/domino-canonical-json-v1",
  algorithm: "SHA-256",
  digestEncoding: "lowercase-hex",
  byteEncoding: "UTF-8",
} as const;

/**
 * Canonical JSON text, no whitespace anywhere:
 *   - null, true, false and strings: ECMAScript JSON.stringify (quote, backslash and
 *     U+0000..U+001F escaped, \b \f \n \r \t short forms, lone surrogates as \uXXXX, every
 *     other code point written as itself).
 *   - numbers: finite only, ECMAScript JSON.stringify (-0 becomes 0). Contract numbers are
 *     safe integers, so this is a plain base-10 integer.
 *   - arrays: elements in order, comma separated. undefined or holes are rejected.
 *   - objects: plain objects only. Own enumerable keys whose value is not undefined,
 *     sorted by UTF-16 code unit order, written "key":value, comma separated.
 *   - anything else (bigint, function, symbol, Date, Map, class instances, cycles, NaN,
 *     Infinity) throws a TypeError instead of being coerced.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, new Set());
}

function encode(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
  if (ancestors.has(value)) throw new TypeError("canonicalJson: cyclic value");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let i = 0; i < value.length; i++) {
        if (value[i] === undefined) throw new TypeError("canonicalJson: undefined array item");
        items.push(encode(value[i], ancestors));
      }
      return `[${items.join(",")}]`;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null)
      throw new TypeError("canonicalJson: only plain objects are supported");
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${encode(record[k], ancestors)}`)
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** The canonical text a record's contentHash digests: the record minus its own contentHash. */
export function contentHashPreimage(record: Record<string, unknown>): string {
  return canonicalJson({ ...record, contentHash: undefined });
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Paths present in only one of raw and parsed: unknown (stripped) fields or omitted defaults. */
function driftPaths(raw: unknown, parsed: unknown, path: Path = []): Path[] {
  if (Array.isArray(raw) && Array.isArray(parsed))
    return raw.flatMap((item, i) => driftPaths(item, parsed[i], [...path, i]));
  if (!isPlain(raw) || !isPlain(parsed)) return [];
  const out: Path[] = [];
  for (const k of Object.keys(raw)) {
    if (raw[k] === undefined) continue;
    if (parsed[k] === undefined) out.push([...path, k]);
    else out.push(...driftPaths(raw[k], parsed[k], [...path, k]));
  }
  for (const k of Object.keys(parsed))
    if (parsed[k] !== undefined && raw[k] === undefined) out.push([...path, k]);
  return out;
}

/**
 * Largest integer magnitude in any boundary record: 2^49 (562,949,953,421,312 cents, about
 * USD 5.6 trillion). Applies to every number, so every money field (fact cents, assumption
 * ranges, one-time costs) is covered; non-money integers (versions, lag days) never need more.
 * Why 2^49 (B): engine quarterly_cash_bridge@0.1.0 at worst adds total (B), (OCF + ICF) / n
 * (2B), financing (B) and FX (B) scaled by at most one quarter, a decision's benefit (B) and
 * cost (B), then subtracts restricted cash (2B): at most 9B < 2^53, so it cannot overflow.
 */
export const BOUNDARY_INTEGER_MAX = 2 ** 49;

/**
 * Every number in a boundary record is an integer (cents, days, versions). Reused legacy
 * shapes check .int() only, which admits 2^53 and beyond, where integers stop being exact.
 */
function numberIssues(value: unknown, path: Path = []): [Path, string][] {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return [[path, "number must be a safe integer"]];
    return Math.abs(value) > BOUNDARY_INTEGER_MAX
      ? [[path, "number exceeds the boundary magnitude 2^49, so engine sums could overflow"]]
      : [];
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => numberIssues(v, [...path, i]));
  if (!isPlain(value)) return [];
  return Object.keys(value).flatMap((k) => numberIssues(value[k], [...path, k]));
}

/**
 * Zod still runs refinements on "dirty" values (for example cents that failed .int()), so
 * every refinement here is wrapped: an unexpected exception becomes a validation failure,
 * never a throw from safeParse. Refinements also guard their own conversions.
 */
const total =
  <T>(check: (value: T, ctx: z.RefinementCtx) => void) =>
  (value: T, ctx: z.RefinementCtx): void => {
    try {
      check(value, ctx);
    } catch {
      issuer(ctx)([], "malformed input could not be validated");
    }
  };

/**
 * Parse, then require the input to be exactly its parse (so the hashed bytes are the
 * contract) and every number to be a bounded safe integer. Every failure is FATAL: the
 * parse aborts, so composed schemas (forecast-ready, contexts) never refine a failed record.
 * Public entry points hand this a guarded plain snapshot (see guarded), never caller objects.
 */
function exact<T extends z.ZodTypeAny>(schema: T) {
  return z.unknown().transform((raw, ctx): z.output<T> => {
    const fail = (path: Path, message: string): never => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message, fatal: true });
      return z.NEVER;
    };
    try {
      const r: z.SafeParseReturnType<unknown, z.output<T>> = schema.safeParse(raw);
      if (!r.success) {
        for (const i of r.error.issues) ctx.addIssue({ ...i, fatal: true });
        return z.NEVER;
      }
      if (canonicalJson(raw) !== canonicalJson(r.data)) {
        const paths = driftPaths(raw, r.data);
        for (const path of paths.length ? paths : [[]])
          fail(path, "field is not part of the contract (unknown field or omitted default)");
        return z.NEVER;
      }
      const numbers = numberIssues(r.data);
      for (const [path, message] of numbers) fail(path, message);
      if (numbers.length) return z.NEVER;
      return r.data;
    } catch {
      return fail([], "not plain JSON data, or malformed input that could not be validated");
    }
  });
}

// ---------- Total public entry points ----------

/** Nesting deeper than this is rejected (boundary records nest about 8 levels). */
export const BOUNDARY_MAX_DEPTH = 64;
/** JSON text longer than this many UTF-16 code units is rejected before parsing. */
export const BOUNDARY_MAX_JSON_LENGTH = 16 * 1024 * 1024;

type Snapshot = { ok: true; value: unknown } | { ok: false; message: string };
class NotPlain extends Error {}

/**
 * A plain-JSON copy of any JS value, taken in one guarded pass. Accessor properties are
 * rejected, never invoked; each data property is read once through its descriptor, so a
 * getter or proxy trap cannot answer differently on a second read. Proxies with throwing or
 * revoked traps, non-plain prototypes, symbols, bigints, functions, non-finite numbers,
 * holes, cycles and excessive depth all fail. Shared (non-cyclic) references are copied
 * once and reused by identity. Undefined object values are dropped, as in JSON.
 */
export function plainJsonSnapshot(input: unknown): Snapshot {
  const done = new Map<object, unknown>();
  const active = new Set<object>();
  const copy = (v: unknown, depth: number): unknown => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new NotPlain("non-finite number");
      return v;
    }
    if (typeof v !== "object") throw new NotPlain(`unsupported ${typeof v}`);
    if (depth > BOUNDARY_MAX_DEPTH) throw new NotPlain("nested too deeply");
    if (done.has(v)) return done.get(v);
    if (active.has(v)) throw new NotPlain("cyclic value");
    active.add(v);
    const isArray = Array.isArray(v);
    const proto = Object.getPrototypeOf(v);
    const own = (key: string) => {
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d) return undefined;
      if (!("value" in d)) throw new NotPlain("accessor properties are not plain data");
      return d;
    };
    let out: unknown;
    if (isArray) {
      if (proto !== Array.prototype) throw new NotPlain("only plain arrays are supported");
      const length = own("length")?.value;
      if (!Number.isSafeInteger(length)) throw new NotPlain("invalid array length");
      const items: unknown[] = [];
      for (let i = 0; i < length; i++) {
        const d = own(String(i));
        if (!d || d.value === undefined) throw new NotPlain("array hole or undefined item");
        items.push(copy(d.value, depth + 1));
      }
      out = items;
    } else {
      if (proto !== Object.prototype && proto !== null)
        throw new NotPlain("only plain objects are supported");
      const record: Record<string, unknown> = {};
      for (const key of Object.keys(v)) {
        const d = own(key);
        if (!d || d.value === undefined) continue;
        // defineProperty, so a "__proto__" key stays data instead of changing the prototype.
        Object.defineProperty(record, key, {
          value: copy(d.value, depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      out = record;
    }
    active.delete(v);
    done.set(v, out);
    return out;
  };
  try {
    return { ok: true, value: copy(input, 0) };
  } catch (e) {
    return {
      ok: false,
      message: `not plain JSON data: ${e instanceof NotPlain ? e.message : "input could not be read"}`,
    };
  }
}

const failure = <I, O>(message: string): z.SafeParseReturnType<I, O> => ({
  success: false,
  error: new z.ZodError([{ code: z.ZodIssueCode.custom, path: [], message }]),
});

/**
 * Make safeParse (and parse, safeParseAsync, parseAsync, spa, which delegate to it) total
 * for any JS value: validate a guarded plain snapshot, never the caller's object. Zod itself
 * inspects its input (for example a "then" getter) before any schema code runs, so the guard
 * must wrap the public method. Composing these schemas inside another Zod schema bypasses
 * the guard; use the exported schemas or the JSON-text entry points at the boundary.
 */
function guarded<T extends z.ZodTypeAny>(schema: T): T {
  const inner = schema.safeParse.bind(schema);
  const run = (
    data: unknown,
    params?: Partial<z.ParseParams>,
  ): z.SafeParseReturnType<z.input<T>, z.output<T>> => {
    const snap = plainJsonSnapshot(data);
    if (!snap.ok) return failure(snap.message);
    try {
      return inner(snap.value, params);
    } catch {
      return failure("malformed input could not be validated");
    }
  };
  const runAsync = async (data: unknown, params?: Partial<z.ParseParams>) => run(data, params);
  return Object.assign(schema, { safeParse: run, safeParseAsync: runAsync, spa: runAsync });
}

/**
 * The cross-lane boundary: validate JSON text, as exchanged between features. Never throws,
 * for any value: non-strings, oversized text and invalid JSON return success:false.
 */
export function safeParseJsonText<T extends z.ZodTypeAny>(
  schema: T,
  text: unknown,
): z.SafeParseReturnType<unknown, z.output<T>> {
  try {
    if (typeof text !== "string") return failure("expected JSON text");
    if (text.length > BOUNDARY_MAX_JSON_LENGTH) return failure("JSON text is too large");
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return failure("invalid JSON text");
    }
    return schema.safeParse(value);
  } catch {
    return failure("malformed input could not be validated");
  }
}

/** Parse two JSON texts and validate them as one {[a]: ..., [b]: ...} context. */
function contextFromJson<T extends z.ZodTypeAny>(schema: T, a: string, b: string) {
  return (textA: unknown, textB: unknown): z.SafeParseReturnType<unknown, z.output<T>> => {
    try {
      if (typeof textA !== "string" || typeof textB !== "string")
        return failure("expected JSON text");
      if (textA.length + textB.length > BOUNDARY_MAX_JSON_LENGTH)
        return failure("JSON text is too large");
      let pair: unknown;
      try {
        pair = { [a]: JSON.parse(textA), [b]: JSON.parse(textB) };
      } catch {
        return failure("invalid JSON text");
      }
      return schema.safeParse(pair);
    } catch {
      return failure("malformed input could not be validated");
    }
  };
}

// ---------- Domain identity ----------

export const FeatureDomainSchema = z.enum(["field", "timeline"]);
export type FeatureDomain = z.infer<typeof FeatureDomainSchema>;

/**
 * "<owner>:<kind>/<name>", for example "field:seed/twou-2023q3-v1". The owner names the
 * feature that created the record. A Convex document id has no colon, so it never parses.
 * Bounded: kind at most 32 characters, name at most 128.
 */
export const DomainIdSchema = z
  .string()
  .regex(
    /^(field|timeline):[a-z][a-z0-9_]{0,31}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
    "expected a domain id like field:seed/name; a Convex document id is not cross-feature identity",
  );

const ownedId = (owner: FeatureDomain, kind: string) =>
  DomainIdSchema.refine(
    (id) => id.startsWith(`${owner}:${kind}/`),
    `expected a ${owner}:${kind}/ domain id`,
  );
export const domainOf = (id: string): string => id.slice(0, id.indexOf(":"));

const ContentRef = (owner: FeatureDomain, kind: string) =>
  z.object({ id: ownedId(owner, kind), contentHash: Sha256Schema }).strict();

const CompanySchema = z.object({ cik: CikSchema, name: NonBlank }).strict();

// ---------- Methods ----------

/** Fact roles the quarterly bridge reads. Financing and FX enter as explicit assumptions. */
export const BRIDGE_FACT_ROLES = [
  "usable_cash",
  "total_cash",
  "operating_ytd",
  "investing_ytd",
] as const satisfies readonly z.infer<typeof QuarterRoleSchema>[];
export const BridgeFactRoleSchema = z.enum(BRIDGE_FACT_ROLES);
export type BridgeFactRole = z.infer<typeof BridgeFactRoleSchema>;

/**
 * Frozen method registry. A seed or result may pin only these. Must equal the engine's
 * QUARTER_BRIDGE_METHOD. Contracts must not import the engine, so P0-H owns the equality
 * test. The seed checks below mirror that engine version's input rules; keep them in step.
 */
export const TIMELINE_METHODS = [
  { id: "quarterly_cash_bridge", version: "0.1.0", requiredRoles: BRIDGE_FACT_ROLES },
] as const;

export const TimelineMethodPinSchema = z
  .object({ id: SealIdentitySchema, version: SemverSchema })
  .strict()
  .refine(
    (m) => TIMELINE_METHODS.some((x) => x.id === m.id && x.version === m.version),
    "method is not a supported pinned timeline method",
  );
export type TimelineMethodPin = z.infer<typeof TimelineMethodPinSchema>;

/** Required fact roles of a pinned method; empty when the method is not supported. */
export function timelineMethodRoles(m: { id: string; version: string }): readonly BridgeFactRole[] {
  return (
    TIMELINE_METHODS.find((x) => x.id === m.id && x.version === m.version)?.requiredRoles ?? []
  );
}

const ROLE_FACT: Record<BridgeFactRole, { metric: HistoricalFact["metric"]; instant: boolean }> = {
  usable_cash: { metric: "cash_and_equivalents", instant: true },
  total_cash: { metric: "cash_including_restricted", instant: true },
  operating_ytd: { metric: "operating_cash_flow", instant: false },
  investing_ytd: { metric: "investing_cash_flow", instant: false },
};

const QUARTER_ENDS = ["03-31", "06-30", "09-30", "12-31"];
const nextQuarterEnd = (date: string): string | undefined => {
  const i = QUARTER_ENDS.indexOf(date.slice(5));
  const year = Number(date.slice(0, 4));
  if (i < 0) return undefined;
  return i === 3 ? `${year + 1}-03-31` : `${year}-${QUARTER_ENDS[i + 1]}`;
};
const monthIndex = (date: string): number =>
  Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));
/** undefined for an impossible date (refinements also see values that failed the date check). */
const dayAfter = (date: string): string | undefined => {
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t + 86_400_000).toISOString().slice(0, 10) : undefined;
};
const safeInts = (...ns: number[]): boolean => ns.every((n) => Number.isSafeInteger(n));

// ---------- TimelineSeedV1 ----------

const SeedPinsSchema = z
  .object({
    boundaryVersion: z.literal(FEATURE_BOUNDARY_VERSION),
    hashScheme: z.literal(FEATURE_BOUNDARY_HASH.scheme),
    snapshotSchemaVersion: z.literal(1),
    method: TimelineMethodPinSchema,
  })
  .strict();

const QuarterBridgeSelectionSchema = z
  .object({
    knowledgeCutoff: TimestampSchema,
    /** Latest reported balance date, a calendar quarter end before the cutoff date. */
    originBalanceDate: CalendarDateSchema,
    /** The quarter end after the origin. The cutoff local date falls strictly between. */
    targetDate: CalendarDateSchema,
    /** Exactly the snapshot's validated binding for each required role; blocked roles absent. */
    roleFacts: z
      .object({
        usable_cash: IdSchema.optional(),
        total_cash: IdSchema.optional(),
        operating_ytd: IdSchema.optional(),
        investing_ytd: IdSchema.optional(),
      })
      .strict(),
    /** Explicitly selected cents-per-quarter ranges. Unknown is a range, never an inferred 0. */
    financingAssumptionId: IdSchema,
    fxAssumptionId: IdSchema,
    /** Other method-applied assumptions, for example restricted cash held flat. */
    methodAssumptionIds: z.array(IdSchema),
  })
  .strict();

const ReadinessSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("forecast_ready") }).strict(),
  z
    .object({
      status: z.literal("blocked"),
      /** Required roles that are not validated, in method order. */
      blockedRoles: z.array(BridgeFactRoleSchema).min(1),
    })
    .strict(),
]);

const SeedObjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: ownedId("field", "seed"),
    /** Runtime export instant, not a historical date. */
    exportedAt: TimestampSchema,
    company: CompanySchema,
    provenance: HistoricalCaseSchema.innerType().shape.provenance,
    snapshotRef: ContentRef("field", "snapshot"),
    /** The accepted snapshot, embedded whole. Its case holds only cutoff-visible evidence. */
    snapshot: CompanyKnowledgeSnapshotSchema,
    quarterBridge: QuarterBridgeSelectionSchema,
    pins: SeedPinsSchema,
    readiness: ReadinessSchema,
    /** A seed never carries post-reveal information; anything that would taint it is rejected. */
    postHoc: z.literal(false),
    contentHash: Sha256Schema,
  })
  .strict()
  .superRefine(
    total((seed, ctx) => {
      const issue = issuer(ctx);
      const { snapshot: snap, quarterBridge: qb } = seed;
      const c = snap.case;
      const cutoff = ms(snap.cutoff);

      // Identity and company linkage: one company throughout.
      if (seed.snapshotRef.id !== snap.id) issue(["snapshotRef", "id"], "snapshot id differs");
      if (seed.snapshotRef.contentHash !== snap.contentHash)
        issue(["snapshotRef", "contentHash"], "snapshot content hash differs");
      if (seed.company.cik !== snap.cik) issue(["company", "cik"], "company differs from snapshot");
      if (seed.company.name !== c.companyName)
        issue(["company", "name"], "company name differs from the snapshot case");
      if (seed.provenance !== c.provenance)
        issue(["provenance"], "provenance differs from the snapshot case");
      for (const [i, r] of snap.reconciliations.entries())
        if (r.key.cik !== snap.cik)
          issue(["snapshot", "reconciliations", i, "key", "cik"], "receipt is for another company");

      // Chronology: nothing in the seed postdates the cutoff.
      if (qb.knowledgeCutoff !== snap.cutoff)
        issue(
          ["quarterBridge", "knowledgeCutoff"],
          "bridge cutoff differs from the snapshot cutoff",
        );
      if (ms(seed.exportedAt) < cutoff) issue(["exportedAt"], "exported before the cutoff");
      for (const [i, s] of c.sources.entries())
        if (ms(s.publishedAt) > cutoff)
          issue(["snapshot", "case", "sources", i, "publishedAt"], "source is after the cutoff");
      const cutoffDate = localDate(snap.cutoff);
      const origin = qb.originBalanceDate;
      // Parity policy: the contract may be stricter than engine quarterly_cash_bridge@0.1.0,
      // never looser. Intentional stricter v1 rule: calendar-quarter-end origins only (the
      // engine accepts any month end). v1 supports calendar-quarter facts; L1 requires FYE 12-31.
      if (!QUARTER_ENDS.includes(origin.slice(5)))
        issue(["quarterBridge", "originBalanceDate"], "origin is not a calendar quarter end");
      else if (qb.targetDate !== nextQuarterEnd(origin))
        issue(["quarterBridge", "targetDate"], "target is not the quarter end after the origin");
      if (!(origin < cutoffDate && cutoffDate < qb.targetDate))
        issue(["quarterBridge", "knowledgeCutoff"], "cutoff must fall inside the target quarter");

      // Post-hoc taint anywhere in the embedded case, used or not.
      for (const [i, a] of c.assumptions.entries()) {
        if (a.label === "hindsight")
          issue(["snapshot", "case", "assumptions", i, "label"], "hindsight assumption in a seed");
        if (a.selectedAfterReveal)
          issue(
            ["snapshot", "case", "assumptions", i, "selectedAfterReveal"],
            "post-reveal assumption in a seed",
          );
      }

      // Selected assumptions exist, are distinct and are cents ranges. Their dependency
      // closure and basis facts are checked by the case schema plus the taint check above.
      // Intentional stricter v1 rule (contract may be stricter than the engine, never looser):
      // financing and FX are distinct selections, even when one zero assumption would fit both.
      const assumptions = new Map(c.assumptions.map((a) => [a.id, a]));
      const selected: [Path, string][] = [
        [["quarterBridge", "financingAssumptionId"], qb.financingAssumptionId],
        [["quarterBridge", "fxAssumptionId"], qb.fxAssumptionId],
        ...qb.methodAssumptionIds.map((id, i): [Path, string] => [
          ["quarterBridge", "methodAssumptionIds", i],
          id,
        ]),
      ];
      const seen = new Set<string>();
      for (const [n, [path, id]] of selected.entries()) {
        const a = assumptions.get(id);
        if (!a) issue(path, "selected assumption not in the snapshot case");
        else if (a.value.unit !== "cents") issue(path, "selected assumption is not in cents");
        // Engine: a financing/FX rate covers the whole modeled interval (no partial-quarter timing).
        else if (n < 2 && a.effectiveFrom > (dayAfter(origin) ?? a.effectiveFrom))
          issue(path, "financing/FX assumption must apply from the day after the origin");
        if (seen.has(id)) issue(path, "assumption selected twice");
        seen.add(id);
      }

      // Required roles: bound to the snapshot's validated facts, or listed as blocked.
      const required = timelineMethodRoles(seed.pins.method);
      const bindings = new Map(snap.roles.map((r) => [r.role, r]));
      const facts = new Map(c.facts.map((f) => [f.id, f]));
      const blocked: BridgeFactRole[] = [];
      for (const role of required) {
        const b = bindings.get(role);
        const chosen = qb.roleFacts[role];
        const path = ["quarterBridge", "roleFacts", role];
        if (b?.status !== "validated") {
          blocked.push(role);
          if (chosen !== undefined) issue(path, "a blocked or missing role has no fact");
          continue;
        }
        if (chosen !== b.factId) {
          issue(path, "role fact differs from the snapshot binding");
          continue;
        }
        const f = facts.get(chosen);
        const want = ROLE_FACT[role];
        if (!f) issue(path, "role fact not in the snapshot case");
        else if (f.metric !== want.metric) issue(path, `role fact is not ${want.metric}`);
        else if (
          want.instant
            ? f.period.kind !== "instant" || f.period.date !== origin
            : f.period.kind !== "duration" || f.period.end !== origin
        )
          issue(path, "role fact does not end at the origin balance date");
      }
      const roleFact = (r: BridgeFactRole) => {
        const id = qb.roleFacts[r];
        return id === undefined ? undefined : facts.get(id);
      };
      // Engine: YTD flows start on a month start and cover 3, 6, 9 or 12 whole months.
      const ytd = (["operating_ytd", "investing_ytd"] as const).map((r) => {
        const f = roleFact(r);
        if (f?.period.kind !== "duration" || f.period.end !== origin) return undefined;
        const { start } = f.period;
        const months = monthIndex(origin) - monthIndex(start) + 1;
        if (!start.endsWith("-01"))
          issue(["quarterBridge", "roleFacts", r], "YTD flow must start on a month start");
        else if (months % 3 !== 0 || months > 12)
          issue(
            ["quarterBridge", "roleFacts", r],
            "YTD flow must cover 3, 6, 9 or 12 whole months",
          );
        return start;
      });
      if (ytd[0] !== undefined && ytd[1] !== undefined && ytd[0] !== ytd[1])
        issue(["quarterBridge", "roleFacts", "investing_ytd"], "YTD flows have different starts");
      // Engine: total covers usable, and any reported origin restricted cash is the difference.
      const usable = roleFact("usable_cash");
      const total = roleFact("total_cash");
      if (
        usable?.metric === "cash_and_equivalents" &&
        total?.metric === "cash_including_restricted"
      ) {
        // Only exact integers are compared; invalid cents are already reported by SafeCents.
        const exactPair = safeInts(total.cents, usable.cents);
        if (exactPair && total.cents < usable.cents)
          issue(["quarterBridge", "roleFacts", "total_cash"], "total cash is below usable cash");
        for (const [i, f] of c.facts.entries())
          if (
            exactPair &&
            safeInts(f.cents) &&
            f.metric === "restricted_cash" &&
            f.period.kind === "instant" &&
            f.period.date === origin &&
            BigInt(f.cents) !== BigInt(total.cents) - BigInt(usable.cents)
          )
            issue(
              ["snapshot", "case", "facts", i, "cents"],
              "restricted cash contradicts total minus usable at the origin",
            );
      }
      const declared = seed.readiness.status === "blocked" ? seed.readiness.blockedRoles : [];
      if (declared.join() !== blocked.join())
        issue(
          ["readiness"],
          blocked.length
            ? `blocked required roles must be listed exactly: ${blocked.join(", ")}`
            : "every required role is validated, so the seed is forecast_ready",
        );
    }),
  );

/**
 * Self-contained immutable snapshot export from Field to Timeline. A valid seed may be
 * blocked; use ForecastReadyTimelineSeedV1Schema to accept only forecastable seeds.
 */
export const TimelineSeedV1Schema = guarded(exact(SeedObjectSchema));
export type TimelineSeedV1 = z.infer<typeof SeedObjectSchema>;

export const ForecastReadyTimelineSeedV1Schema = guarded(
  TimelineSeedV1Schema.superRefine(
    total((seed, ctx) => {
      if (seed.readiness.status !== "forecast_ready")
        issuer(ctx)(
          ["readiness", "status"],
          "a seed with a blocked required role is not forecast-ready",
        );
    }),
  ),
);

// ---------- TimelineResultRefV1 ----------

export const TimelineRouteSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("timeline_result"), resultId: ownedId("timeline", "result") })
    .strict(),
]);
export type TimelineRoute = z.infer<typeof TimelineRouteSchema>;

const ResultRefObjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: ownedId("timeline", "result"),
    seed: ContentRef("field", "seed"),
    snapshot: ContentRef("field", "snapshot"),
    company: CompanySchema,
    baselineRunId: ownedId("timeline", "run"),
    /** Absent for a baseline-only result. */
    scenarioId: ownedId("timeline", "scenario").optional(),
    target: z
      .object({
        date: CalendarDateSchema,
        metric: z.enum(["cash_including_restricted", "cash_and_equivalents"]),
      })
      .strict(),
    method: TimelineMethodPinSchema,
    status: z.enum(["running", "saved", "failed"]),
    /** The scenario was chosen after a reveal. A baseline is never post-hoc. */
    postHoc: z.boolean(),
    route: TimelineRouteSchema,
    createdAt: TimestampSchema,
    savedAt: TimestampSchema.optional(),
  })
  .strict()
  .superRefine(
    total((r, ctx) => {
      const issue = issuer(ctx);
      if (r.route.resultId !== r.id) issue(["route", "resultId"], "route names another result");
      if (r.postHoc && r.scenarioId === undefined)
        issue(["postHoc"], "a baseline-only result cannot be post-hoc");
      if ((r.status === "saved") !== (r.savedAt !== undefined))
        issue(["savedAt"], "saved results have savedAt, and only they do");
      if (r.savedAt !== undefined && ms(r.savedAt) < ms(r.createdAt))
        issue(["savedAt"], "saved before it was created");
    }),
  );

/** Read-only pointer from Timeline back to Field. Field links to it; it never rewrites results. */
export const TimelineResultRefV1Schema = guarded(exact(ResultRefObjectSchema));
export type TimelineResultRefV1 = z.infer<typeof ResultRefObjectSchema>;

/** A result ref checked against the seed it claims to come from. */
export const TimelineResultRefContextV1Schema = guarded(
  z
    .object({ seed: TimelineSeedV1Schema, result: TimelineResultRefV1Schema })
    .strict()
    .superRefine(
      total(({ seed, result }, ctx) => {
        const issue = issuer(ctx);
        if (result.seed.id !== seed.id || result.seed.contentHash !== seed.contentHash)
          issue(["result", "seed"], "result names another seed or seed content");
        if (
          result.snapshot.id !== seed.snapshotRef.id ||
          result.snapshot.contentHash !== seed.snapshotRef.contentHash
        )
          issue(["result", "snapshot"], "result names another snapshot or snapshot content");
        if (result.company.cik !== seed.company.cik || result.company.name !== seed.company.name)
          issue(["result", "company"], "result is for another company");
        if (
          result.method.id !== seed.pins.method.id ||
          result.method.version !== seed.pins.method.version
        )
          issue(["result", "method"], "result method differs from the seed pin");
        if (result.target.date !== seed.quarterBridge.targetDate)
          issue(["result", "target", "date"], "result target differs from the seed target");
        if (seed.readiness.status !== "forecast_ready")
          issue(["seed", "readiness"], "a result needs a forecast-ready seed");
        if (ms(result.createdAt) < ms(seed.exportedAt))
          issue(["result", "createdAt"], "result created before its seed was exported");
      }),
    ),
);

// ---------- OperationSummaryV1 ----------

const TERMINAL = ["succeeded", "partial", "failed", "cancelled"] as const;
export const OperationStatusSchema = z.enum([
  "queued",
  "running",
  ...TERMINAL,
  /** Outcome not known (for example lost on restart). Never shown as success. */
  "unknown",
]);

/** Evidence a viewer may already see: a domain record, or one item inside a snapshot case. */
export const OperationEvidenceRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("domain"), id: DomainIdSchema }).strict(),
  z
    .object({
      kind: z.literal("case_item"),
      snapshotId: ownedId("field", "snapshot"),
      item: z.enum(["source", "fact", "assumption"]),
      /** Case-local id, bounded like a domain id name. */
      id: IdSchema.max(128),
    })
    .strict(),
]);

const OperationIdSchema = DomainIdSchema.refine(
  (id) => /^[a-z]+:operation\//.test(id),
  "expected an operation domain id",
);

const OperationObjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: OperationIdSchema,
    ownerDomain: FeatureDomainSchema,
    status: OperationStatusSchema,
    title: NonBlank.pipe(z.string().max(200)),
    /** Operations this one waited on, in either domain. Execution order, not financial causality. */
    dependencies: z.array(OperationIdSchema).max(64),
    evidenceRefs: z.array(OperationEvidenceRefSchema).max(256),
    /** Records this operation produced. Always owned by ownerDomain. */
    outputRefs: z.array(DomainIdSchema).max(64),
    createdAt: TimestampSchema,
    startedAt: TimestampSchema.optional(),
    finishedAt: TimestampSchema.optional(),
    updatedAt: TimestampSchema,
  })
  .strict()
  .superRefine(
    total((op, ctx) => {
      const issue = issuer(ctx);
      if (domainOf(op.id) !== op.ownerDomain)
        issue(["id"], "operation id is owned by another domain");
      for (const [i, d] of op.dependencies.entries())
        if (d === op.id) issue(["dependencies", i], "an operation cannot depend on itself");
      flagRepeats(
        ctx,
        op.dependencies,
        (d) => d,
        (i) => ["dependencies", i],
        "duplicate dependency",
      );
      flagRepeats(
        ctx,
        op.evidenceRefs,
        (r) => canonicalJson(r),
        (i) => ["evidenceRefs", i],
        "duplicate evidence ref",
      );
      flagRepeats(
        ctx,
        op.outputRefs,
        (r) => r,
        (i) => ["outputRefs", i],
        "duplicate output ref",
      );
      for (const [i, r] of op.outputRefs.entries())
        if (domainOf(r) !== op.ownerDomain)
          issue(["outputRefs", i], "an operation only outputs records of its own domain");
      if (op.outputRefs.length > 0 && op.status !== "succeeded" && op.status !== "partial")
        issue(["outputRefs"], "only succeeded or partial operations have outputs");

      const terminal = (TERMINAL as readonly string[]).includes(op.status);
      const started = op.startedAt !== undefined;
      const finished = op.finishedAt !== undefined;
      if (op.status === "queued" && (started || finished))
        issue(["startedAt"], "a queued operation has not started");
      if (op.status === "running" && (!started || finished))
        issue(["startedAt"], "a running operation has started and not finished");
      if (terminal && !finished) issue(["finishedAt"], "a finished operation needs finishedAt");
      if (terminal && op.status !== "cancelled" && !started)
        issue(["startedAt"], "a completed or failed operation needs startedAt");
      const order: [string, string | undefined][] = [
        ["createdAt", op.createdAt],
        ["startedAt", op.startedAt],
        ["finishedAt", op.finishedAt],
        ["updatedAt", op.updatedAt],
      ];
      let last = Number.NEGATIVE_INFINITY;
      for (const [key, t] of order) {
        if (t === undefined) continue;
        if (ms(t) < last) issue([key], "timestamps must not go backwards");
        last = Math.max(last, ms(t));
      }
    }),
  );

/**
 * Safe, bounded display record for one real operation. Field owns agent jobs; Timeline owns
 * finance calculation and scenario receipts. No raw provider packets, credentials or hidden
 * reasoning: the record is strict and carries refs, never payloads.
 */
export const OperationSummaryV1Schema = guarded(exact(OperationObjectSchema));
export type OperationSummaryV1 = z.infer<typeof OperationObjectSchema>;

// ---------- TimelineRevealV1 (post-reveal, never part of a seed) ----------

const RevealObjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: ownedId("timeline", "reveal"),
    seed: ContentRef("field", "seed"),
    company: CompanySchema,
    knowledgeCutoff: TimestampSchema,
    revealedThrough: TimestampSchema,
    /** Later disclosures as a case fragment: reported facts only, no assumptions. */
    disclosures: HistoricalCaseSchema,
  })
  .strict()
  .superRefine(
    total((r, ctx) => {
      const issue = issuer(ctx);
      const cutoff = ms(r.knowledgeCutoff);
      const through = ms(r.revealedThrough);
      const d = r.disclosures;
      if (through <= cutoff) issue(["revealedThrough"], "reveal must be after the cutoff");
      if (d.companyName !== r.company.name)
        issue(["disclosures", "companyName"], "company name differs");
      if (d.assumptions.length > 0)
        issue(["disclosures", "assumptions"], "a reveal has no assumptions");
      if (d.facts.length === 0) issue(["disclosures", "facts"], "a reveal needs at least one fact");
      for (const [i, s] of d.sources.entries())
        if (!(cutoff < ms(s.publishedAt) && ms(s.publishedAt) <= through))
          issue(
            ["disclosures", "sources", i, "publishedAt"],
            "a revealed source is published after the cutoff and by revealedThrough",
          );
      for (const [i, f] of d.facts.entries())
        if (f.kind !== "reported")
          issue(
            ["disclosures", "facts", i, "kind"],
            "derive later facts against the seed, not here",
          );
    }),
  );

/** Permitted later actuals, kept apart from the seed and every earlier forecast. */
export const TimelineRevealV1Schema = guarded(exact(RevealObjectSchema));
export type TimelineRevealV1 = z.infer<typeof RevealObjectSchema>;

/** A reveal checked against the seed it scores: same company, case and cutoff, no shared ids. */
export const TimelineRevealContextV1Schema = guarded(
  z
    .object({ seed: TimelineSeedV1Schema, reveal: TimelineRevealV1Schema })
    .strict()
    .superRefine(
      total(({ seed, reveal }, ctx) => {
        const issue = issuer(ctx);
        const c = seed.snapshot.case;
        const d = reveal.disclosures;
        if (reveal.seed.id !== seed.id || reveal.seed.contentHash !== seed.contentHash)
          issue(["reveal", "seed"], "reveal names another seed or seed content");
        if (reveal.company.cik !== seed.company.cik || reveal.company.name !== seed.company.name)
          issue(["reveal", "company"], "reveal is for another company");
        if (reveal.knowledgeCutoff !== seed.snapshot.cutoff)
          issue(["reveal", "knowledgeCutoff"], "reveal cutoff differs from the seed cutoff");
        if (d.id !== c.id || d.currency !== c.currency || d.provenance !== c.provenance)
          issue(["reveal", "disclosures"], "disclosures belong to another case");
        const sourceIds = new Set(c.sources.map((s) => s.id));
        const factIds = new Set(c.facts.map((f) => f.id));
        for (const [i, s] of d.sources.entries())
          if (sourceIds.has(s.id))
            issue(["reveal", "disclosures", "sources", i, "id"], "source id already in the seed");
        for (const [i, f] of d.facts.entries())
          if (factIds.has(f.id))
            issue(["reveal", "disclosures", "facts", i, "id"], "fact id already in the seed");
      }),
    ),
);

// ---------- JSON-text boundary (what crosses between lanes) ----------

export const parseTimelineSeedJson = (text: unknown) =>
  safeParseJsonText(TimelineSeedV1Schema, text);
export const parseForecastReadyTimelineSeedJson = (text: unknown) =>
  safeParseJsonText(ForecastReadyTimelineSeedV1Schema, text);
export const parseTimelineResultRefJson = (text: unknown) =>
  safeParseJsonText(TimelineResultRefV1Schema, text);
export const parseOperationSummaryJson = (text: unknown) =>
  safeParseJsonText(OperationSummaryV1Schema, text);
export const parseTimelineRevealJson = (text: unknown) =>
  safeParseJsonText(TimelineRevealV1Schema, text);
/** (seed JSON text, result JSON text) */
export const parseTimelineResultRefContextJson = contextFromJson(
  TimelineResultRefContextV1Schema,
  "seed",
  "result",
);
/** (seed JSON text, reveal JSON text) */
export const parseTimelineRevealContextJson = contextFromJson(
  TimelineRevealContextV1Schema,
  "seed",
  "reveal",
);
