import { TIMELINE_METHODS } from "@domino/contracts";
import { QUARTER_BRIDGE_METHOD } from "@domino/engine";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_NAMES,
  type FixtureName,
  PINNED_FIXTURE_HASHES,
  PINNED_WEEKLY_FIXTURE_HASHES,
  fixtureText,
  sha256Hex,
  verifyFixtureText,
  verifyResultRefText,
  verifySeedText,
  verifyWeeklySeedText,
  weeklyFixtureText,
} from "./verify";

const VALID: FixtureName[] = ["validTwoUSeed", "blockedSeed", "savedResultRef", "postRevealTwoU"];

/** Replaces one non-whitespace character with a different character of the same class. */
function tamper(text: string, at: number): string {
  const c = text[at] as string;
  const swap = /[0-9]/.test(c)
    ? c === "0"
      ? "1"
      : "0"
    : /[a-z]/i.test(c)
      ? c === "a"
        ? "b"
        : "a"
      : null;
  if (swap === null) return text;
  return text.slice(0, at) + swap + text.slice(at + 1);
}

/** Evenly spread positions of letters or digits, so every region of the record is touched. */
function positions(text: string, count: number): number[] {
  const all = [...text].flatMap((c, i) => (/[0-9a-z]/i.test(c) ? [i] : []));
  const step = Math.max(1, Math.floor(all.length / count));
  return all.filter((_, i) => i % step === 0).slice(0, count);
}

describe("feature-boundary verifier (P0-H)", () => {
  it("uses standard SHA-256", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it.each(VALID)("verifies %s against every pinned hash", async (name) => {
    const r = await verifyFixtureText(name, fixtureText(name));
    expect(r).toMatchObject({ ok: true, fixtureHash: PINNED_FIXTURE_HASHES[name].fixtureHash });
  });

  it("recomputes the seed and snapshot content hashes", async () => {
    const r = await verifySeedText(fixtureText("validTwoUSeed"), { forecastReady: true });
    expect(r).toMatchObject({
      ok: true,
      contentHash: PINNED_FIXTURE_HASHES.validTwoUSeed.contentHash,
      snapshotContentHash: PINNED_FIXTURE_HASHES.validTwoUSeed.snapshotContentHash,
    });
  });

  it.each(FIXTURE_NAMES)("rejects a one-character tamper anywhere in %s", async (name) => {
    const text = fixtureText(name);
    for (const at of positions(text, 40)) {
      const changed = tamper(text, at);
      expect(changed).not.toBe(text);
      const r = await verifyFixtureText(name, changed);
      expect(r.ok, `tamper at ${at} (${JSON.stringify(text.slice(at - 10, at + 10))})`).toBe(false);
    }
  });

  it("rejects a tampered seed with no pinned hash by recomputing its content hash", async () => {
    const seed = JSON.parse(fixtureText("validTwoUSeed"));
    seed.exportedAt = "2026-10-24T12:00:01Z";
    const r = await verifySeedText(JSON.stringify(seed));
    expect(r).toEqual({ ok: false, reason: "seed contentHash does not match its content" });
    const snap = JSON.parse(fixtureText("validTwoUSeed"));
    snap.snapshot.case.facts[0].quote = `${snap.snapshot.case.facts[0].quote ?? ""}x`;
    expect((await verifySeedText(JSON.stringify(snap))).ok).toBe(false);
  });

  it("rejects the blocked seed as forecast input and the mismatched seed outright", async () => {
    const blocked = await verifySeedText(fixtureText("blockedSeed"), { forecastReady: true });
    expect(blocked.ok).toBe(false);
    expect((await verifySeedText(fixtureText("mismatchedSeed"))).ok).toBe(false);
    expect((await verifyFixtureText("mismatchedSeed", fixtureText("mismatchedSeed"))).ok).toBe(
      false,
    );
  });

  it("rejects a result ref checked against another seed", async () => {
    const r = await verifyResultRefText(fixtureText("blockedSeed"), fixtureText("savedResultRef"));
    expect(r.ok).toBe(false);
  });

  it("rejects non-text and malformed input without throwing", async () => {
    for (const input of [undefined, 42, {}, "", "{", "null"])
      expect((await verifySeedText(input)).ok).toBe(false);
  });
});

describe("deferred P0-C parity", () => {
  it("TIMELINE_METHODS equals the engine QUARTER_BRIDGE_METHOD", () => {
    expect(TIMELINE_METHODS.map(({ id, version }) => ({ id, version }))).toEqual([
      { ...QUARTER_BRIDGE_METHOD },
    ]);
  });
});

describe("weekly seed verifier (P0 v2)", () => {
  it("verifies the Kestrel weekly fixture against its pins and rejects the tampered copy", async () => {
    const pins = PINNED_WEEKLY_FIXTURE_HASHES.validKestrelWeeklySeed;
    const ok = await verifyWeeklySeedText(weeklyFixtureText("validKestrelWeeklySeed"), {
      expectedFixtureHash: pins.fixtureHash,
    });
    expect(ok.ok && ok.contentHash).toBe(pins.contentHash);
    const bad = await verifyWeeklySeedText(weeklyFixtureText("tamperedKestrelWeeklySeed"));
    expect(bad).toEqual({
      ok: false,
      reason: "weekly seed contentHash does not match its content",
    });
    expect((await verifyWeeklySeedText("{")).ok).toBe(false);
  });
});
