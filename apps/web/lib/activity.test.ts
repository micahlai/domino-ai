import { type ActivityEvent, ActivityEventSchema } from "@domino/contracts";
import { describe, expect, it } from "vitest";
import {
  type ActivityScope,
  MAX_CONFLICTS,
  activityRows,
  emptyActivity,
  ingestActivity,
} from "./activity";

const scope: ActivityScope = { caseId: "c1", runId: "r1" };
const ev = (
  id: string,
  sequence: number,
  status: ActivityEvent["status"],
  entityId = "t1",
  label = "Task",
): ActivityEvent =>
  ActivityEventSchema.parse({
    id,
    sequence,
    occurredAt: `2026-01-01T09:00:${String(sequence % 60).padStart(2, "0")}Z`,
    caseId: "c1",
    runId: "r1",
    kind: "agent_task",
    status,
    entity: { kind: "agent_task", id: entityId },
    label,
  });
const ids = (rows: ReturnType<typeof activityRows>) => rows.map((r) => r.entity.id);

describe("ingestActivity conflicts", () => {
  it("counts a conflicting variant once however often it is redelivered", () => {
    const s1 = ingestActivity(emptyActivity, [ev("a", 1, "started")], scope);
    const bad = ev("a", 1, "started", "t1", "Different");
    const s2 = ingestActivity(s1, [bad], scope);
    expect(s2.conflicts).toBe(1);
    expect(s2.events).toHaveLength(1);
    expect(s2.events[0]?.label).toBe("Task");
    // Every later delivery of the same variant, alone or in a batch, is a no-op.
    expect(ingestActivity(s2, [bad], scope)).toBe(s2);
    expect(ingestActivity(s2, [bad, bad, ev("a", 1, "started")], scope)).toBe(s2);
  });

  it("counts a second distinct variant of the same id", () => {
    const s1 = ingestActivity(emptyActivity, [ev("a", 1, "started")], scope);
    const s2 = ingestActivity(s1, [ev("a", 1, "started", "t1", "X")], scope);
    const s3 = ingestActivity(s2, [ev("a", 1, "started", "t1", "Y")], scope);
    expect(s3.conflicts).toBe(2);
  });

  it("stops tracking past the bound, and stays idempotent there", () => {
    let s = ingestActivity(emptyActivity, [ev("a", 1, "started")], scope);
    for (let i = 0; i < MAX_CONFLICTS + 20; i++)
      s = ingestActivity(s, [ev("a", 1, "started", "t1", `v${i}`)], scope);
    expect(s.conflicts).toBe(MAX_CONFLICTS);
    expect(s.conflictKeys.size).toBe(MAX_CONFLICTS);
    expect(ingestActivity(s, [ev("a", 1, "started", "t1", "v0")], scope)).toBe(s);
    expect(ingestActivity(s, [ev("a", 1, "started", "t1", "brand-new")], scope)).toBe(s);
  });

  it("ignores events outside the scope and identical redelivery", () => {
    const s1 = ingestActivity(emptyActivity, [ev("a", 1, "started")], scope);
    expect(ingestActivity(s1, [ev("a", 1, "started")], scope)).toBe(s1);
    const other = ActivityEventSchema.parse({ ...ev("z", 2, "started"), runId: "r2" });
    expect(ingestActivity(s1, [other], scope)).toBe(s1);
  });
});

describe("activityRows retries", () => {
  it("keeps a failure visible when a retry starts, and shows the retry apart", () => {
    const s = ingestActivity(
      emptyActivity,
      [ev("a", 1, "started"), ev("b", 2, "failed"), ev("c", 3, "started")],
      scope,
    );
    const [row] = activityRows(s);
    expect(row?.latest.id).toBe("b");
    expect(row?.latest.status).toBe("failed");
    expect(row?.retry?.id).toBe("c");
  });

  it("lets a later success replace the failure, and a retry start alone never does", () => {
    const failed = ingestActivity(
      emptyActivity,
      [ev("b", 2, "failed"), ev("c", 3, "started")],
      scope,
    );
    const done = ingestActivity(failed, [ev("d", 4, "succeeded")], scope);
    const [row] = activityRows(done);
    expect(row?.latest.id).toBe("d");
    expect(row?.retry).toBeUndefined();
  });

  it("keeps the failure when the retry start arrives before the failure", () => {
    const s1 = ingestActivity(emptyActivity, [ev("c", 3, "started")], scope);
    expect(activityRows(s1)[0]?.latest.status).toBe("started");
    const s2 = ingestActivity(s1, [ev("b", 2, "failed")], scope);
    expect(activityRows(s2)[0]?.latest.status).toBe("failed");
  });

  it("does not let a late older failure override a newer success", () => {
    const s = ingestActivity(
      ingestActivity(emptyActivity, [ev("d", 4, "succeeded")], scope),
      [ev("b", 2, "failed")],
      scope,
    );
    expect(activityRows(s)[0]?.latest.id).toBe("d");
  });
});

describe("activityRows order", () => {
  it("keeps first-seen entity order when an earlier event arrives late", () => {
    const s1 = ingestActivity(
      emptyActivity,
      [ev("b1", 5, "started", "B"), ev("c1", 6, "started", "C")],
      scope,
    );
    expect(ids(activityRows(s1))).toEqual(["B", "C"]);
    // Entity C gets an event older than anything B has: C must not jump above B.
    const s2 = ingestActivity(s1, [ev("c0", 1, "started", "C")], scope);
    expect(ids(activityRows(s2))).toEqual(["B", "C"]);
    // A brand-new entity delivered late goes to the end, not the top.
    const s3 = ingestActivity(s2, [ev("a0", 2, "started", "A")], scope);
    expect(ids(activityRows(s3))).toEqual(["B", "C", "A"]);
    // Updating an existing row never moves it.
    const s4 = ingestActivity(s3, [ev("b2", 9, "succeeded", "B")], scope);
    expect(ids(activityRows(s4))).toEqual(["B", "C", "A"]);
  });

  it("sorts one batch by sequence regardless of delivery order", () => {
    const s = ingestActivity(
      emptyActivity,
      [ev("c", 3, "started", "C"), ev("a", 1, "started", "A"), ev("b", 2, "started", "B")],
      scope,
    );
    expect(ids(activityRows(s))).toEqual(["A", "B", "C"]);
  });
});

describe("cap", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ev(`e${i}`, i, "started", `T${i}`));

  it("retains only the newest events and forgets emptied entities", () => {
    const s = ingestActivity(emptyActivity, many(10), scope, { cap: 4 });
    expect(s.events).toHaveLength(4);
    expect(ids(activityRows(s))).toEqual(["T6", "T7", "T8", "T9"]);
    expect(s.order).toHaveLength(4);
  });

  it("ignores redelivery at or below the dropped floor, so the cap is stable", () => {
    const s = ingestActivity(emptyActivity, many(10), scope, { cap: 4 });
    expect(ingestActivity(s, many(10), scope, { cap: 4 })).toBe(s);
    expect(ingestActivity(s, [ev("old", 2, "failed", "T2")], scope, { cap: 4 })).toBe(s);
  });

  it("keeps the row position of an entity that loses only some events to the cap", () => {
    const s1 = ingestActivity(
      emptyActivity,
      [ev("a1", 1, "started", "A"), ev("b1", 2, "started", "B"), ev("a2", 3, "succeeded", "A")],
      scope,
      { cap: 3 },
    );
    expect(ids(activityRows(s1))).toEqual(["A", "B"]);
    const s2 = ingestActivity(s1, [ev("c1", 4, "started", "C")], scope, { cap: 3 });
    // a1 (seq 1) is dropped, but A still has a2, so A keeps the top row.
    expect(s2.events.map((e) => e.id)).toEqual(["b1", "a2", "c1"]);
    expect(ids(activityRows(s2))).toEqual(["A", "B", "C"]);
  });
});

describe("reconnect", () => {
  it("replaying the whole feed after a reconnect changes nothing", () => {
    const feed = [
      ev("a", 1, "started", "A"),
      ev("b", 2, "failed", "A"),
      ev("c", 3, "started", "A"),
      ev("d", 4, "started", "B"),
    ];
    const s = ingestActivity(emptyActivity, feed, scope);
    expect(ingestActivity(s, [...feed].reverse(), scope)).toBe(s);
    expect(ingestActivity(s, feed, scope, { quiet: true })).toBe(s);
  });
});
