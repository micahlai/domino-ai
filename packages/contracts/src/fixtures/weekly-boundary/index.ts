/**
 * Weekly seam v2 fixtures (WeeklySeedV1). Raw wire values: parse them with parseWeeklySeedJson.
 *
 * - validKestrelWeeklySeed: the deterministic sim "kestrel" snapshot (createCompany seed 42,
 *   asOf 2026-10-30) with four scheduled items taken from its open invoices, bills and payroll
 *   and one finding about a visible record. Built by hand for the seam, not output of a Field
 *   ingestion or audit agent. No answer key, sim runtime or pending events were used.
 * - tamperedKestrelWeeklySeed: the same seed with one scheduled amount changed and the old
 *   contentHash kept. Schema-valid, so only the recomputed hash rejects it.
 *
 * fixtureHash = SHA-256 of canonicalJson(whole fixture). contentHash = declared seed hash.
 */
import validKestrel from "./kestrel-weekly-seed.json";

export const validKestrelWeeklySeed: unknown = validKestrel;

export const tamperedKestrelWeeklySeed: unknown = {
  ...validKestrel,
  scheduledItems: validKestrel.scheduledItems.map((item, i) =>
    i === 2 ? { ...item, cents: item.cents * 10 } : item,
  ),
};

export const WEEKLY_BOUNDARY_FIXTURE_HASHES = {
  validKestrelWeeklySeed: {
    fixtureHash: "36110dba71f77b925a5891a910f634a29501c368c314895f8a09ea826ac4c6ac",
    contentHash: "db8ad3dc94f49b962f1763ad005b43cdc07bbbd494f99f1ca07a3018ca25cfab",
  },
} as const;
