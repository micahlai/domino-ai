/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { Doc } from "../../_generated/dataModel";
import schema from "../../schema";
import { makeRun } from "../questions.fake-workspace.test-support";
import { resolveFieldSource } from "./brain";

const modules = import.meta.glob(["../../**/*.ts", "!../../**/*.test.ts"]);
const setup = () => convexTest(schema, modules);
type T = ReturnType<typeof setup>;

const operating = { ...makeRun({ runId: "base" }), companyId: "operating/2u/baseline" };

function company(t: T, over: Partial<Doc<"companies">> = {}) {
  return t.run((ctx) =>
    ctx.db.insert("companies", {
      name: "2U · Baseline",
      profile: "kestrel",
      currentWeek: 0,
      today: "2023-10-01",
      status: "ready",
      operatingDemo: { company: "2u", scenario: "baseline", version: 1 },
      ...over,
    }),
  );
}
const resolve = (t: T, run = operating) => t.run((ctx) => resolveFieldSource(ctx, run, undefined));

describe("resolveFieldSource for operating books", () => {
  it("links the original Field company that simulates the same operating world", async () => {
    const t = setup();
    const original = await company(t);
    await company(t, { replayOf: original });
    await company(t, { judge: true });
    await company(t, { operatingDemo: { company: "2u", scenario: "late-payments", version: 1 } });
    const source = await resolve(t);
    expect(source).toMatchObject({
      status: "linked",
      fieldCompanyId: original,
      via: "operating_world",
      frozen: { snapshotVersion: null, asOf: operating.baseline.seed.snapshot.asOf },
    });
  });

  it("attaches nothing when two original companies claim the same world", async () => {
    const t = setup();
    await company(t);
    await company(t);
    const source = await resolve(t);
    expect(source.status).toBe("missing");
    expect(source.status === "missing" && source.reason).toMatch(/More than one Field company/);
  });

  it("keeps books outside an operating world unlinked", async () => {
    const t = setup();
    await company(t);
    const source = await resolve(t, makeRun({ runId: "base" }));
    expect(source.status === "missing" && source.reason).toMatch(/not exported by a Field company/);
  });
});
