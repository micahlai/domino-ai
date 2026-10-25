/**
 * P0-C public feature-boundary fixtures, schema version 1 / boundary 1.0.0. Raw wire values
 * (unknown until parsed): both lanes parse them unchanged with the same schemas and pin the
 * same hashes. Exposed data only, never evaluation, sealed or withheld packages.
 *
 * - validTwoUSeed: public 2U, Inc. case (data/historical/2u/case.json) filtered to the
 *   2023-11-10 cutoff: S7 and F01-F08 plus every case assumption. The snapshot wrapper
 *   (ids, sourceSignature, role bindings) is assembled for this fixture from the reviewed
 *   case; it is not output of the Field SEC normalizer, so it has no mapping receipts.
 * - blockedSeed: SYNTHETIC invented company and figures. investing_ytd is missing, so the
 *   seed is valid but blocked. Missing financing/FX facts do not block it: the method takes
 *   those as explicit assumptions.
 * - mismatchedSeed: the 2U seed relabelled to another (synthetic) CIK with a stale snapshot
 *   ref. Must fail validation.
 * - savedResultRef: a saved 2U A1 response result reference (post-hoc, as the 2U protocol
 *   labels the response). Ids are illustrative domain ids, not saved Convex records.
 * - postRevealTwoU: S8 and its reported facts H01-H07. Never part of a seed.
 *
 * fixtureHash = SHA-256 of canonicalJson(whole fixture). contentHash = the declared
 * seed hash (preimage excludes it). See FEATURE_BOUNDARY_HASH.
 */
import blocked from "./blocked-seed.json";
import mismatched from "./mismatched-seed.json";
import postReveal from "./post-reveal-2u.json";
import savedResult from "./saved-result-ref.json";
import validTwoU from "./valid-2u-seed.json";

export const validTwoUSeed: unknown = validTwoU;
export const blockedSeed: unknown = blocked;
export const mismatchedSeed: unknown = mismatched;
export const savedResultRef: unknown = savedResult;
export const postRevealTwoU: unknown = postReveal;

export const FEATURE_BOUNDARY_FIXTURE_HASHES = {
  validTwoUSeed: {
    fixtureHash: "7f8a48bc25eb4782bcc33323e147784de7664737677c155a9e62d6c644043644",
    contentHash: "ec648c0c49a46a489346ab628df57adc26fd17de49b67aab5dbcc147cd9fe2ef",
    snapshotContentHash: "691c60f0a42843c4d7b50330a323a40f0f5ebbed200e983eb42e2b7d14d1c11b",
  },
  blockedSeed: {
    fixtureHash: "ac9b114a60fd605c68e752a47c0928a86684d09c6ecf41e551597a337baf3392",
    contentHash: "eb38f85f582e8540872c78befc76067c90eea04162d30d5530a4201b7a91ea00",
    snapshotContentHash: "54ca5b9c03251a273ed1e9770c75911f4518d77d462dc00128145f903b6a99c9",
  },
  mismatchedSeed: {
    fixtureHash: "884e5a69193956c28931f728888326cf92216e116e0fcb1dcd17524b5fee76dd",
    contentHash: "f7ace1819c3ccc6708328ddc5cf17eb4c32f990fc96a01e5ff621bcba085fdfd",
    snapshotContentHash: "691c60f0a42843c4d7b50330a323a40f0f5ebbed200e983eb42e2b7d14d1c11b",
  },
  savedResultRef: {
    fixtureHash: "3847404c535a97dd39b4f36626ac939f11e2b0fd77bb5b26b5d4cf050489fbe6",
  },
  postRevealTwoU: {
    fixtureHash: "9def5cd4de275433bec682ec3908166b40b22f05d9a6825b8e2ac7fde73bb77c",
  },
} as const;
