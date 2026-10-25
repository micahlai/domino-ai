#!/usr/bin/env node
// Engine recompute timing per company on the configured deployment (run from apps/web with
// `convex dev` pushing). Compares the whole run inside one mutation (1 s limit) with the split
// load query -> engine in action -> guarded write mutation. Usage: node scripts/time-engine.mjs
import { execFileSync } from "node:child_process";

const run = (fn, args = {}) =>
  JSON.parse(
    execFileSync("npx", ["convex", "run", fn, JSON.stringify(args)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );

const ids = [
  ...run("field:companies").map((c) => ({ id: c.companyId, name: c.name })),
  ...run("fieldOperating:list").map((c) => ({ id: c.companyId, name: c.name })),
];
console.log("company | single mutation | split load / engine / write | branches, payload");
for (const { id, name } of ids) {
  try {
    const { single, split } = run("dev/engineTiming:recompute", { companyId: id });
    const one = single.error
      ? `${single.ms}ms FAILED (${single.error.slice(0, 60)})`
      : `${single.ms}ms`;
    console.log(
      `${name} | ${one} | ${split.loadMs} / ${split.engineMs} / ${split.writeMs}ms${split.stale ? " STALE" : ""} | ${split.branches}, ${Math.round(split.bytes / 1024)} KB`,
    );
  } catch (error) {
    console.log(`${name} | error ${String(error.message).split("\n")[0]}`);
  }
}
