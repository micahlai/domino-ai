import {
  type CompanyKnowledgeSnapshot,
  CompanyKnowledgeSnapshotSchema,
  DecimalLexemeSchema,
  FilingFormSchema,
  type HistoricalCase,
  type HistoricalFact,
  type HistoricalSource,
  type MappingReceipt,
  MappingReceiptSchema,
  type NormalizedObservation,
  NormalizedObservationSchema,
  type ObservationKey,
  type Period,
  PeriodSchema,
  type SourcePackage,
  SourcePackageSchema,
  type SourceRecord,
  TimestampSchema,
  dollarLexemeToCents,
} from "@domino/contracts";
import type { QuarterBridgeInput } from "./period";

/**
 * L1 supported-source normalization. Pure: no network, clock, AI or randomness.
 * Supported v1 boundary: SEC companyfacts + submissions JSON, us-gaap, USD, consolidated
 * (undimensioned) facts, fiscal year ending 12-31, calendar-quarter cash roles.
 * The dictionary is frozen from the development package. No company appears in this code.
 * Conflict classification and selection between several candidates is L2's job; here
 * more than one eligible candidate only blocks the role.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const err = <T>(...errors: string[]): Result<T> => ({ ok: false, errors });

export const SOURCE_NORMALIZER = { mapperVersion: "1.0.0", dictionaryVersion: "1.0.0" } as const;

export type QuarterRole = CompanyKnowledgeSnapshot["roles"][number]["role"];
type Metric = ObservationKey["metric"];
type Binding = CompanyKnowledgeSnapshot["roles"][number];
type Blocked = Extract<Binding, { status: "blocked" }>;

/**
 * direct: the tag alone is the role. component: one part of restricted cash; used only
 * with full coverage. ambiguous: never mapped; the user must say what it means.
 */
export type DictionaryEntry =
  | { use: "direct"; role: QuarterRole; metric: Metric }
  | { use: "component"; metric: Metric }
  | { use: "ambiguous"; metric: Metric; question: string };

/** us-gaap tags evidenced in the development package. fx_ytd has none, so it stays missing. */
export const SEC_CASH_DICTIONARY: ReadonlyMap<string, DictionaryEntry> = new Map<
  string,
  DictionaryEntry
>([
  [
    "CashAndCashEquivalentsAtCarryingValue",
    { use: "direct", role: "usable_cash", metric: "cash_and_equivalents" },
  ],
  [
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    { use: "direct", role: "total_cash", metric: "cash_including_restricted" },
  ],
  [
    "NetCashProvidedByUsedInOperatingActivities",
    { use: "direct", role: "operating_ytd", metric: "operating_cash_flow" },
  ],
  [
    "NetCashProvidedByUsedInInvestingActivities",
    { use: "direct", role: "investing_ytd", metric: "investing_cash_flow" },
  ],
  [
    "NetCashProvidedByUsedInFinancingActivities",
    { use: "direct", role: "financing_ytd", metric: "financing_cash_flow" },
  ],
  ["RestrictedCashCurrent", { use: "component", metric: "restricted_cash" }],
  ["RestrictedCashNoncurrent", { use: "component", metric: "restricted_cash" }],
  [
    "RestrictedCashAndCashEquivalents",
    {
      use: "ambiguous",
      metric: "restricted_cash",
      question:
        "Is RestrictedCashAndCashEquivalents restricted cash only, or total cash including restricted cash?",
    },
  ],
]);

/** Roles quarterBridge reads as facts. Financing and FX enter it as assumptions. */
export const BRIDGE_ROLES = [
  "usable_cash",
  "total_cash",
  "operating_ytd",
  "investing_ytd",
] as const satisfies readonly QuarterRole[];

const TAXONOMY = "us-gaap";
const COMPONENTS = ["RestrictedCashCurrent", "RestrictedCashNoncurrent"] as const;
/** companyfacts row fields. Any other field (segment, dimension, axis) is outside consolidated scope. */
const ROW_KEYS = new Set(["start", "end", "val", "accn", "fy", "fp", "form", "filed", "frame"]);
/** EDGAR accepts filings on US Eastern time; each instant still carries its own offset. */
const EDGAR_TIMEZONE = "America/New_York";
const QUARTER_ENDS = new Set(["03-31", "06-30", "09-30", "12-31"]);
const BALANCES: readonly Metric[] = [
  "cash_and_equivalents",
  "restricted_cash",
  "cash_including_restricted",
];

// ---------- Raw JSON intake ----------

/** A JSON number exactly as written in the payload. Never converted to a JS number. */
class NumberLexeme {
  constructor(readonly text: string) {}
}
type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof NumberLexeme);
const text = (o: Json, k: string): string | undefined => {
  const v = Object.hasOwn(o, k) ? o[k] : undefined;
  return typeof v === "string" ? v : undefined;
};
const escapePointer = (s: string): string => s.replace(/~/g, "~0").replace(/\//g, "~1");
const ms = (t: string): number => Date.parse(t);

function parseJson(bytes: Uint8Array, name: string): Result<unknown> {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return err(`${name} is not valid UTF-8`);
  }
  try {
    return ok(
      JSON.parse(decoded, (_key: string, value: unknown, context?: { source?: string }) => {
        if (typeof value !== "number") return value;
        // Fail closed: without the source text a number would be a lossy float.
        if (typeof context?.source !== "string")
          throw new Error("runtime does not expose JSON number source text");
        return new NumberLexeme(context.source);
      }),
    );
  } catch (e) {
    return err(`${name} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sorted-key JSON, so the snapshot hash does not depend on property order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export type SecSourceInput = {
  id: string;
  provenance: SourcePackage["provenance"];
  originalUrl: string;
  retrievedAt: string;
  /** Raw companyfacts bytes, hashed as given. */
  companyFacts: Uint8Array;
  /** Raw submissions bytes, hashed as given. */
  submissions: Uint8Array;
};

/**
 * A validated package plus the raw submissions bytes it hashes. The fiscal calendar is read
 * from those bytes on every use, after the hash check, so it cannot be supplied separately.
 */
export type SecSource = {
  package: SourcePackage;
  submissions: Uint8Array;
};
/** A raw row or filing left out of the package, with the reason. Nothing is dropped silently. */
export type SkippedSource = { pointer: string; reason: string };
export type ReadSecSource = { source: SecSource; skipped: SkippedSource[] };

type Filing = SourcePackage["accessions"][number];

/** submissions.fiscalYearEnd exactly as written ("MMDD"), or undefined when not evidenced. */
function fiscalYearEndOf(sub: Json): string | undefined {
  const fye = text(sub, "fiscalYearEnd");
  return fye && /^(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(fye) ? fye : undefined;
}

/** Fiscal year end from submissions bytes that must match the package's submissions hash. */
async function evidencedFiscalYearEnd(
  source: SecSource,
  pkg: SourcePackage,
): Promise<Result<string>> {
  if (!(source.submissions instanceof Uint8Array))
    return err("submissions bytes are required as fiscal calendar evidence");
  if ((await sha256(source.submissions)) !== pkg.submissionsContentHash)
    return err("submissions bytes do not match the package submissions hash");
  const sub = parseJson(source.submissions, "submissions");
  if (!sub.ok) return sub;
  if (!isObject(sub.value) || text(sub.value, "cik") !== pkg.company.cik)
    return err("submissions do not belong to the package company");
  const fye = fiscalYearEndOf(sub.value);
  return fye ? ok(fye) : err("submissions fiscalYearEnd is missing or malformed");
}

function readFilings(submissions: Json, retrievedAt: string, skipped: SkippedSource[]): Filing[] {
  const filings = isObject(submissions.filings) ? submissions.filings : {};
  const recent = isObject(filings.recent) ? filings.recent : {};
  const column = (k: string): unknown[] => (Array.isArray(recent[k]) ? (recent[k] as []) : []);
  const accessions = column("accessionNumber");
  const forms = column("form");
  const accepted = column("acceptanceDateTime");
  const reports = column("reportDate");
  const originals: Filing[] = [];
  const amendments: { filing: Omit<Filing, "amends">; pointer: string }[] = [];
  for (const [i, accession] of accessions.entries()) {
    const form = FilingFormSchema.safeParse(forms[i]);
    if (!form.success) continue; // outside the supported 10-Q/10-K boundary
    const pointer = `/filings/recent/accessionNumber/${i}`;
    const acceptedAt = accepted[i];
    const reportDate = reports[i];
    const reportPeriod = PeriodSchema.safeParse({ kind: "instant", date: reportDate });
    let reason: string | undefined;
    if (typeof accession !== "string" || !/^\d{10}-\d{2}-\d{6}$/.test(accession))
      reason = "accession number is missing or malformed";
    else if (typeof acceptedAt !== "string" || !TimestampSchema.safeParse(acceptedAt).success)
      reason = "acceptance instant is missing or invalid; availability is unknown";
    else if (!reportPeriod.success) reason = "report date is missing or invalid";
    else if (ms(acceptedAt) > ms(retrievedAt)) reason = "accepted after the package was retrieved";
    if (reason || !reportPeriod.success) {
      skipped.push({ pointer, reason: reason ?? "invalid filing" });
      continue;
    }
    const filing = {
      accession: accession as string,
      form: form.data,
      acceptedAt: acceptedAt as string,
      reportPeriod: reportPeriod.data,
    };
    if (form.data.endsWith("/A")) amendments.push({ filing, pointer });
    else originals.push(filing);
  }
  const out = [...originals];
  for (const { filing, pointer } of amendments) {
    // The original is the one unamended filing of the same form and report date, accepted earlier.
    const base = filing.form.replace("/A", "");
    const date = filing.reportPeriod.kind === "instant" ? filing.reportPeriod.date : "";
    const matches = originals.filter(
      (o) =>
        o.form === base &&
        o.reportPeriod.kind === "instant" &&
        o.reportPeriod.date === date &&
        ms(o.acceptedAt) < ms(filing.acceptedAt),
    );
    if (matches.length !== 1 || !matches[0]) {
      skipped.push({ pointer, reason: "the amended original filing is not uniquely evidenced" });
      continue;
    }
    out.push({ ...filing, amends: matches[0].accession });
  }
  return out;
}

function rowProblem(row: unknown, filings: Map<string, Filing>): string | undefined {
  if (!isObject(row)) return "fact row is not an object";
  for (const k of Object.keys(row))
    if (!ROW_KEYS.has(k))
      return `unsupported fact qualifier "${k}": only consolidated, undimensioned facts are supported`;
  const accn = text(row, "accn");
  const filing = accn === undefined ? undefined : filings.get(accn);
  if (!filing) return "accession has no verified 10-Q/10-K acceptance in submissions";
  if (text(row, "form") !== filing.form) return "fact form differs from the submissions filing";
  if (!(row.val instanceof NumberLexeme) || !DecimalLexemeSchema.safeParse(row.val.text).success)
    return "value is not a plain decimal lexeme";
  return undefined;
}

function rowPeriod(row: Json): Period | undefined {
  const end = text(row, "end");
  const hasStart = Object.hasOwn(row, "start") && row.start !== null;
  const start = text(row, "start");
  if (hasStart && start === undefined) return undefined;
  const p = PeriodSchema.safeParse(
    start === undefined ? { kind: "instant", date: end } : { kind: "duration", start, end },
  );
  return p.success ? p.data : undefined;
}

/**
 * Raw companyfacts + submissions bytes to a validated SourcePackage. Keeps dictionary tags
 * only, every unit as written, the exact value lexeme and an RFC 6901 pointer per record.
 */
export async function readSecSource(input: SecSourceInput): Promise<Result<ReadSecSource>> {
  if (!TimestampSchema.safeParse(input.retrievedAt).success)
    return err("retrievedAt is not a timestamp with an explicit offset");
  const facts = parseJson(input.companyFacts, "companyfacts");
  const subs = parseJson(input.submissions, "submissions");
  if (!facts.ok || !subs.ok)
    return err(...(facts.ok ? [] : facts.errors), ...(subs.ok ? [] : subs.errors));
  if (!isObject(facts.value) || !isObject(subs.value))
    return err("companyfacts and submissions must be JSON objects");
  const cf = facts.value;
  const sub = subs.value;

  const cfCik = cf.cik instanceof NumberLexeme ? cf.cik.text : text(cf, "cik");
  const subCik = text(sub, "cik");
  if (!cfCik || !/^\d{1,10}$/.test(cfCik) || !subCik || !/^\d{10}$/.test(subCik))
    return err("companyfacts or submissions CIK is missing or malformed");
  const cik = cfCik.padStart(10, "0");
  if (cik !== subCik)
    return err(
      `companyfacts CIK ${cik} differs from submissions CIK ${subCik}; never mix companies`,
    );
  if (!fiscalYearEndOf(sub))
    return err("submissions fiscalYearEnd is missing or malformed; the fiscal calendar is unknown");
  const name = text(sub, "name") ?? text(cf, "entityName");
  if (!name?.trim()) return err("company name is missing");

  const skipped: SkippedSource[] = [];
  const accessions = readFilings(sub, input.retrievedAt, skipped);
  const byAccession = new Map(accessions.map((a) => [a.accession, a]));
  const records: SourceRecord[] = [];
  const taxonomy = isObject(cf.facts) ? cf.facts[TAXONOMY] : undefined;
  for (const [tag, concept] of Object.entries(isObject(taxonomy) ? taxonomy : {})) {
    if (!SEC_CASH_DICTIONARY.has(tag)) continue;
    const conceptPointer = `/facts/${TAXONOMY}/${escapePointer(tag)}`;
    const units = isObject(concept) ? concept.units : undefined;
    if (!isObject(units) || Object.keys(units).length === 0) {
      skipped.push({ pointer: conceptPointer, reason: "no unit; a value without a unit fails" });
      continue;
    }
    for (const [unit, rows] of Object.entries(units)) {
      const unitPointer = `${conceptPointer}/units/${escapePointer(unit)}`;
      if (!unit.trim() || !Array.isArray(rows)) {
        skipped.push({ pointer: unitPointer, reason: "blank unit or malformed rows" });
        continue;
      }
      for (const [i, row] of rows.entries()) {
        const pointer = `${unitPointer}/${i}`;
        const problem = rowProblem(row, byAccession);
        const period = problem ? undefined : rowPeriod(row as Json);
        if (problem || !period) {
          skipped.push({ pointer, reason: problem ?? "period dates are missing or invalid" });
          continue;
        }
        const r = row as Json;
        records.push({
          id: `${TAXONOMY}:${tag}:${unit}:${i}`,
          accession: text(r, "accn") as string,
          taxonomy: TAXONOMY,
          tag,
          unit,
          pointer,
          rawValue: (r.val as NumberLexeme).text,
          period,
        });
      }
    }
  }

  const pkg = SourcePackageSchema.safeParse({
    schemaVersion: 1,
    id: input.id,
    format: "sec_companyfacts_v1",
    provenance: input.provenance,
    company: { cik, name },
    originalUrl: input.originalUrl,
    retrievedAt: input.retrievedAt,
    rawContentHash: await sha256(input.companyFacts),
    submissionsContentHash: await sha256(input.submissions),
    accessions,
    records,
  });
  if (!pkg.success)
    return err(...pkg.error.issues.map((i) => `package ${i.path.join(".")}: ${i.message}`));
  return ok({ source: { package: pkg.data, submissions: input.submissions }, skipped });
}

// ---------- Record mapping ----------

export type UnmappedRecord = { recordId: string; reason: string };
export type MappedSource = {
  receipts: MappingReceipt[];
  observations: NormalizedObservation[];
  /** Records no valid receipt can describe (unknown tag, balance with a duration). */
  unmapped: UnmappedRecord[];
};

const subCent = (lexeme: string): boolean =>
  (lexeme.split(".")[1] ?? "").replace(/0+$/, "").length > 2;

/** One receipt per dictionary record; a normalized observation only for validated receipts. */
export function mapSecRecords(pkg: SourcePackage): MappedSource {
  const filings = new Map(pkg.accessions.map((a) => [a.accession, a]));
  const out: MappedSource = { receipts: [], observations: [], unmapped: [] };
  for (const record of pkg.records) {
    const entry = SEC_CASH_DICTIONARY.get(record.tag);
    if (!entry) {
      out.unmapped.push({
        recordId: record.id,
        reason: `tag ${record.tag} is not in the dictionary`,
      });
      continue;
    }
    const balance = BALANCES.includes(entry.metric);
    if (balance !== (record.period.kind === "instant")) {
      out.unmapped.push({
        recordId: record.id,
        reason: balance ? "a balance tag needs an instant period" : "a flow tag needs a duration",
      });
      continue;
    }
    const errors: string[] = [];
    if (record.taxonomy !== TAXONOMY) errors.push(`taxonomy ${record.taxonomy} is not us-gaap`);
    if (record.unit !== "USD") errors.push(`unit ${record.unit} is not USD`);
    const cents = dollarLexemeToCents(record.rawValue);
    if (cents === undefined)
      errors.push(
        subCent(record.rawValue)
          ? `unsafe value ${record.rawValue}: sub-cent digits`
          : `unsafe value ${record.rawValue}: outside safe integer cents`,
      );
    else if (balance && cents < 0) errors.push(`a balance cannot be negative: ${record.rawValue}`);
    if (entry.use === "ambiguous") errors.push(`ambiguous tag ${record.tag}`);
    const key: ObservationKey = {
      cik: pkg.company.cik,
      scope: "consolidated",
      metric: entry.metric,
      definition: `${record.taxonomy}:${record.tag}@1`,
      currency: "USD",
      period: record.period,
    };
    const status =
      entry.use === "ambiguous" ? "needs_input" : errors.length ? "rejected" : "validated";
    const receipt = MappingReceiptSchema.parse({
      id: `${pkg.id}/map/${record.id}`,
      sourcePackageId: pkg.id,
      sourceHash: pkg.rawContentHash,
      recordId: record.id,
      pointer: record.pointer,
      tag: record.tag,
      unit: record.unit,
      key,
      transform: "usd_dollars_to_cents",
      status,
      ...SOURCE_NORMALIZER,
      validationErrors: errors,
      ...(entry.use === "ambiguous" ? { question: entry.question } : {}),
    });
    out.receipts.push(receipt);
    const filing = filings.get(record.accession);
    if (status === "validated" && cents !== undefined && filing)
      out.observations.push(
        NormalizedObservationSchema.parse({
          id: `${pkg.id}/obs/${record.id}`,
          key,
          sourcePackageId: pkg.id,
          recordId: record.id,
          accession: record.accession,
          mappingReceiptId: receipt.id,
          transform: "usd_dollars_to_cents",
          rawValue: record.rawValue,
          cents,
          availableAt: filing.acceptedAt,
        }),
      );
  }
  return out;
}

// ---------- Company snapshot ----------

export type SnapshotArgs = {
  id: string;
  /** The company asked for. Must be the package company; nothing is borrowed from another. */
  cik: string;
  sourceSignature: string;
  /** Knowledge cutoff. Filings accepted after it are excluded. */
  cutoff: string;
  /** Roles the snapshot reports. complete exactly when all of them are validated. */
  roles: readonly QuarterRole[];
};

/** QuarterBridgeInput minus the financing/FX assumptions the caller still has to supply. */
export type QuarterBridgeRoles = Omit<
  QuarterBridgeInput,
  "financingAssumptionId" | "fxAssumptionId"
>;

export type CompanySnapshotResult = {
  snapshot: CompanyKnowledgeSnapshot;
  mapped: MappedSource;
  originBalanceDate: string;
  /** Present only when every BRIDGE_ROLES fact is validated. */
  bridge?: QuarterBridgeRoles;
};

type Candidate = {
  record: SourceRecord;
  receipt: MappingReceipt;
  observation?: NormalizedObservation;
  filing: Filing;
  eligible: boolean;
};
type Bound = { fact: HistoricalFact; accession: string };

const samePeriod = (a: Period, b: Period): boolean =>
  a.kind === "instant"
    ? b.kind === "instant" && a.date === b.date
    : b.kind === "duration" && a.start === b.start && a.end === b.end;
const label = (p: Period): string => (p.kind === "instant" ? p.date : `${p.start}..${p.end}`);
const blocked = (role: QuarterRole, reason: Blocked["reason"], detail: string): Blocked => ({
  role,
  status: "blocked",
  reason,
  detail,
});

function reported(c: Candidate, obs: NormalizedObservation): HistoricalFact {
  return {
    id: `fact/${c.record.id}`,
    kind: "reported",
    metric: obs.key.metric,
    period: c.record.period,
    currency: "USD",
    cents: obs.cents,
    availableAt: obs.availableAt,
    sourceId: `source/${c.record.accession}`,
    locator: c.record.pointer,
    reportedScale: "ones",
  };
}

/** Exactly one validated eligible candidate binds; anything else blocks with the reason. */
function pick(role: QuarterRole, period: Period, cands: Candidate[]): Bound | Blocked {
  const eligible = cands.filter((c) => c.eligible);
  const valid = eligible.filter((c) => c.observation);
  const [only] = valid;
  if (valid.length === 1 && only?.observation)
    return { fact: reported(only, only.observation), accession: only.record.accession };
  if (valid.length > 1)
    return blocked(
      role,
      "unresolved_conflict",
      `${valid.length} eligible candidates for ${label(period)} (${valid
        .map((c) => c.record.accession)
        .join(", ")}); reconciliation must select one`,
    );
  if (eligible.some((c) => c.receipt.status === "needs_input"))
    return blocked(role, "needs_input", `ambiguous source for ${label(period)}`);
  const unsafe = eligible.find((c) => c.receipt.validationErrors.some((e) => /^unsafe/.test(e)));
  if (unsafe) return blocked(role, "unsafe_value", unsafe.receipt.validationErrors.join("; "));
  if (eligible.length > 0)
    return blocked(
      role,
      "missing_input",
      `no valid candidate for ${label(period)}: ${eligible
        .flatMap((c) => c.receipt.validationErrors)
        .join("; ")}`,
    );
  if (cands.length > 0)
    return blocked(
      role,
      "after_cutoff",
      `${label(period)} is only in filings accepted after the cutoff (${cands
        .map((c) => c.record.accession)
        .join(", ")})`,
    );
  return blocked(role, "missing_input", `no supported fact for ${label(period)} in the package`);
}

/**
 * restricted = total - usable from one filing, bound only when that filing also reports
 * every restricted component and they sum to exactly the same cents. A missing component
 * is never assumed zero, and an ambiguous tag is never read as restricted cash.
 */
function restricted(
  origin: Period,
  usable: Bound | Blocked,
  total: Bound | Blocked,
  cands: Candidate[],
): Bound | Blocked {
  const role = "restricted_cash";
  if (!("fact" in usable) || !("fact" in total) || usable.accession !== total.accession)
    return blocked(role, "missing_input", "needs validated usable and total cash from one filing");
  const accession = usable.accession;
  const atOrigin = cands.filter(
    (c) => c.eligible && samePeriod(c.record.period, origin) && c.record.accession === accession,
  );
  // Only validated rows count, each component exactly once, so row order cannot matter.
  const valid = COMPONENTS.map((tag) =>
    atOrigin.flatMap((c) =>
      c.record.tag === tag && c.observation
        ? [{ id: c.record.id, cents: c.observation.cents }]
        : [],
    ),
  );
  const ambiguous = atOrigin.find((c) => c.receipt.status === "needs_input");
  const missing = COMPONENTS.filter((_, i) => valid[i]?.length !== 1);
  if (missing.length > 0)
    return ambiguous
      ? blocked(
          role,
          "needs_input",
          `${ambiguous.record.tag} is ambiguous and ${missing.join(", ")} is not reported once in ${accession}`,
        )
      : blocked(
          role,
          "missing_input",
          `${missing.join(", ")} not reported once in ${accession}; a missing component is never assumed zero`,
        );
  const parts = valid.flat();
  const sum = parts.reduce((s, p) => s + BigInt(p.cents), 0n);
  const diff = BigInt(total.fact.cents) - BigInt(usable.fact.cents);
  if (sum !== diff)
    return blocked(
      role,
      "unresolved_conflict",
      `components sum to ${sum} cents but total minus usable is ${diff} cents in ${accession}`,
    );
  return {
    accession,
    fact: {
      id: `fact/restricted_cash/${label(origin)}`,
      kind: "derived",
      metric: "restricted_cash",
      period: origin,
      currency: "USD",
      cents: Number(diff),
      availableAt: total.fact.availableAt,
      derivedFrom: [total.fact.id, usable.fact.id],
      derivation: `total cash including restricted minus cash and equivalents, equal to ${parts
        .map((p) => p.id)
        .join(" + ")} in ${accession}`,
    },
  };
}

/**
 * Snapshot of one company at a knowledge cutoff. The origin is the latest report date among
 * filings accepted by the cutoff; it must be a calendar quarter end in a 12-31 fiscal year.
 * Missing, late, ambiguous, unsafe or multiply-sourced roles are blocked, never zero-filled.
 */
export async function companySnapshot(
  source: SecSource,
  args: SnapshotArgs,
): Promise<Result<CompanySnapshotResult>> {
  const parsed = SourcePackageSchema.safeParse(source.package);
  if (!parsed.success)
    return err(...parsed.error.issues.map((i) => `package ${i.path.join(".")}: ${i.message}`));
  const pkg = parsed.data;
  if (args.cik !== pkg.company.cik)
    return err(`requested company ${args.cik} but the package is ${pkg.company.cik}`);
  if (!TimestampSchema.safeParse(args.cutoff).success)
    return err("cutoff is not a timestamp with an explicit offset");
  if (args.roles.length === 0) return err("at least one role is required");
  const fiscalYearEnd = await evidencedFiscalYearEnd(source, pkg);
  if (!fiscalYearEnd.ok) return fiscalYearEnd;
  if (fiscalYearEnd.value !== "1231")
    return err(
      `fiscal year ends ${fiscalYearEnd.value}; only 1231 fiscal years have evidenced calendar quarters`,
    );

  const cutoff = ms(args.cutoff);
  const eligibleFilings = pkg.accessions.filter((a) => ms(a.acceptedAt) <= cutoff);
  const origin = eligibleFilings
    .map((a) => (a.reportPeriod.kind === "instant" ? a.reportPeriod.date : a.reportPeriod.end))
    .sort()
    .at(-1);
  if (!origin) return err("no supported filing was accepted by the cutoff");
  if (!QUARTER_ENDS.has(origin.slice(5)))
    return err(`origin report date ${origin} is not a calendar quarter end`);

  const mapped = mapSecRecords(pkg);
  const records = new Map(pkg.records.map((r) => [r.id, r]));
  const filings = new Map(pkg.accessions.map((a) => [a.accession, a]));
  const observations = new Map(mapped.observations.map((o) => [o.mappingReceiptId, o]));
  const cands: Candidate[] = mapped.receipts.flatMap((receipt) => {
    const record = records.get(receipt.recordId);
    const filing = record && filings.get(record.accession);
    if (!record || !filing) return [];
    const observation = observations.get(receipt.id);
    return [
      {
        record,
        receipt,
        filing,
        eligible: ms(filing.acceptedAt) <= cutoff,
        ...(observation ? { observation } : {}),
      },
    ];
  });

  const instant: Period = { kind: "instant", date: origin };
  const ytd: Period = { kind: "duration", start: `${origin.slice(0, 4)}-01-01`, end: origin };
  const direct = (role: QuarterRole, period: Period) =>
    pick(
      role,
      period,
      cands.filter((c) => {
        const e = SEC_CASH_DICTIONARY.get(c.record.tag);
        return e?.use === "direct" && e.role === role && samePeriod(c.record.period, period);
      }),
    );
  const usable = direct("usable_cash", instant);
  const total = direct("total_cash", instant);
  const resolved = new Map<QuarterRole, Bound | Blocked>([
    ["usable_cash", usable],
    ["total_cash", total],
    ["operating_ytd", direct("operating_ytd", ytd)],
    ["investing_ytd", direct("investing_ytd", ytd)],
    ["financing_ytd", direct("financing_ytd", ytd)],
    [
      "fx_ytd",
      blocked(
        "fx_ytd",
        "missing_input",
        `dictionary ${SOURCE_NORMALIZER.dictionaryVersion} has no supported FX tag`,
      ),
    ],
    ["restricted_cash", restricted(instant, usable, total, cands)],
  ]);

  // Inputs before derived facts: restricted_cash is last in the map.
  const facts = [...resolved.values()].flatMap((b) => ("fact" in b ? [b.fact] : []));
  const sources: HistoricalSource[] = eligibleFilings.map((a) => ({
    id: `source/${a.accession}`,
    title: `${a.form} ${a.accession}`,
    url: pkg.originalUrl,
    accession: a.accession,
    publishedAt: a.acceptedAt,
    timezone: EDGAR_TIMEZONE,
    period: a.reportPeriod,
    retrievedOn: pkg.retrievedAt.slice(0, 10),
    contentHash: pkg.rawContentHash,
    ...(a.amends ? { amends: `source/${a.amends}` } : {}),
  }));
  const historicalCase: HistoricalCase = {
    id: `${args.id}/case`,
    companyName: pkg.company.name,
    provenance: pkg.provenance,
    currency: "USD",
    sources,
    facts,
    assumptions: [],
  };
  const roles: Binding[] = args.roles.map((role) => {
    const b = resolved.get(role);
    if (!b) return blocked(role, "missing_input", "unknown role");
    return "fact" in b ? { role, status: "validated", factId: b.fact.id } : b;
  });
  const body = {
    schemaVersion: 1 as const,
    id: args.id,
    cik: pkg.company.cik,
    sourceSignature: args.sourceSignature,
    cutoff: args.cutoff,
    sourcePackageIds: [pkg.id],
    mappingReceiptIds: cands.filter((c) => c.eligible).map((c) => c.receipt.id),
    reconciliations: [],
    rules: [],
    case: historicalCase,
    roles,
    completeness: roles.every((r) => r.status === "validated")
      ? ("complete" as const)
      : ("incomplete" as const),
  };
  const snapshot = CompanyKnowledgeSnapshotSchema.safeParse({
    ...body,
    contentHash: await sha256(new TextEncoder().encode(canonical(body))),
  });
  if (!snapshot.success)
    return err(...snapshot.error.issues.map((i) => `snapshot ${i.path.join(".")}: ${i.message}`));

  const factOf = (role: QuarterRole): string | undefined => {
    const b = resolved.get(role);
    return b && "fact" in b ? b.fact.id : undefined;
  };
  const [u, t, o, i] = BRIDGE_ROLES.map(factOf);
  const bridge =
    u && t && o && i
      ? {
          case: snapshot.data.case,
          knowledgeCutoff: args.cutoff,
          originBalanceDate: origin,
          usableCashFactId: u,
          totalCashFactId: t,
          operatingYtdFactId: o,
          investingYtdFactId: i,
        }
      : undefined;
  return ok({
    snapshot: snapshot.data,
    mapped,
    originBalanceDate: origin,
    ...(bridge ? { bridge } : {}),
  });
}
