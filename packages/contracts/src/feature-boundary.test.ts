import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { featureBoundaryFixtures as fx } from "./fixtures";
import {
  BOUNDARY_INTEGER_MAX,
  BOUNDARY_MAX_DEPTH,
  BOUNDARY_MAX_JSON_LENGTH,
  DomainIdSchema,
  FEATURE_BOUNDARY_HASH,
  ForecastReadyTimelineSeedV1Schema,
  MAX_BENEFIT_LAG_DAYS,
  MAX_CHAIN_DEPTH,
  MAX_DERIVATION_VISITS,
  type OperationSummaryV1,
  OperationSummaryV1Schema,
  TIMELINE_METHODS,
  TimelineResultRefContextV1Schema,
  type TimelineResultRefV1,
  TimelineResultRefV1Schema,
  TimelineRevealContextV1Schema,
  type TimelineRevealV1,
  TimelineRevealV1Schema,
  type TimelineSeedV1,
  TimelineSeedV1Schema,
  canonicalJson,
  contentHashPreimage,
  parseForecastReadyTimelineSeedJson,
  parseOperationSummaryJson,
  parseTimelineResultRefContextJson,
  parseTimelineResultRefJson,
  parseTimelineRevealContextJson,
  parseTimelineRevealJson,
  parseTimelineSeedJson,
  safeParseJsonText,
} from "./index";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
type Safe = { success: boolean; error?: { issues: { message: string }[] } };
const messages = (r: Safe) => (r.success ? [] : r.error!.issues.map((i) => i.message));
const check = (schema: { safeParse: (v: unknown) => unknown }, v: unknown) =>
  messages(schema.safeParse(v) as Safe);
const mutated = <T>(
  schema: { safeParse: (v: unknown) => unknown },
  base: T,
  edit: (v: T) => void,
) => {
  const v = clone(base);
  edit(v);
  return check(schema, v);
};

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const seed = fx.validTwoUSeed as TimelineSeedV1;
const blocked = fx.blockedSeed as TimelineSeedV1;
const result = fx.savedResultRef as TimelineResultRefV1;
const reveal = fx.postRevealTwoU as TimelineRevealV1;
const S = TimelineSeedV1Schema;

describe("canonical hash", () => {
  it("sorts keys at every depth, keeps array order, drops undefined, no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null }, e: undefined })).toBe(
      '{"a":{"c":null,"d":[2,1]},"b":1}',
    );
    expect(canonicalJson([3, "x", true, -0])).toBe('[3,"x",true,0]');
    expect(canonicalJson({ é: "é\n", B: 1, a: 2 })).toBe('{"B":1,"a":2,"é":"é\\n"}');
  });

  it.each([
    ["NaN", { n: Number.NaN }],
    ["Infinity", [Number.POSITIVE_INFINITY]],
    ["a bigint", { n: 1n }],
    ["a Date", { d: new Date(0) }],
    ["a Map", new Map()],
    ["undefined in an array", [undefined]],
    // biome-ignore lint/suspicious/noSparseArray: the hole is the case under test
    ["an array hole", [1, , 2]],
    ["undefined at the top level", undefined],
    [
      "a cycle",
      (() => {
        const v: Record<string, unknown> = {};
        v.self = v;
        return v;
      })(),
    ],
  ])("rejects %s", (_, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it("is SHA-256 over UTF-8 canonical bytes (same vector as @domino/agents hashInput)", async () => {
    expect(FEATURE_BOUNDARY_HASH.scheme).toBe("sha256/domino-canonical-json-v1");
    expect(await sha256(canonicalJson({}))).toBe(
      "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    );
    expect(await sha256(canonicalJson({ y: [1, 2], x: 1 }))).toBe(
      await sha256(canonicalJson({ x: 1, y: [1, 2] })),
    );
  });

  it("excludes only the top-level contentHash from the preimage", () => {
    const pre = contentHashPreimage({ contentHash: "x", inner: { contentHash: "y" } });
    expect(pre).toBe('{"inner":{"contentHash":"y"}}');
  });

  it("pins every public fixture hash and the declared seed and snapshot hashes", async () => {
    const all = {
      validTwoUSeed: fx.validTwoUSeed,
      blockedSeed: fx.blockedSeed,
      mismatchedSeed: fx.mismatchedSeed,
      savedResultRef: fx.savedResultRef,
      postRevealTwoU: fx.postRevealTwoU,
    };
    for (const [name, value] of Object.entries(all)) {
      const pinned = fx.FEATURE_BOUNDARY_FIXTURE_HASHES[name as keyof typeof all];
      expect(await sha256(canonicalJson(value)), name).toBe(pinned.fixtureHash);
      if (!("contentHash" in pinned)) continue;
      const s = value as TimelineSeedV1;
      expect(s.contentHash, name).toBe(pinned.contentHash);
      expect(await sha256(contentHashPreimage(s)), name).toBe(s.contentHash);
      expect(s.snapshot.contentHash, name).toBe(pinned.snapshotContentHash);
      expect(await sha256(contentHashPreimage(s.snapshot)), name).toBe(s.snapshot.contentHash);
    }
  });
});

describe("public fixtures", () => {
  it("accepts the valid pre-cutoff 2U seed as forecast-ready", () => {
    expect(check(ForecastReadyTimelineSeedV1Schema, seed)).toEqual([]);
    expect(seed.snapshot.case.facts.map((f) => f.id)).toEqual([
      "F01",
      "F02",
      "F03",
      "F05",
      "F06",
      "F07",
      "F08",
    ]);
  });

  it("accepts the blocked seed as a seed but never as forecast-ready", () => {
    expect(check(S, blocked)).toEqual([]);
    expect(check(ForecastReadyTimelineSeedV1Schema, blocked)).toEqual([
      "a seed with a blocked required role is not forecast-ready",
    ]);
  });

  it("rejects the mismatched seed for its stale snapshot ref and foreign company", () => {
    expect(check(S, fx.mismatchedSeed)).toEqual([
      "snapshot content hash differs",
      "company differs from snapshot",
    ]);
  });

  it("accepts the saved result ref and the separate reveal against the valid seed", () => {
    expect(check(TimelineResultRefV1Schema, result)).toEqual([]);
    expect(check(TimelineResultRefContextV1Schema, { seed, result })).toEqual([]);
    expect(check(TimelineRevealV1Schema, reveal)).toEqual([]);
    expect(check(TimelineRevealContextV1Schema, { seed, reveal })).toEqual([]);
  });

  it("parses to exactly the input bytes", () => {
    expect(canonicalJson(S.parse(seed))).toBe(canonicalJson(seed));
  });
});

describe("seed chronology", () => {
  it("rejects post-reveal sources and facts inside a seed", () => {
    expect(
      mutated(S, seed, (s) => {
        s.snapshot.case.sources.push(...clone(reveal.disclosures.sources));
        s.snapshot.case.facts.push(...clone(reveal.disclosures.facts));
      }),
    ).toEqual(expect.arrayContaining(["fact is after the cutoff", "source is after the cutoff"]));
  });

  it("rejects an unused source published after the cutoff", () => {
    expect(
      mutated(S, seed, (s) => s.snapshot.case.sources.push(clone(reveal.disclosures.sources[0]!))),
    ).toEqual(["source is after the cutoff"]);
  });

  it("rejects a bridge cutoff that differs from the snapshot", () => {
    expect(
      mutated(S, seed, (s) => {
        s.quarterBridge.knowledgeCutoff = "2023-11-11T23:59:59-05:00";
      }),
    ).toEqual(["bridge cutoff differs from the snapshot cutoff"]);
  });

  it("rejects an export before the cutoff", () => {
    expect(
      mutated(S, seed, (s) => {
        s.exportedAt = "2023-11-10T00:00:00-05:00";
      }),
    ).toEqual(["exported before the cutoff"]);
  });

  it("needs a quarter-end origin, the next quarter-end target and a cutoff between them", () => {
    expect(
      mutated(S, seed, (s) => {
        s.quarterBridge.originBalanceDate = "2023-09-29";
      }),
    ).toEqual(expect.arrayContaining(["origin is not a calendar quarter end"]));
    expect(
      mutated(S, seed, (s) => {
        s.quarterBridge.targetDate = "2024-03-31";
      }),
    ).toEqual(["target is not the quarter end after the origin"]);
    expect(
      mutated(S, seed, (s) => {
        s.quarterBridge.originBalanceDate = "2023-12-31";
        s.quarterBridge.targetDate = "2024-03-31";
      }),
    ).toEqual(expect.arrayContaining(["cutoff must fall inside the target quarter"]));
  });
});

describe("seed post-hoc taint", () => {
  it("rejects a hindsight assumption anywhere in the case, used or not", () => {
    expect(
      mutated(S, seed, (s) => {
        s.snapshot.case.assumptions[4]!.label = "hindsight";
      }),
    ).toEqual(["hindsight assumption in a seed"]);
  });

  it("rejects a post-reveal selection anywhere in the case", () => {
    expect(
      mutated(S, seed, (s) => {
        s.snapshot.case.assumptions[3]!.selectedAfterReveal = true;
      }),
    ).toEqual(["post-reveal assumption in a seed"]);
  });

  it("never accepts a post-hoc seed", () => {
    expect(
      mutated(S, seed, (s) => {
        (s as { postHoc: boolean }).postHoc = true;
      }),
    ).toHaveLength(1);
  });
});

describe("seed dependency closure", () => {
  it("rejects a missing, duplicate or non-cents selected assumption", () => {
    expect(
      mutated(S, seed, (s) => {
        s.quarterBridge.fxAssumptionId = "AS-NONE";
      }),
    ).toEqual(["selected assumption not in the snapshot case"]);
    expect(mutated(S, seed, (s) => s.quarterBridge.methodAssumptionIds.push("AS-FIN0"))).toEqual([
      "assumption selected twice",
    ]);
    expect(
      mutated(S, seed, (s) => {
        s.snapshot.case.assumptions[0]!.value.unit = "days";
      }),
    ).toEqual(["selected assumption is not in cents"]);
  });

  it("rejects an assumption dependency or basis missing from the case", () => {
    expect(
      mutated(S, seed, (s) => {
        s.snapshot.case.assumptions[4]!.dependsOn = ["A-GONE"];
      }),
    ).toEqual(["dependencies must be listed earlier"]);
    expect(
      mutated(S, seed, (s) => {
        s.snapshot.case.assumptions[2]!.basisFactIds = ["H02"];
      }),
    ).toEqual(["basis fact not found"]);
  });

  it("rejects role facts that differ from the snapshot binding or the method shape", () => {
    expect(
      mutated(S, seed, (s) => {
        s.quarterBridge.roleFacts.usable_cash = "F03";
      }),
    ).toEqual(["role fact differs from the snapshot binding"]);
    const rebind = (role: string, factId: string) => (s: TimelineSeedV1) => {
      const r = s.snapshot.roles.find((x) => x.role === role)!;
      if (r.status === "validated") r.factId = factId;
      (s.quarterBridge.roleFacts as Record<string, string>)[role] = factId;
    };
    expect(mutated(S, seed, rebind("total_cash", "F01"))).toEqual([
      "role fact is not cash_including_restricted",
    ]);
    expect(mutated(S, seed, rebind("usable_cash", "F404"))).toEqual(
      expect.arrayContaining(["role fact not in the snapshot case"]),
    );
    expect(
      mutated(S, seed, (s) => {
        const f = s.snapshot.case.facts.find((x) => x.id === "F06")!;
        f.period = { kind: "duration", start: "2023-07-01", end: "2023-09-30" };
      }),
    ).toEqual(["YTD flows have different starts"]);
    expect(
      mutated(S, seed, (s) => {
        const f = s.snapshot.case.facts.find((x) => x.id === "F01")!;
        f.period = { kind: "instant", date: "2023-06-30" };
      }),
    ).toEqual(["role fact does not end at the origin balance date"]);
  });
});

describe("seed company linkage", () => {
  it("rejects another company, name or provenance", () => {
    expect(
      mutated(S, seed, (s) => {
        s.company.cik = "0000000002";
      }),
    ).toEqual(["company differs from snapshot"]);
    expect(
      mutated(S, seed, (s) => {
        s.company.name = "2U";
      }),
    ).toEqual(["company name differs from the snapshot case"]);
    expect(
      mutated(S, seed, (s) => {
        s.provenance = "synthetic_fixture";
      }),
    ).toEqual(["provenance differs from the snapshot case"]);
  });

  it("rejects a snapshot ref that names other content", () => {
    expect(
      mutated(S, seed, (s) => {
        s.snapshotRef.id = "field:snapshot/other";
      }),
    ).toEqual(["snapshot id differs"]);
  });

  it("rejects a reconciliation receipt for another company", () => {
    expect(
      mutated(S, seed, (s) => {
        s.snapshot.reconciliations.push({
          id: "rec1",
          key: {
            cik: "0000000002",
            scope: "consolidated",
            metric: "cash_and_equivalents",
            definition: "us-gaap:CashAndCashEquivalentsAtCarryingValue@1",
            currency: "USD",
            period: { kind: "instant", date: "2023-09-30" },
          },
          candidateIds: ["o1"],
          classification: "single",
          outcome: {
            kind: "selected",
            selectedIds: ["o1"],
            authority: { kind: "deterministic_method", methodId: "dedup", version: "1.0.0" },
          },
          rationale: "single candidate",
          sourceAvailableAt: "2023-11-09T16:01:00-05:00",
          recordedAt: "2023-11-09T16:01:00-05:00",
          effectiveFrom: "2023-11-09T16:01:00-05:00",
          eligibleAt: "2023-11-09T16:01:00-05:00",
        });
      }),
    ).toEqual(["receipt is for another company"]);
  });
});

describe("seed required-role completeness", () => {
  const blockRole = (role: string) => (s: TimelineSeedV1) => {
    const i = s.snapshot.roles.findIndex((r) => r.role === role);
    s.snapshot.roles[i] = {
      role: role as "investing_ytd",
      status: "blocked",
      reason: "unresolved_conflict",
      detail: "two candidates disagree",
    };
    s.snapshot.completeness = "incomplete";
  };

  it("rejects a forecast_ready claim with a blocked required role", () => {
    expect(
      mutated(S, seed, (s) => {
        blockRole("investing_ytd")(s);
        s.quarterBridge.roleFacts.investing_ytd = undefined;
      }),
    ).toEqual(["blocked required roles must be listed exactly: investing_ytd"]);
  });

  it("rejects a fact bound to a blocked role", () => {
    expect(
      mutated(S, seed, (s) => {
        blockRole("investing_ytd")(s);
        s.readiness = { status: "blocked", blockedRoles: ["investing_ytd"] };
      }),
    ).toEqual(["a blocked or missing role has no fact"]);
  });

  it("treats a required role absent from the snapshot as blocked", () => {
    expect(
      mutated(S, seed, (s) => {
        s.snapshot.roles = s.snapshot.roles.filter((r) => r.role !== "operating_ytd");
        s.quarterBridge.roleFacts.operating_ytd = undefined;
      }),
    ).toEqual(["blocked required roles must be listed exactly: operating_ytd"]);
  });

  it("rejects blocked readiness when every required role is validated", () => {
    expect(
      mutated(S, seed, (s) => {
        s.readiness = { status: "blocked", blockedRoles: ["fx_ytd" as "usable_cash"] };
      }),
    ).toHaveLength(1);
    expect(
      mutated(S, seed, (s) => {
        s.readiness = { status: "blocked", blockedRoles: ["usable_cash"] };
      }),
    ).toEqual(["every required role is validated, so the seed is forecast_ready"]);
  });

  it("does not let an unused missing FX observation block the method", () => {
    const v = clone(seed);
    blockRole("fx_ytd")(v);
    expect(check(ForecastReadyTimelineSeedV1Schema, v)).toEqual([]);
  });
});

describe("seed method and protocol pins", () => {
  it("rejects an unsupported or floating method and other boundary or hash versions", () => {
    expect(TIMELINE_METHODS.map((m) => `${m.id}@${m.version}`)).toEqual([
      "quarterly_cash_bridge@0.1.0",
    ]);
    expect(
      mutated(S, seed, (s) => {
        s.pins.method.version = "0.2.0";
      }),
    ).toEqual(["method is not a supported pinned timeline method"]);
    expect(
      mutated(S, seed, (s) => {
        s.pins.method.id = "latest";
      }),
    ).toEqual(expect.arrayContaining(["a sealed identity cannot be latest"]));
    for (const edit of [
      (s: TimelineSeedV1) => {
        (s.pins as { boundaryVersion: string }).boundaryVersion = "1.0.1";
      },
      (s: TimelineSeedV1) => {
        (s.pins as { hashScheme: string }).hashScheme = "sha1/json";
      },
      (s: TimelineSeedV1) => {
        (s.pins as { snapshotSchemaVersion: number }).snapshotSchemaVersion = 2;
      },
      (s: TimelineSeedV1) => {
        (s as { schemaVersion: number }).schemaVersion = 2;
      },
    ])
      expect(mutated(S, seed, edit)).toHaveLength(1);
  });
});

describe("seed identity and strictness", () => {
  it("rejects Convex document ids and ids owned by the other domain", () => {
    expect(DomainIdSchema.safeParse("jd7f3k2m9x8q1w5e6r4t0y2u3i").success).toBe(false);
    expect(
      mutated(S, seed, (s) => {
        s.id = "jd7f3k2m9x8q1w5e6r4t0y2u3i";
      }),
    ).toHaveLength(2);
    expect(
      mutated(S, seed, (s) => {
        s.id = "timeline:seed/twou";
      }),
    ).toEqual(["expected a field:seed/ domain id"]);
  });

  it("rejects unknown fields at any depth instead of dropping them", () => {
    expect(mutated(S, seed, (s) => Object.assign(s, { providerPacket: {} }))).toHaveLength(1);
    expect(
      mutated(S, seed, (s) => Object.assign(s.snapshot.case.facts[0]!, { apiKey: "sk-test" })),
    ).toEqual(["field is not part of the contract (unknown field or omitted default)"]);
    const paths = (
      S.safeParse(
        (() => {
          const v = clone(seed);
          Object.assign(v.snapshot.case.sources[0]!, { reasoning: "hidden" });
          return v;
        })(),
      ).error?.issues ?? []
    ).map((i) => i.path.join("."));
    expect(paths).toEqual(["snapshot.case.sources.0.reasoning"]);
  });

  it("rejects an omitted default, so the parsed and hashed bytes agree", () => {
    expect(
      mutated(S, seed, (s) => {
        // biome-ignore lint/performance/noDelete: the key must be absent, not undefined
        delete (s.snapshot.case.assumptions[0] as { dependsOn?: string[] }).dependsOn;
      }),
    ).toEqual(["field is not part of the contract (unknown field or omitted default)"]);
  });

  it("rejects non-JSON values", () => {
    const v = clone(seed) as unknown as Record<string, unknown>;
    expect(check(S, { ...v, exportedAt: new Date() })).toHaveLength(1);
  });
});

describe("result reference", () => {
  const R = TimelineResultRefV1Schema;

  it("rejects Convex ids, wrong owners and a mismatched route", () => {
    expect(
      mutated(R, result, (r) => {
        r.baselineRunId = "k57a9b3c2d1e0f";
      }),
    ).toHaveLength(2);
    expect(
      mutated(R, result, (r) => {
        r.baselineRunId = "field:run/x";
      }),
    ).toEqual(["expected a timeline:run/ domain id"]);
    expect(
      mutated(R, result, (r) => {
        r.route = { kind: "timeline_result", resultId: "timeline:result/x" };
      }),
    ).toEqual(["route names another result"]);
  });

  it("keeps saved status, timestamps and post-hoc status consistent", () => {
    expect(
      mutated(R, result, (r) => {
        r.scenarioId = undefined;
      }),
    ).toEqual(["a baseline-only result cannot be post-hoc"]);
    expect(
      mutated(R, result, (r) => {
        r.status = "running";
      }),
    ).toEqual(["saved results have savedAt, and only they do"]);
    expect(
      mutated(R, result, (r) => {
        r.savedAt = "2026-10-24T12:04:00Z";
      }),
    ).toEqual(["saved before it was created"]);
  });

  it("rejects unsupported methods, non-cash targets and extra fields", () => {
    expect(
      mutated(R, result, (r) => {
        r.method.version = "9.9.9";
      }),
    ).toEqual(["method is not a supported pinned timeline method"]);
    expect(
      mutated(R, result, (r) => {
        (r.target as { metric: string }).metric = "revenue";
      }),
    ).toHaveLength(1);
    expect(mutated(R, result, (r) => Object.assign(r, { predictions: [] }))).toHaveLength(1);
  });

  it("rejects a result linked to another seed, snapshot, company, method or target", () => {
    const C = TimelineResultRefContextV1Schema;
    const ctx = (edit: (r: TimelineResultRefV1) => void) =>
      mutated(C, { seed, result }, (v) => edit(v.result));
    expect(
      ctx((r) => {
        r.seed.contentHash = "0".repeat(64);
      }),
    ).toEqual(["result names another seed or seed content"]);
    expect(
      ctx((r) => {
        r.snapshot.id = "field:snapshot/other";
      }),
    ).toEqual(["result names another snapshot or snapshot content"]);
    expect(
      ctx((r) => {
        r.company.cik = "0000000002";
      }),
    ).toEqual(["result is for another company"]);
    expect(
      ctx((r) => {
        r.target.date = "2024-03-31";
      }),
    ).toEqual(["result target differs from the seed target"]);
    expect(
      ctx((r) => {
        r.createdAt = "2026-10-24T11:00:00Z";
      }),
    ).toEqual(["result created before its seed was exported"]);
  });

  it("rejects a result from a blocked seed", () => {
    expect(
      messages(TimelineResultRefContextV1Schema.safeParse({ seed: blocked, result }) as Safe),
    ).toEqual(expect.arrayContaining(["a result needs a forecast-ready seed"]));
  });
});

describe("operation summary", () => {
  const O = OperationSummaryV1Schema;
  const fieldOp: OperationSummaryV1 = {
    schemaVersion: 1,
    id: "field:operation/export-twou-seed",
    ownerDomain: "field",
    status: "succeeded",
    title: "Export the 2U forecast seed",
    dependencies: ["field:operation/reconcile-twou"],
    evidenceRefs: [
      { kind: "domain", id: "field:snapshot/twou-2023q3-v1" },
      { kind: "case_item", snapshotId: "field:snapshot/twou-2023q3-v1", item: "fact", id: "F01" },
    ],
    outputRefs: ["field:seed/twou-2023q3-v1"],
    createdAt: "2026-10-24T12:00:00Z",
    startedAt: "2026-10-24T12:00:01Z",
    finishedAt: "2026-10-24T12:00:02Z",
    updatedAt: "2026-10-24T12:00:02Z",
  };
  const timelineOp: OperationSummaryV1 = {
    schemaVersion: 1,
    id: "timeline:operation/save-twou-baseline",
    ownerDomain: "timeline",
    status: "running",
    title: "Save the 2U baseline forecast",
    dependencies: ["field:operation/export-twou-seed"],
    evidenceRefs: [{ kind: "domain", id: "field:seed/twou-2023q3-v1" }],
    outputRefs: [],
    createdAt: "2026-10-24T12:05:00Z",
    startedAt: "2026-10-24T12:05:00Z",
    updatedAt: "2026-10-24T12:05:00Z",
  };

  it("accepts a Field agent job and a Timeline finance operation", () => {
    expect(check(O, fieldOp)).toEqual([]);
    expect(check(O, timelineOp)).toEqual([]);
  });

  it.each(["providerPacket", "apiKey", "credentials", "reasoning", "rawResponse"])(
    "rejects a %s field",
    (key) => {
      expect(mutated(O, fieldOp, (o) => Object.assign(o, { [key]: "x" }))).toHaveLength(1);
      expect(
        mutated(O, fieldOp, (o) => Object.assign(o.evidenceRefs[0]!, { [key]: "x" })),
      ).toHaveLength(1);
    },
  );

  it("binds id, outputs and dependencies to domains", () => {
    expect(
      mutated(O, fieldOp, (o) => {
        o.ownerDomain = "timeline";
      }),
    ).toEqual(
      expect.arrayContaining([
        "operation id is owned by another domain",
        "an operation only outputs records of its own domain",
      ]),
    );
    expect(
      mutated(O, fieldOp, (o) => {
        o.outputRefs = ["timeline:result/x"];
      }),
    ).toEqual(["an operation only outputs records of its own domain"]);
    expect(
      mutated(O, fieldOp, (o) => {
        o.dependencies = [o.id];
      }),
    ).toEqual(["an operation cannot depend on itself"]);
    expect(mutated(O, fieldOp, (o) => o.dependencies.push(o.dependencies[0]!))).toEqual([
      "duplicate dependency",
    ]);
    expect(
      mutated(O, fieldOp, (o) => {
        o.dependencies = ["field:seed/x"];
      }),
    ).toEqual(["expected an operation domain id"]);
    expect(
      mutated(O, fieldOp, (o) => {
        o.id = "k57a9b3c2d1e0f";
      }),
    ).not.toEqual([]);
  });

  it("keeps status, outputs and timestamps honest", () => {
    expect(
      mutated(O, fieldOp, (o) => {
        o.status = "failed";
      }),
    ).toEqual(["only succeeded or partial operations have outputs"]);
    expect(
      mutated(O, timelineOp, (o) => {
        o.status = "succeeded";
      }),
    ).toEqual(["a finished operation needs finishedAt"]);
    expect(
      mutated(O, timelineOp, (o) => {
        o.status = "queued";
      }),
    ).toEqual(["a queued operation has not started"]);
    expect(
      mutated(O, fieldOp, (o) => {
        o.updatedAt = "2026-10-24T12:00:01Z";
      }),
    ).toEqual(["timestamps must not go backwards"]);
    expect(
      mutated(O, fieldOp, (o) => {
        o.title = " ";
      }),
    ).toEqual(["must not be blank"]);
    expect(
      mutated(O, fieldOp, (o) => {
        o.title = "x".repeat(201);
      }),
    ).toHaveLength(1);
  });
});

describe("post-reveal fixture", () => {
  const V = TimelineRevealV1Schema;

  it("rejects disclosures available by the cutoff or after revealedThrough", () => {
    expect(
      mutated(V, reveal, (r) => {
        r.revealedThrough = "2024-02-12T00:00:00-05:00";
      }),
    ).toEqual(["a revealed source is published after the cutoff and by revealedThrough"]);
    expect(
      mutated(V, reveal, (r) => {
        r.knowledgeCutoff = "2024-02-12T23:00:00-05:00";
      }),
    ).toEqual(["a revealed source is published after the cutoff and by revealedThrough"]);
  });

  it("rejects derived facts and assumptions in a reveal", () => {
    expect(
      mutated(V, reveal, (r) => {
        const h = r.disclosures.facts[0]!;
        r.disclosures.facts.push({
          id: "D-X",
          kind: "derived",
          metric: h.metric,
          period: h.period,
          currency: h.currency,
          cents: h.cents,
          availableAt: h.availableAt,
          derivedFrom: [h.id],
          derivation: "copy",
        });
      }),
    ).toEqual(["derive later facts against the seed, not here"]);
    expect(
      mutated(V, reveal, (r) =>
        r.disclosures.assumptions.push(clone(seed.snapshot.case.assumptions[0]!)),
      ),
    ).toEqual(expect.arrayContaining(["a reveal has no assumptions"]));
  });

  it("rejects a reveal for another seed, company or cutoff, or reusing seed ids", () => {
    const C = TimelineRevealContextV1Schema;
    const ctx = (edit: (r: TimelineRevealV1) => void) =>
      mutated(C, { seed, reveal }, (v) => edit(v.reveal));
    expect(
      ctx((r) => {
        r.seed.contentHash = "0".repeat(64);
      }),
    ).toEqual(["reveal names another seed or seed content"]);
    expect(
      ctx((r) => {
        r.company.cik = "0000000002";
      }),
    ).toEqual(["reveal is for another company"]);
    expect(
      ctx((r) => {
        r.disclosures.facts[0]!.id = "F01";
      }),
    ).toEqual(["fact id already in the seed"]);
    expect(
      ctx((r) => {
        r.knowledgeCutoff = "2023-11-11T23:59:59-05:00";
      }),
    ).toEqual(["reveal cutoff differs from the seed cutoff"]);
  });
});

describe("audit: engine interval rules for quarterly_cash_bridge@0.1.0", () => {
  const ytdStart = (start: string) => (s: TimelineSeedV1) => {
    for (const f of s.snapshot.case.facts)
      if (f.id === "F05" || f.id === "F06")
        f.period = { kind: "duration", start, end: "2023-09-30" };
  };
  const startFrom = (id: string, date: string) => (s: TimelineSeedV1) => {
    s.snapshot.case.assumptions.find((a) => a.id === id)!.effectiveFrom = date;
  };

  it("rejects a YTD flow that does not start on a month start", () => {
    expect(mutated(S, seed, ytdStart("2023-01-02"))).toEqual([
      "YTD flow must start on a month start",
      "YTD flow must start on a month start",
    ]);
  });

  it("rejects a YTD flow longer than a fiscal year (21 months)", () => {
    expect(mutated(S, seed, ytdStart("2022-01-01"))).toEqual([
      "YTD flow must cover 3, 6, 9 or 12 whole months",
      "YTD flow must cover 3, 6, 9 or 12 whole months",
    ]);
  });

  it("rejects a YTD flow that is not whole quarters, and accepts six months", () => {
    expect(mutated(S, seed, ytdStart("2023-02-01"))).toHaveLength(2);
    expect(mutated(S, seed, ytdStart("2023-04-01"))).toEqual([]);
  });

  it("rejects financing that starts after the target", () => {
    expect(mutated(S, seed, startFrom("AS-FIN0", "2024-01-01"))).toEqual([
      "financing/FX assumption must apply from the day after the origin",
    ]);
  });

  it("rejects FX that starts after the target", () => {
    expect(mutated(S, seed, startFrom("AS-FX0", "2024-01-01"))).toEqual([
      "financing/FX assumption must apply from the day after the origin",
    ]);
  });

  it("rejects financing or FX starting inside the quarter, and accepts the origin itself", () => {
    expect(mutated(S, seed, startFrom("AS-FIN0", "2023-10-02"))).toHaveLength(1);
    expect(mutated(S, seed, startFrom("AS-FX0", "2023-09-30"))).toEqual([]);
  });

  it("rejects total below usable and contradictory origin restricted cash", () => {
    const cents = (id: string, delta: number) => (s: TimelineSeedV1) => {
      s.snapshot.case.facts.find((f) => f.id === id)!.cents += delta;
    };
    expect(mutated(S, seed, cents("F02", 1))).toEqual([
      "restricted cash contradicts total minus usable at the origin",
    ]);
    expect(
      mutated(S, seed, (s) => {
        const usable = s.snapshot.case.facts.find((f) => f.id === "F01")!;
        s.snapshot.case.facts.find((f) => f.id === "F03")!.cents = usable.cents - 1;
      }),
    ).toEqual(
      expect.arrayContaining([
        "total cash is below usable cash",
        "restricted cash contradicts total minus usable at the origin",
      ]),
    );
  });

  it("keeps the blocked fixture valid under the same rules", () => {
    expect(check(S, blocked)).toEqual([]);
  });
});

describe("audit: safe integers", () => {
  const UNSAFE = 2 ** 53;

  it("rejects 2^53 in an assumption benefitLagDays (caught first by the day-count bound)", () => {
    expect(
      mutated(S, seed, (s) => {
        s.snapshot.case.assumptions.find((a) => a.id === "A1")!.benefitLagDays = UNSAFE;
      }),
    ).toEqual(["benefit lag must be at most 3660 days"]);
  });

  it("rejects 2^53 in a learned rule version, and accepts a safe one", () => {
    const withRule = (version: number) => (s: TimelineSeedV1) => {
      s.snapshot.rules.push({
        id: "rule-v",
        ruleId: "rule",
        version,
        feedbackId: "fb",
        scope: {
          kind: "company",
          cik: s.snapshot.cik,
          schemaVersion: 1,
          sourceSignature: s.snapshot.sourceSignature,
        },
        action: { kind: "method_selection", methodId: "quarterly_cash_bridge", version: "0.1.0" },
        rationale: "pin the bridge",
        evidenceRefs: ["F01"],
        status: "accepted",
        validatorVersion: "1.0.0",
        recordedAt: "2023-11-01T00:00:00-05:00",
        effectiveFrom: "2023-11-01T00:00:00-05:00",
      });
    };
    expect(mutated(S, seed, withRule(1))).toEqual([]);
    const paths = (
      S.safeParse(
        (() => {
          const v = clone(seed);
          withRule(UNSAFE)(v);
          return v;
        })(),
      ).error?.issues ?? []
    ).map((i) => `${i.path.join(".")}: ${i.message}`);
    expect(paths).toEqual(["snapshot.rules.0.version: number must be a safe integer"]);
  });

  it("rejects unsafe numbers in every boundary record", () => {
    expect(
      mutated(TimelineRevealV1Schema, reveal, (r) => {
        r.disclosures.facts[0]!.cents = UNSAFE;
      }),
    ).toHaveLength(1);
  });
});

describe("audit: operation summary bounds", () => {
  const op: OperationSummaryV1 = {
    schemaVersion: 1,
    id: "field:operation/read-facts",
    ownerDomain: "field",
    status: "queued",
    title: "Read facts",
    dependencies: [],
    evidenceRefs: [
      { kind: "case_item", snapshotId: "field:snapshot/twou-2023q3-v1", item: "fact", id: "F01" },
    ],
    outputRefs: [],
    createdAt: "2026-10-24T12:00:00Z",
    updatedAt: "2026-10-24T12:00:00Z",
  };
  const O = OperationSummaryV1Schema;
  const caseId = (id: string) => (o: OperationSummaryV1) => {
    const r = o.evidenceRefs[0]!;
    if (r.kind === "case_item") r.id = id;
  };
  const domainRef = (id: string) => (o: OperationSummaryV1) => {
    o.evidenceRefs = [{ kind: "domain", id }];
  };

  it("caps case-item ids at 128 characters", () => {
    expect(mutated(O, op, caseId("x".repeat(128)))).toEqual([]);
    expect(mutated(O, op, caseId("x".repeat(129)))).toHaveLength(1);
    expect(mutated(O, op, caseId("x".repeat(1_000_000)))).toHaveLength(1);
  });

  it("caps domain id kinds at 32 characters", () => {
    expect(mutated(O, op, domainRef(`field:${"k".repeat(32)}/x`))).toEqual([]);
    expect(mutated(O, op, domainRef(`field:${"k".repeat(33)}/x`))).toHaveLength(1);
    expect(mutated(O, op, domainRef(`field:${"k".repeat(1_000_000)}/x`))).toHaveLength(1);
    expect(mutated(O, op, domainRef(`field:k/${"n".repeat(129)}`))).toHaveLength(1);
  });

  it("caps evidence, dependency and output arrays", () => {
    expect(
      mutated(O, op, (o) => {
        o.evidenceRefs = Array.from({ length: 257 }, (_, i) => ({
          kind: "domain" as const,
          id: `field:fact/f${i}`,
        }));
      }),
    ).toHaveLength(1);
    expect(
      mutated(O, op, (o) => {
        o.dependencies = Array.from({ length: 65 }, (_, i) => `field:operation/d${i}`);
      }),
    ).toHaveLength(1);
  });
});

// ---------- Re-audit: validation is total (safeParse never throws) ----------

type Schema = { safeParse: (v: unknown) => { success: boolean } };
/** safeParse result without letting an exception escape the assertion. */
const outcome = (schema: Schema, v: unknown): "accepted" | "rejected" | "threw" => {
  try {
    return schema.safeParse(v).success ? "accepted" : "rejected";
  } catch {
    return "threw";
  }
};
const edited = <T>(base: T, edit: (v: T) => void): T => {
  const v = clone(base);
  edit(v);
  return v;
};
/** Every composed entry point a seed reaches. */
const seedEntryPoints = (s: unknown): [string, Schema, unknown][] => [
  ["TimelineSeedV1", S, s],
  ["ForecastReadyTimelineSeedV1", ForecastReadyTimelineSeedV1Schema, s],
  ["TimelineResultRefContextV1", TimelineResultRefContextV1Schema, { seed: s, result }],
  ["TimelineRevealContextV1", TimelineRevealContextV1Schema, { seed: s, reveal }],
];

describe("re-audit: composed schemas reject instead of throwing", () => {
  const ytd = (start: string) => (s: TimelineSeedV1) => {
    for (const f of s.snapshot.case.facts)
      if (f.id === "F05" || f.id === "F06")
        f.period = { kind: "duration", start, end: "2023-09-30" };
  };
  const from = (id: string) => (s: TimelineSeedV1) => {
    s.snapshot.case.assumptions.find((a) => a.id === id)!.effectiveFrom = "2024-01-01";
  };
  const repros: [string, (s: TimelineSeedV1) => void][] = [
    ["YTD not month-start", ytd("2023-01-02")],
    ["YTD spans 21 months", ytd("2022-01-01")],
    ["financing starts after target", from("AS-FIN0")],
    ["FX starts after target", from("AS-FX0")],
    [
      "unsafe benefitLagDays",
      (s) => {
        s.snapshot.case.assumptions.find((a) => a.id === "A1")!.benefitLagDays = 2 ** 53;
      },
    ],
    [
      "unsafe rule.version",
      (s) => {
        s.snapshot.rules.push({
          id: "rule-v",
          ruleId: "rule",
          version: 2 ** 53,
          feedbackId: "fb",
          scope: {
            kind: "company",
            cik: s.snapshot.cik,
            schemaVersion: 1,
            sourceSignature: s.snapshot.sourceSignature,
          },
          action: { kind: "method_selection", methodId: "quarterly_cash_bridge", version: "0.1.0" },
          rationale: "pin the bridge",
          evidenceRefs: ["F01"],
          status: "accepted",
          validatorVersion: "1.0.0",
          recordedAt: "2023-11-01T00:00:00-05:00",
          effectiveFrom: "2023-11-01T00:00:00-05:00",
        });
      },
    ],
    [
      "unknown nested field",
      (s) => {
        Object.assign(s.snapshot.case.facts[0]!, { apiKey: "x" });
      },
    ],
    [
      "impossible origin date",
      (s) => {
        s.quarterBridge.originBalanceDate = "2023-02-30";
      },
    ],
  ];

  it.each(repros)("%s: every entry point returns success:false", (_, edit) => {
    const bad = edited(seed, edit);
    for (const [name, schema, value] of seedEntryPoints(bad))
      expect(outcome(schema, value), name).toBe("rejected");
  });

  it("contexts reject an invalid nested result or reveal without throwing", () => {
    const badResult = edited(result, (r) => {
      r.route = { kind: "timeline_result", resultId: "timeline:result/other" };
    });
    const badReveal = edited(reveal, (r) => {
      r.disclosures.facts[0]!.cents = 0.5;
    });
    expect(outcome(TimelineResultRefContextV1Schema, { seed, result: badResult })).toBe("rejected");
    expect(outcome(TimelineRevealContextV1Schema, { seed, reveal: badReveal })).toBe("rejected");
    expect(outcome(TimelineResultRefContextV1Schema, { seed: blocked, result: badResult })).toBe(
      "rejected",
    );
  });
});

describe("re-audit: invalid cents are rejected, never converted", () => {
  const BAD = [0.5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN, 2 ** 53];
  const cases: [string, TimelineSeedV1, string][] = [
    ["2U", seed, "F01"],
    ["2U", seed, "F02"],
    ["2U", seed, "F03"],
    ["blocked", blocked, "f_cash"],
    ["blocked", blocked, "f_restricted"],
    ["blocked", blocked, "f_total"],
  ];
  for (const [label, base, id] of cases)
    it.each(BAD)(`${label} ${id} cents %s`, (bad) => {
      const v = clone(base);
      v.snapshot.case.facts.find((f) => f.id === id)!.cents = bad;
      for (const [name, schema, value] of seedEntryPoints(v))
        expect(outcome(schema, value), name).toBe("rejected");
    });
});

describe("re-audit: fuzzed malformed shapes never throw", () => {
  const BAD: unknown[] = [
    null,
    0,
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2 ** 53,
    "",
    "2023-02-30",
    true,
    [],
    {},
    [null],
  ];
  /** Every node path (objects, arrays and leaves) of a JSON value. */
  const nodePaths = (v: unknown, path: (string | number)[] = []): (string | number)[][] => {
    const out = [path];
    if (Array.isArray(v)) v.forEach((x, i) => out.push(...nodePaths(x, [...path, i])));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) out.push(...nodePaths(x, [...path, k]));
    return out;
  };
  const setAt = (root: unknown, path: (string | number)[], value: unknown, remove = false) => {
    const v = clone(root) as Record<string | number, unknown>;
    if (path.length === 0) return value;
    let node = v;
    for (const k of path.slice(0, -1)) node = node[k] as Record<string | number, unknown>;
    const last = path.at(-1)!;
    if (remove) delete node[last];
    else node[last] = value;
    return v;
  };
  const targets: [string, Schema, unknown, (x: unknown) => unknown][] = [
    ["ForecastReady seed", ForecastReadyTimelineSeedV1Schema, seed, (x) => x],
    ["blocked seed", S, blocked, (x) => x],
    [
      "result context (result)",
      TimelineResultRefContextV1Schema,
      result,
      (x) => ({ seed, result: x }),
    ],
    [
      "reveal context (reveal)",
      TimelineRevealContextV1Schema,
      reveal,
      (x) => ({ seed, reveal: x }),
    ],
    [
      "operation",
      OperationSummaryV1Schema,
      {
        schemaVersion: 1,
        id: "field:operation/x",
        ownerDomain: "field",
        status: "succeeded",
        title: "x",
        dependencies: ["timeline:operation/y"],
        evidenceRefs: [
          { kind: "case_item", snapshotId: "field:snapshot/s", item: "fact", id: "F" },
        ],
        outputRefs: ["field:seed/x"],
        createdAt: "2026-10-24T12:00:00Z",
        startedAt: "2026-10-24T12:00:00Z",
        finishedAt: "2026-10-24T12:00:00Z",
        updatedAt: "2026-10-24T12:00:00Z",
      },
      (x) => x,
    ],
  ];

  it.each(targets)("%s: replace or delete every node", (_, schema, base, wrap) => {
    const threw: string[] = [];
    let runs = 0;
    for (const path of nodePaths(base)) {
      const variants = [...BAD.map((b) => setAt(base, path, b)), setAt(base, path, null, true)];
      for (const v of variants) {
        runs++;
        if (outcome(schema, wrap(v)) === "threw") threw.push(path.join("."));
      }
    }
    expect(runs).toBeGreaterThan(100);
    expect(threw).toEqual([]);
  });

  it("rejects garbage and cyclic inputs at every exported schema", () => {
    const cyclic: Record<string, unknown> = clone(seed) as unknown as Record<string, unknown>;
    cyclic.self = cyclic;
    const all: Schema[] = [
      S,
      ForecastReadyTimelineSeedV1Schema,
      TimelineResultRefV1Schema,
      TimelineResultRefContextV1Schema,
      OperationSummaryV1Schema,
      TimelineRevealV1Schema,
      TimelineRevealContextV1Schema,
    ];
    for (const schema of all)
      for (const v of [...BAD, undefined, cyclic, { seed: cyclic, result, reveal }])
        expect(outcome(schema, v)).toBe("rejected");
  });
});

describe("intentional stricter-than-engine v1 rules", () => {
  it("rejects a month-end origin that is not a calendar quarter end (engine accepts it)", () => {
    expect(
      mutated(S, seed, (s) => {
        s.snapshot.cutoff = "2023-09-01T12:00:00Z";
        s.quarterBridge.knowledgeCutoff = "2023-09-01T12:00:00Z";
        s.quarterBridge.originBalanceDate = "2023-08-31";
        s.quarterBridge.targetDate = "2023-11-30";
        for (const f of s.snapshot.case.facts) {
          f.period =
            f.period.kind === "instant"
              ? { kind: "instant", date: "2023-08-31" }
              : { kind: "duration", start: "2023-06-01", end: "2023-08-31" };
          f.availableAt = "2023-09-01T09:00:00Z";
        }
        s.snapshot.case.sources[0]!.publishedAt = "2023-09-01T09:00:00Z";
        for (const a of s.snapshot.case.assumptions)
          if (a.id.startsWith("AS-")) a.effectiveFrom = "2023-09-01";
      }),
    ).toEqual(["origin is not a calendar quarter end"]);
  });

  it("rejects one zero assumption selected for both financing and FX (engine accepts it)", () => {
    expect(
      mutated(S, seed, (s) => {
        s.quarterBridge.fxAssumptionId = s.quarterBridge.financingAssumptionId;
      }),
    ).toEqual(["assumption selected twice"]);
  });

  it("caps output refs at 64", () => {
    const op = {
      schemaVersion: 1,
      id: "field:operation/x",
      ownerDomain: "field",
      status: "succeeded",
      title: "x",
      dependencies: [],
      evidenceRefs: [],
      outputRefs: Array.from({ length: 64 }, (_, i) => `field:seed/s${i}`),
      createdAt: "2026-10-24T12:00:00Z",
      startedAt: "2026-10-24T12:00:00Z",
      finishedAt: "2026-10-24T12:00:00Z",
      updatedAt: "2026-10-24T12:00:00Z",
    };
    expect(check(OperationSummaryV1Schema, op)).toEqual([]);
    expect(
      mutated(OperationSummaryV1Schema, op, (o) => o.outputRefs.push("field:seed/s64")),
    ).toHaveLength(1);
  });
});

// ---------- Final audit: total for any JS value, JSON-text boundary, money bounds ----------

describe("final audit: JSON-text boundary", () => {
  const text = (v: unknown) => JSON.stringify(v);

  it("accepts every valid fixture through its JSON-text entry point", () => {
    expect(parseTimelineSeedJson(text(seed)).success).toBe(true);
    expect(parseTimelineSeedJson(text(blocked)).success).toBe(true);
    expect(parseForecastReadyTimelineSeedJson(text(seed)).success).toBe(true);
    expect(parseTimelineResultRefJson(text(result)).success).toBe(true);
    expect(parseTimelineRevealJson(text(reveal)).success).toBe(true);
    expect(parseTimelineResultRefContextJson(text(seed), text(result)).success).toBe(true);
    expect(parseTimelineRevealContextJson(text(seed), text(reveal)).success).toBe(true);
    expect(
      parseOperationSummaryJson(
        text({
          schemaVersion: 1,
          id: "timeline:operation/save",
          ownerDomain: "timeline",
          status: "queued",
          title: "Save",
          dependencies: [],
          evidenceRefs: [],
          outputRefs: [],
          createdAt: "2026-10-24T12:00:00Z",
          updatedAt: "2026-10-24T12:00:00Z",
        }),
      ).success,
    ).toBe(true);
  });

  it("rejects invalid fixtures through JSON text", () => {
    expect(parseForecastReadyTimelineSeedJson(text(blocked)).success).toBe(false);
    expect(parseTimelineSeedJson(text(fx.mismatchedSeed)).success).toBe(false);
  });

  const entries: [string, (t: unknown) => { success: boolean }][] = [
    ["seed", parseTimelineSeedJson],
    ["forecast-ready seed", parseForecastReadyTimelineSeedJson],
    ["result ref", parseTimelineResultRefJson],
    ["operation", parseOperationSummaryJson],
    ["reveal", parseTimelineRevealJson],
    ["result context", (t) => parseTimelineResultRefContextJson(t, text(result))],
    ["reveal context", (t) => parseTimelineRevealContextJson(text(seed), t)],
  ];
  const BAD_TEXT: unknown[] = [
    "",
    "{",
    "nul",
    "[1,]",
    "\u0000",
    "NaN",
    "1e999",
    '"x"',
    "null",
    "[]",
    "{}",
    `{"__proto__":{"polluted":true}}`,
    `${"[".repeat(200_000)}${"]".repeat(200_000)}`,
    `"${"x".repeat(BOUNDARY_MAX_JSON_LENGTH)}"`,
    undefined,
    null,
    42,
    {},
    new Proxy(
      {},
      {
        get: () => {
          throw new Error("x");
        },
      },
    ),
  ];

  it.each(entries)("%s: any value or invalid text returns success:false", (_, parse) => {
    for (const t of BAD_TEXT) {
      let r: { success: boolean } | "threw";
      try {
        r = parse(t);
      } catch {
        r = "threw";
      }
      expect(r === "threw" ? r : r.success).toBe(false);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects a __proto__ key as an unknown field without changing any prototype", () => {
    const t = text(seed).replace('{"schemaVersion"', '{"__proto__":{"x":1},"schemaVersion"');
    expect(t).toContain("__proto__");
    expect(parseTimelineSeedJson(t).success).toBe(false);
  });
});

describe("final audit: money magnitude bound", () => {
  const range = (id: string, low: number, high: number) => (s: TimelineSeedV1) => {
    const a = s.snapshot.case.assumptions.find((x) => x.id === id)!;
    a.value.low = low;
    a.value.high = high;
  };
  const OVER = "number exceeds the boundary magnitude 2^49, so engine sums could overflow";
  const MAX = Number.MAX_SAFE_INTEGER;

  it("states the bound", () => {
    expect(BOUNDARY_INTEGER_MAX).toBe(2 ** 49);
  });

  it("rejects the overflow repros: financing or FX at MAX_SAFE_INTEGER", () => {
    expect(mutated(ForecastReadyTimelineSeedV1Schema, seed, range("AS-FIN0", MAX, MAX))).toEqual([
      OVER,
      OVER,
    ]);
    expect(mutated(ForecastReadyTimelineSeedV1Schema, seed, range("AS-FX0", MAX, MAX))).toEqual([
      OVER,
      OVER,
    ]);
  });

  it("accepts exactly +-2^49 and rejects one beyond, for ranges, facts and costs", () => {
    const B = BOUNDARY_INTEGER_MAX;
    expect(mutated(S, seed, range("AS-FIN0", -B, B))).toEqual([]);
    expect(mutated(S, seed, range("AS-FIN0", -B - 1, 0))).toEqual([OVER]);
    expect(mutated(S, seed, range("AS-FX0", 0, B + 1))).toEqual([OVER]);
    const cents = (id: string, v: number) => (s: TimelineSeedV1) => {
      s.snapshot.case.facts.find((f) => f.id === id)!.cents = v;
    };
    expect(mutated(S, seed, cents("F05", -B))).toEqual([]);
    expect(mutated(S, seed, cents("F05", -B - 1))).toEqual([OVER]);
    expect(
      mutated(S, seed, (s) => {
        s.snapshot.case.assumptions.find((a) => a.id === "A1")!.oneTimeCost!.high = B + 1;
      }),
    ).toEqual([OVER]);
    expect(
      mutated(TimelineRevealV1Schema, reveal, (r) => {
        r.disclosures.facts[0]!.cents = B + 1;
      }),
    ).toEqual([OVER]);
  });
});

// ---------- Exception audit: JSON-text boundary is total; chains and day counts bounded ----------

/** Derived-fact chain of `depth` links ending in F05 (selected operating YTD). */
const chainSeed = (depth: number): TimelineSeedV1 =>
  edited(seed, (s) => {
    const facts = s.snapshot.case.facts;
    const i = facts.findIndex((f) => f.id === "F05");
    const base = facts[i]!;
    if (base.kind !== "reported") throw new Error("fixture changed");
    const chain: TimelineSeedV1["snapshot"]["case"]["facts"] = [{ ...base, id: "F05-R" }];
    for (let k = 1; k <= depth; k++) {
      const { sourceId, locator, reportedScale, ...rest } = base;
      chain.push({
        ...rest,
        kind: "derived",
        id: k === depth ? "F05" : `F05-D${k}`,
        derivedFrom: [k === 1 ? "F05-R" : `F05-D${k - 1}`],
        derivation: "carried forward unchanged",
      });
    }
    facts.splice(i, 1, ...chain);
  });

describe("exception audit: derivation chains and engine work", () => {
  it(`accepts a ${MAX_CHAIN_DEPTH}-link derived chain and rejects one more`, () => {
    expect(MAX_CHAIN_DEPTH).toBe(16);
    expect(check(ForecastReadyTimelineSeedV1Schema, chainSeed(MAX_CHAIN_DEPTH))).toEqual([]);
    expect(check(S, chainSeed(MAX_CHAIN_DEPTH + 1))).toEqual([
      "derivation chain is deeper than 16",
    ]);
  });

  it("rejects the 8,000-link chain repro through JSON text", () => {
    const r = parseForecastReadyTimelineSeedJson(JSON.stringify(chainSeed(8000)));
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.message)).toContain(
      "derivation chain is deeper than 16",
    );
  });

  it("bounds total fact visits for shared (diamond) derivations", () => {
    // Each level lists the previous level twice: visits double while depth stays 13.
    const diamond = (levels: number) =>
      edited(seed, (s) => {
        const facts = s.snapshot.case.facts;
        const i = facts.findIndex((f) => f.id === "F05");
        const base = facts[i]!;
        if (base.kind !== "reported") throw new Error("fixture changed");
        const { sourceId, locator, reportedScale, ...rest } = base;
        const out: TimelineSeedV1["snapshot"]["case"]["facts"] = [{ ...base, id: "F05-R" }];
        for (let k = 1; k <= levels; k++) {
          const prev = k === 1 ? "F05-R" : `F05-D${k - 1}`;
          out.push({
            ...rest,
            kind: "derived",
            id: k === levels ? "F05" : `F05-D${k}`,
            derivedFrom: [prev, prev],
            derivation: "carried forward unchanged",
          });
        }
        facts.splice(i, 1, ...out);
      });
    // 12 levels: F05 alone is 2^13 - 1 = 8,191 visits, under the 10,000 bound.
    expect(check(S, diamond(12))).toEqual([]);
    expect(check(S, diamond(13))).toEqual([
      `derivation walks exceed ${MAX_DERIVATION_VISITS} fact visits`,
    ]);
  });

  it("caps assumption dependency chains at the same depth", () => {
    const deps = (n: number) =>
      edited(seed, (s) => {
        const as = s.snapshot.case.assumptions;
        const base = as.find((a) => a.id === "A1-DOWNSIDE")!;
        for (let k = 1; k <= n; k++)
          as.push({
            ...clone(base),
            id: `DEP-${k}`,
            dependsOn: [k === 1 ? "A1-DOWNSIDE" : `DEP-${k - 1}`],
          });
      });
    // A1-DOWNSIDE already depends on A1 (depth 1), so n links reach depth n + 1.
    expect(check(S, deps(MAX_CHAIN_DEPTH - 1))).toEqual([]);
    expect(check(S, deps(MAX_CHAIN_DEPTH))).toEqual([
      "assumption dependency chain is deeper than 16",
    ]);
  });
});

describe("exception audit: day counts", () => {
  const lag = (days: number, from?: string) => (s: TimelineSeedV1) => {
    const a = s.snapshot.case.assumptions.find((x) => x.id === "A1")!;
    a.benefitLagDays = days;
    if (from) a.effectiveFrom = from;
  };

  it("accepts 0 and 3660 days and rejects 3661 and the 2^49 repro", () => {
    expect(MAX_BENEFIT_LAG_DAYS).toBe(3660);
    expect(mutated(S, seed, lag(0))).toEqual([]);
    expect(mutated(S, seed, lag(3660))).toEqual([]);
    expect(mutated(S, seed, lag(3661))).toEqual(["benefit lag must be at most 3660 days"]);
    expect(mutated(S, seed, lag(2 ** 49))).toEqual(["benefit lag must be at most 3660 days"]);
    expect(mutated(S, seed, lag(100_000_000))).toEqual(["benefit lag must be at most 3660 days"]);
  });

  it("rejects a benefit start past 9999-12-31", () => {
    expect(mutated(S, seed, lag(1, "9999-12-30"))).toEqual([]);
    expect(mutated(S, seed, lag(2, "9999-12-30"))).toEqual([
      "benefit would start after 9999-12-31, beyond engine dates",
    ]);
  });
});

describe("exception audit: JSON-text boundary fuzz", () => {
  const text = (v: unknown) => JSON.stringify(v);
  const entries: [string, (t: unknown) => { success: boolean }][] = [
    ["generic", (t) => safeParseJsonText(S, t)],
    ["seed", parseTimelineSeedJson],
    ["forecast-ready seed", parseForecastReadyTimelineSeedJson],
    ["result ref", parseTimelineResultRefJson],
    ["operation", parseOperationSummaryJson],
    ["reveal", parseTimelineRevealJson],
    ["result context (seed)", (t) => parseTimelineResultRefContextJson(t, text(result))],
    ["result context (result)", (t) => parseTimelineResultRefContextJson(text(seed), t)],
    ["reveal context (seed)", (t) => parseTimelineRevealContextJson(t, text(reveal))],
    ["reveal context (reveal)", (t) => parseTimelineRevealContextJson(text(seed), t)],
  ];
  const nest = (n: number) => `${'{"a":'.repeat(n)}1${"}".repeat(n)}`;
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const hostile: unknown[] = [
    revoked.proxy,
    new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw revoked.proxy;
        },
      },
    ),
    // biome-ignore lint/suspicious/noThenProperty: a hostile thenable is the case under test
    Object.defineProperty({}, "then", {
      get: () => {
        throw revoked.proxy;
      },
    }),
    Symbol("x"),
    1n,
    () => "{}",
  ];
  const texts: unknown[] = [
    "",
    " ",
    "{",
    "}",
    "[1,]",
    "nul",
    "NaN",
    "1e999",
    "-0",
    '"\\ud800"',
    "\u0000",
    "null",
    "true",
    "[]",
    "{}",
    `{"__proto__":{"polluted":true}}`,
    nest(BOUNDARY_MAX_DEPTH + 1),
    `${"[".repeat(500_000)}${"]".repeat(500_000)}`,
    `"${"x".repeat(2_000_000)}"`,
    `"${"x".repeat(BOUNDARY_MAX_JSON_LENGTH)}"`,
    text(fx.mismatchedSeed),
    ...hostile,
    undefined,
    null,
    0,
  ];

  it.each(entries)("%s: never throws and rejects invalid input", (_, parse) => {
    for (const t of texts) {
      let ok: boolean | "threw";
      try {
        ok = parse(t).success;
      } catch {
        ok = "threw";
      }
      expect(ok).toBe(false);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("enforces the depth limit exactly on the parsed tree", () => {
    // Nesting at the limit passes the depth gate and fails only on shape.
    const atLimit = safeParseJsonText(S, nest(BOUNDARY_MAX_DEPTH - 1));
    const over = safeParseJsonText(S, nest(BOUNDARY_MAX_DEPTH + 1));
    const msg = (r: { success: boolean; error?: z.ZodError }) =>
      r.success ? [] : r.error!.issues.map((i) => i.message);
    expect(msg(atLimit)).not.toContain("JSON nests too deeply");
    expect(msg(over)).toEqual(["JSON nests too deeply"]);
  });

  it("replaces every fixture leaf with bad JSON values and never throws", () => {
    const BAD = [null, 0.5, -1, 2 ** 53, "", "2023-02-30", true, [], {}, [null]];
    const leaves = (v: unknown, p: (string | number)[] = []): (string | number)[][] =>
      Array.isArray(v)
        ? [p, ...v.flatMap((x, i) => leaves(x, [...p, i]))]
        : v && typeof v === "object"
          ? [p, ...Object.entries(v).flatMap(([k, x]) => leaves(x, [...p, k]))]
          : [p];
    let runs = 0;
    for (const [base, parse] of [
      [seed, parseForecastReadyTimelineSeedJson],
      [result, parseTimelineResultRefJson],
      [reveal, parseTimelineRevealJson],
    ] as const)
      for (const path of leaves(base))
        for (const bad of BAD) {
          const v = clone(base) as unknown as Record<string | number, unknown>;
          let node = v;
          for (const k of path.slice(0, -1)) node = node[k] as Record<string | number, unknown>;
          if (path.length) node[path.at(-1)!] = bad;
          runs++;
          expect(() => parse(text(path.length ? v : bad))).not.toThrow();
        }
    expect(runs).toBeGreaterThan(1000);
  });
});
