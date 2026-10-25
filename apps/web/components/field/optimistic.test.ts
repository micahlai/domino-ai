import type { OptimisticLocalStore } from "convex/browser";
import { type FunctionReference, getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { LiveFinding, LiveStatus } from "./live";
import { optimisticDecide } from "./optimistic";

/** A minimal local query cache keyed like Convex's: function name plus JSON args. */
function fakeStore() {
  const cache = new Map<string, unknown>();
  const key = (ref: FunctionReference<"query">, args: unknown) =>
    `${getFunctionName(ref)}:${JSON.stringify(args)}`;
  const store = {
    getQuery: (ref: FunctionReference<"query">, args: unknown) => cache.get(key(ref, args)),
    setQuery: (ref: FunctionReference<"query">, args: unknown, value: unknown) =>
      cache.set(key(ref, args), value),
    getAllQueries: () => [],
  } as unknown as OptimisticLocalStore;
  return { store, set: store.setQuery.bind(store), get: store.getQuery.bind(store) };
}

const companyId = "c1" as Id<"companies">;
const flag = (findingId: string, escalated: boolean): LiveFinding => ({
  findingId,
  kind: "duplicate",
  severity: escalated ? "high" : "low",
  summary: `Flag ${findingId}`,
  refs: [],
  detectedAt: "2026-11-02T00:00:00.000Z",
  version: 1,
  escalated,
  status: "open",
  decidedBy: undefined,
  decidedAt: undefined,
  note: undefined,
  explanation: undefined,
});

describe("optimistic decide", () => {
  it("moves the flag to the decided list and lowers the open counts at once", () => {
    const { store, set, get } = fakeStore();
    set(api.field.findings, { companyId, status: "open" }, [flag("f1", true), flag("f2", false)]);
    set(api.field.findings, { companyId, status: "approved" }, []);
    set(api.field.status, { companyId }, {
      companyId,
      openFindings: 2,
      openEscalations: 1,
    } as LiveStatus);

    optimisticDecide(store, { companyId, findingId: "f1", decision: "approved", note: " ok " });

    const open = get(api.field.findings, { companyId, status: "open" }) as LiveFinding[];
    expect(open.map((f) => f.findingId)).toEqual(["f2"]);
    const approved = get(api.field.findings, { companyId, status: "approved" }) as LiveFinding[];
    expect(approved).toMatchObject([{ findingId: "f1", status: "approved", note: "ok" }]);
    expect(get(api.field.status, { companyId })).toMatchObject({
      openFindings: 1,
      openEscalations: 0,
    });
  });

  it("leaves the cache alone when the flag is not in the open queue", () => {
    const { store, set, get } = fakeStore();
    const open = [flag("f2", false)];
    set(api.field.findings, { companyId, status: "open" }, open);
    optimisticDecide(store, { companyId, findingId: "gone", decision: "rejected" });
    expect(get(api.field.findings, { companyId, status: "open" })).toBe(open);
  });
});
