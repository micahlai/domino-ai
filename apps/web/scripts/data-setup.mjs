#!/usr/bin/env node
// Deterministic demo data for an empty Convex deployment. Every step is idempotent, so rerunning
// is safe. Extra CLI args (for example `--prod`) are passed through to `npx convex run`.
// Run from apps/web with `convex dev` already pushing functions to the target deployment.
import { execFileSync } from "node:child_process";

const passthrough = process.argv.slice(2);
const COMPANIES = ["2u", "asana-inspired", "gitlab-inspired", "asana-current", "gitlab-current"];
const SCENARIOS = ["baseline", "late-payments", "customer-loss", "unexpected-expense"];

function run(fn, args = {}) {
  const out = execFileSync("npx", ["convex", "run", ...passthrough, fn, JSON.stringify(args)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    return JSON.parse(out);
  } catch {
    return out.trim();
  }
}

function step(label, fn) {
  try {
    const result = fn();
    console.log(
      `ok   ${label}`,
      typeof result === "object" ? JSON.stringify(result).slice(0, 120) : "",
    );
    return result;
  } catch (error) {
    const msg = String(error.stderr || error.message)
      .split("\n")
      .filter(Boolean)
      .slice(-2)
      .join(" ");
    console.log(`FAIL ${label}: ${msg}`);
    return null;
  }
}

// 1. Picker companies (Kestrel, Harrier, Merlin, Osprey), seed 1. Ingest runs on the scheduler.
step("field:setupAll", () => run("field:setupAll"));

// 2. Filing-backed operating demos (2U, Asana, GitLab) for every scenario. `ensure` creates an
//    idle company; `fieldAgents:start` schedules its first ingest (deterministic books).
const ids = [];
for (const company of COMPANIES)
  for (const scenario of SCENARIOS) {
    const label = `${company}/${scenario}`;
    const ensured = step(`fieldOperating:ensure ${label}`, () =>
      run("fieldOperating:ensure", { company, scenario }),
    );
    if (!ensured?.companyId) continue;
    step(`fieldAgents:start ${label}`, () =>
      run("fieldAgents:start", { companyId: ensured.companyId }),
    );
    ids.push({ label, companyId: ensured.companyId });
  }

// 3. The "Bring in latest books" import that saves each demo's timeline baseline. Retries while
//    the scheduled ingest finishes. Deterministic request ids make reruns reuse the same runs.
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
if (!process.env.SKIP_TIMELINE)
  for (const { label, companyId } of ids) {
    let ok = null;
    for (let attempt = 0; attempt < 10 && !ok; attempt++) {
      if (attempt) sleep(3000);
      try {
        ok = run("fieldTimeline:openInTimeline", { companyId, reviewed: true });
      } catch (error) {
        if (attempt === 9)
          console.log(
            `FAIL fieldTimeline:openInTimeline ${label}: ${String(error.stderr || error.message)
              .split("\n")
              .filter(Boolean)
              .slice(-1)}`,
          );
      }
    }
    if (ok) console.log(`ok   fieldTimeline:openInTimeline ${label} created=${ok.created}`);
  }

console.log("done. Verify: npx convex run field:companies");
