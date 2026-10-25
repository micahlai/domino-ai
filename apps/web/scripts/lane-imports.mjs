// P0-H lane import inventory. Lists every import whose source and target files belong to
// different feature lanes (Field vs Timeline), resolving relative ("../") and "@/" paths.
// Usage (from the repo root): node apps/web/scripts/lane-imports.mjs
// Exit code 1 if a cross-lane import is found in a P0-H harness file (they must stay isolated).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importSpecs } from "./import-specs.mjs";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Ownership from kb/spec/independent-feature-lanes.md "Source ownership after P0", plus P0 v2
// (kb/spec/weekly-product-vision-2026-10-24.md). components/investigate (agent map) is Field.
const LANES = {
  field: [
    /^app\/investigate\//,
    /^app\/case\/2u\/page\.tsx$/,
    /^app\/case\/2u\/company\//,
    /^app\/playground\/agent-canvas\//,
    /^app\/playground\/field-seam\//,
    /^components\/investigate\//,
    /^components\/case-workspace\/CompanyView\.tsx$/,
    /^components\/field\//,
    /^convex\/investigation\.ts$/,
    /^convex\/tests\/investigation\.test\.ts$/,
    /^convex\/field\//,
    /^convex\/schemas\/field\.schema\.ts$/,
  ],
  timeline: [
    /^app\/historical\//,
    // P0 v2: the existing weekly /c/[companyId] UI and its components.
    /^app\/c\//,
    /^components\/(company|multiverse)\//,
    /^components\/(AddEventDialog|DominoChain|FixCard|Headline|MultiverseTimeline|ProofDrawer|ResilienceBar|RiskList)\.tsx$/,
    /^app\/case\/2u\/simulations\//,
    /^app\/playground\/timeline-seam\//,
    /^components\/historical\//,
    /^components\/case-workspace\/(SimulationList|SimulationDetail|Saved)\.tsx$/,
    /^components\/case-workspace\/(summary\.ts|case-workspace\.test\.tsx)$/,
    /^components\/timeline\//,
    /^convex\/(historical|investigationCatalog)(\.test)?\.ts$/,
    /^convex\/tests\/historical\.test\.ts$/,
    /^convex\/timeline\//,
    /^convex\/schemas\/timeline\.schema\.ts$/,
  ],
};
const HARNESS = /^(app\/playground\/(field|timeline)-seam|components\/(field|timeline)\/seam)\//;

const laneOf = (p) =>
  Object.entries(LANES).find(([, rules]) => rules.some((r) => r.test(p)))?.[0] ?? null;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "_generated", ".convex"].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function resolveSpec(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = join(WEB, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"])
    if (existsSync(base + ext) && statSync(base + ext).isFile()) return base + ext;
  return null;
}

const rows = [];
for (const file of walk(WEB)) {
  const src = relative(WEB, file);
  const from = laneOf(src);
  if (!from) continue;
  const text = readFileSync(file, "utf8");
  for (const { spec, index } of importSpecs(text)) {
    const target = resolveSpec(file, spec);
    if (!target) continue;
    const to = laneOf(relative(WEB, target));
    if (!to || to === from) continue;
    const line = text.slice(0, index).split("\n").length;
    rows.push({ src, line, from, to, target: relative(WEB, target), test: /\.test\./.test(src) });
  }
}
rows.sort((a, b) => a.src.localeCompare(b.src) || a.line - b.line);
for (const r of rows)
  console.log(
    `${r.test ? "test" : "prod"}\t${r.from} -> ${r.to}\tapps/web/${r.src}:${r.line}\t-> apps/web/${r.target}`,
  );
const harness = rows.filter((r) => HARNESS.test(r.src));
console.log(
  `# ${rows.length} cross-lane imports (${rows.filter((r) => !r.test).length} production, ${rows.filter((r) => r.test).length} test); ${harness.length} in P0-H harness files`,
);
process.exit(harness.length ? 1 : 0);
