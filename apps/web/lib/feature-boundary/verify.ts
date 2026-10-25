import {
  FEATURE_BOUNDARY_HASH,
  type TimelineResultRefV1,
  type TimelineRevealV1,
  type TimelineSeedV1,
  canonicalJson,
  contentHashPreimage,
  parseForecastReadyTimelineSeedJson,
  parseTimelineResultRefContextJson,
  parseTimelineRevealContextJson,
  parseTimelineSeedJson,
} from "@domino/contracts";
import { featureBoundaryFixtures as fx } from "@domino/contracts/fixtures";
import type { z } from "zod";

// P0-H consumer-side verifier, shared by both lanes (frozen common code, like the contracts).
// The frozen boundary is JSON text: parse it with the contract's parse*Json function, then
// RECOMPUTE every declared digest (the schemas check shape only) and reject on mismatch.
// Scheme sha256/domino-canonical-json-v1: lowercase hex SHA-256 of the UTF-8 bytes of
// canonicalJson(value). A seed or snapshot contentHash digests the record minus its own
// contentHash (contentHashPreimage). A fixture hash digests the whole value.

export type Verified<T> =
  | { ok: true; value: T; fixtureHash: string; contentHash?: string; snapshotContentHash?: string }
  | { ok: false; reason: string };

/** Web Crypto SHA-256 (browser, Node 24, edge). Never a hand-rolled digest. */
export async function sha256Hex(text: string): Promise<string> {
  if (FEATURE_BOUNDARY_HASH.algorithm !== "SHA-256") throw new Error("unsupported hash scheme");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const fail = (reason: string) => ({ ok: false as const, reason });
const issueText = (e: z.ZodError) => {
  const i = e.issues[0];
  return i ? `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}` : "invalid";
};

/** Digests that must match before a seed is used: snapshot, snapshot ref, then seed. */
async function checkSeedHashes(seed: TimelineSeedV1) {
  const snapshotContentHash = await sha256Hex(contentHashPreimage(seed.snapshot));
  if (snapshotContentHash !== seed.snapshot.contentHash)
    return fail("snapshot contentHash does not match its content");
  if (seed.snapshotRef.contentHash !== snapshotContentHash)
    return fail("snapshotRef names other snapshot content");
  const contentHash = await sha256Hex(contentHashPreimage(seed));
  if (contentHash !== seed.contentHash) return fail("seed contentHash does not match its content");
  return { ok: true as const, contentHash, snapshotContentHash };
}

export interface VerifyOptions {
  /** A digest pinned out of band (for example a published fixture hash). */
  expectedFixtureHash?: string;
}

async function pinned<T>(value: T, opts: VerifyOptions) {
  const fixtureHash = await sha256Hex(canonicalJson(value));
  if (opts.expectedFixtureHash !== undefined && fixtureHash !== opts.expectedFixtureHash)
    return fail("content does not match the pinned hash");
  return { ok: true as const, fixtureHash };
}

/** A TimelineSeedV1 from JSON text. forecastReady also rejects valid blocked seeds. */
export async function verifySeedText(
  text: unknown,
  opts: VerifyOptions & { forecastReady?: boolean } = {},
): Promise<Verified<TimelineSeedV1>> {
  const parsed = opts.forecastReady
    ? parseForecastReadyTimelineSeedJson(text)
    : parseTimelineSeedJson(text);
  if (!parsed.success) return fail(issueText(parsed.error));
  const hashes = await checkSeedHashes(parsed.data);
  if (!hashes.ok) return hashes;
  const pin = await pinned(parsed.data, opts);
  if (!pin.ok) return pin;
  const { contentHash, snapshotContentHash } = hashes;
  return {
    ok: true,
    value: parsed.data,
    contentHash,
    snapshotContentHash,
    fixtureHash: pin.fixtureHash,
  };
}

/** A result ref or reveal, checked against the seed text it names (which is verified first). */
async function verifyAgainstSeed<T>(
  seedText: unknown,
  text: unknown,
  parse: (
    a: unknown,
    b: unknown,
  ) => z.SafeParseReturnType<unknown, { seed: TimelineSeedV1 } & Record<string, unknown>>,
  key: "result" | "reveal",
  opts: VerifyOptions,
): Promise<Verified<T>> {
  const seed = await verifySeedText(seedText);
  if (!seed.ok) return fail(`seed: ${seed.reason}`);
  const parsed = parse(seedText, text);
  if (!parsed.success) return fail(issueText(parsed.error));
  const value = parsed.data[key] as T;
  const pin = await pinned(value, opts);
  return pin.ok ? { ok: true, value, fixtureHash: pin.fixtureHash } : pin;
}

export const verifyResultRefText = (seedText: unknown, text: unknown, opts: VerifyOptions = {}) =>
  verifyAgainstSeed<TimelineResultRefV1>(
    seedText,
    text,
    parseTimelineResultRefContextJson,
    "result",
    opts,
  );

export const verifyRevealText = (seedText: unknown, text: unknown, opts: VerifyOptions = {}) =>
  verifyAgainstSeed<TimelineRevealV1>(
    seedText,
    text,
    parseTimelineRevealContextJson,
    "reveal",
    opts,
  );

// ---------- P0-C public fixtures, as JSON text ----------

export type FixtureName = keyof typeof fx.FEATURE_BOUNDARY_FIXTURE_HASHES;
export const FIXTURE_NAMES = Object.keys(fx.FEATURE_BOUNDARY_FIXTURE_HASHES) as FixtureName[];
export const PINNED_FIXTURE_HASHES = fx.FEATURE_BOUNDARY_FIXTURE_HASHES;

/** The labelled peer fixture exactly as it would cross the boundary: JSON text. */
export function fixtureText(name: FixtureName): string {
  return JSON.stringify(fx[name], null, 2);
}

/** Verifies fixture text against every digest P0-C pins for it. */
export async function verifyFixtureText(
  name: FixtureName,
  text: string,
): Promise<Verified<unknown>> {
  const pins: { fixtureHash: string; contentHash?: string; snapshotContentHash?: string } =
    PINNED_FIXTURE_HASHES[name];
  const opts = { expectedFixtureHash: pins.fixtureHash };
  const seedText = fixtureText("validTwoUSeed");
  if (name === "savedResultRef") return verifyResultRefText(seedText, text, opts);
  if (name === "postRevealTwoU") return verifyRevealText(seedText, text, opts);
  const r = await verifySeedText(text, opts);
  if (!r.ok) return r;
  if (r.contentHash !== pins.contentHash || r.snapshotContentHash !== pins.snapshotContentHash)
    return fail("content hashes differ from the pinned fixture hashes");
  return r;
}
