# P0-S prep (read-only inspection)

Checkout: /Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-preview, branch preview/historical-overnight, HEAD 7cf6ae6, `git status` clean at inspection time.
Nothing was written, run, fetched or deployed. Everything below is from reading files and `git` read commands. "Unverified" marks anything I did not execute.

Abbreviations: ROOT = /Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-preview ; WEB = ROOT/apps/web

## 1. Missing Convex AI guide

Facts
- WEB/AGENTS.md says to read `convex/_generated/ai/guidelines.md`. Absent in WEB/convex/_generated (only api.d.ts, api.js, dataModel.d.ts, server.d.ts, server.js, all tracked by git).
- Installed convex: 1.48.0 (WEB/package.json pins "1.48.0"; resolves to ROOT/node_modules/.pnpm/convex@1.48.0_react@19.3.1; only one convex version in .pnpm besides convex-test@0.0.65).
- The installed package ships NO copy of the guide. WEB/node_modules/convex has no guidelines/ai markdown. The guide is downloaded at generation time: `src/cli/lib/aiFiles/guidelinesmd.ts` calls `downloadGuidelines()` in `src/cli/lib/versionApi.ts:163`, which does `fetch("https://version.convex.dev/v1/guidelines")`. So generating it needs network.
- Installed CLI source for the command: WEB/node_modules/convex/src/cli/aiFiles.ts. Subcommands of `npx convex ai-files`: `status` (network, read-only on disk), `install`, `update` (both identical: write guidelines + AGENTS.md/CLAUDE.md sections + agent skills), `enable`, `disable` (both write convex.json), `remove`. I did not execute `--help` (even help may init Sentry/network; unverified).
- Target path computed by `paths.ts`: `<convexDir>/_generated/ai/guidelines.md` plus state file `<convexDir>/_generated/ai/ai-files.state.json`.

Local equivalent that already exists (best option, no network)
- /Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-ai/apps/web/convex/_generated/ai/guidelines.md (286 lines, sha256 b6b776e9d4dacfe8da23a58c9d11ab9cc9c505891c8f6b9fa9cdc69e4266ac37), with sibling ai-files.state.json (guidelinesHash equals that sha256). Same convex 1.48.0 (domino-ai/apps/web/package.json). Header says "These guidelines target Convex ^1.44.0". It is untracked there (`?? convex/_generated/ai/`), not gitignored.
- Whether it is the newest upstream version is unverified (cannot hit network).
- Relevant rules from it for P0-S: "Define the schema in convex/schema.ts"; "Never import your schema from _generated"; `import schema from "./schema"; schema.doc("table")`; include index fields in the index name (by_field1_and_field2); "An index added to a large existing table can block deploy during backfill. Use staged: true" (lines 42-48, 14-15). Test files go under convex/ with `import.meta.glob`.
- Other Convex material on disk: /Users/jaydenl/.codex/.tmp/plugins/plugins/convex has only README/icon/plugin.json, no guide.

Would generation modify tracked files? Yes, for `install/update`:
- Writes WEB/convex/_generated/ai/guidelines.md and ai-files.state.json: new, untracked, not ignored (so they would show in git status). Not tracked files.
- `applyAgentsMdSection` rewrites the Convex section of AGENTS.md (projectDir; probably WEB/AGENTS.md, which is TRACKED; unverified which dir `readProjectConfig` resolves with no convex.json present, WEB has none). `applyClaudeMdSection` creates/edits CLAUDE.md there. `installSkills` writes agent skill folders (domino-ai shows untracked .agents/, .claude/, CLAUDE.md after this ran). Also needs network for skills catalog.
- It does not touch api.d.ts / dataModel.d.ts. (Only `convex dev`/`codegen` regenerate those.)

Recommendation: do NOT run `ai-files install`. Instead copy the single file (a write, so orchestrator's call):
`cp "/Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-ai/apps/web/convex/_generated/ai/guidelines.md" "/Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-preview/apps/web/convex/_generated/ai/guidelines.md"` (mkdir the ai dir first). Leave it untracked (or the P0-S worker just reads it from the domino-ai path). If done properly later: `cd WEB && npx convex ai-files install` (network, touches tracked AGENTS.md).

## 2. Schema inventory (WEB/convex/schema.ts, 206 lines, 22 tables)

Shared consts at top of schema.ts: `companyId = v.id("companies")`, `sourceKind` (union), `decision` (approved|rejected). They are used ONLY by legacy tables (companyId by 14 tables, sourceKind by sources, decision by approvals). No Field/Timeline table uses them, so no cross-fragment import is needed beyond legacy.ts.

Access found by grep of `ctx.db.query("t")/insert/patch/delete` (patch/delete use bare `_id`, attributed by file context). Tests in convex/tests/*.ts read many tables directly; listed only where notable.

### Legacy (14 tables, common frozen base) -> schema/legacy.ts
| table | indexes | modules |
|---|---|---|
| companies | none | companies.ts (ctx.db.get/insert via fixtures), lib/records.ts requireCompany (get), dev/seedFixtures.ts, dev/seedComputed.ts (insert) |
| sources | by_company [companyId] | R sources.ts; W dev/seedFixtures.ts, dev/seedComputed.ts |
| snapshots | by_company_asOf [companyId, asOf] | R companies.ts, lib/publish.ts; W dev seeds |
| models | by_company_version [companyId, version] | R models.ts, lib/publish.ts; W dev seeds |
| constraints | by_company [companyId] | R constraints.ts, lib/publish.ts; W dev seeds |
| risks | by_company [companyId] | R risks.ts; R/W lib/publish.ts (insert+delete); dev/seedFixtures.ts |
| branches | by_company [companyId], by_branchId [branchId] | R branches.ts, lib/records.ts, lib/publish.ts; W lib/publish.ts (insert/delete); dev/seedFixtures.ts |
| fixes | by_branch [branchId] | R fixes.ts, lib/records.ts, lib/publish.ts; W lib/publish.ts; dev/seedFixtures.ts |
| resilience | by_company_withFixes [companyId, withFixes] | R resilience.ts; R/W lib/publish.ts; dev/seedFixtures.ts |
| history | by_company [companyId] | R history.ts; R/W lib/publish.ts; dev/seedFixtures.ts |
| approvals | by_company [companyId] | R/W approvals.ts (query + insert at :58) |
| grades | by_company [companyId] | R grades.ts (no writer in non-test code) |
| explanations | by_branch [branchId] | R explanations.ts (no writer in non-test code) |
| log | by_company [companyId] | R log.ts, lib/publish.ts, dev/seed*; W lib/publish.ts, lib/records.ts (insert :70), dev seeds |

### Timeline fragment (4 tables) -> schema/timeline.ts
| table | indexes | modules |
|---|---|---|
| historicalRuns | by_runId [runId], by_requestId [requestId]. Has `owner: optional(string)` | R/W historical.ts (:144,:192,:197) only. |
| historicalReveals | by_runId, by_requestId | R/W historical.ts (:463,:530,:552,:568 get) |
| historicalRevealReceipts | by_requestId | R/W historical.ts (:509,:540) |
| historicalActivity | by_feed [baselineRunId, sequence] | R/W historical.ts (:424,:430,:448) |

All four are touched only by historical.ts (Timeline-owned) in non-test code. Timeline also needs new finance request/receipt tables later; they go in this fragment.

### Field fragment (4 tables) -> schema/field.ts
| table | indexes | modules |
|---|---|---|
| investigationRequests | by_requestId [requestId] | investigation.ts (:221,:234) |
| investigationConversations | by_conversationId [conversationId] (S2 will add by_case_createdAt [caseId, createdAt]) | investigation.ts (:140,:263) |
| investigationMessages | by_conversation [conversationId, sequence] | investigation.ts (:169,:173,:391) |
| investigationOperations | by_operationId [operationId], by_conversation [conversationId, sequence] | investigation.ts (:149,:155,:190,:198, patches :513,:548,:678,:735,:783) |

### Both-lane flags (no table is written by both lanes' own modules, but there are seams)
1. historicalRuns.owner is a Field-originated value: investigation.ts (Field) calls Timeline-owned helpers `saveBaselineIn / computeAlternativeIn / revealIn / loadRun` from ./historical (imports at investigation.ts:25-41, calls :586,:605,:625, with owner = conversationId). The ROWS are written only inside historical.ts, so the table stays Timeline, but investigation.ts has a code dependency on historical.ts exports. Do not change those helper signatures or the `owner` column.
2. S2 investigationCatalog.ts (Timeline-owned) READS investigationConversations and investigationOperations (Field tables). Cross-lane read, write-free. This is why the by_case_createdAt index in the Field fragment must land in the shared base before the split, otherwise Timeline would need to edit Field's fragment (what the spec says to avoid).
3. investigationOperations.outputRef / output carry historical run ids (strings only, no v.id), so no cross-fragment validator coupling.
4. Name collision risk for future work: legacy `sources`/`snapshots`/`models` already exist; Field's new "source/mapping/reconciliation/knowledge" tables need distinct names (e.g. prefix `knowledge*`/`field*`), and Timeline's new finance tables distinct from `historical*`. Spec says the table names stay disjoint.
5. dev/seed*.ts, lib/publish.ts, tests all import `schema` default from "../schema" (tests/*.test.ts: activity, backend, computed, historical, investigation). Root `schema.ts` must keep `export default defineSchema(...)`.

Proposed assignment: legacy 14 / timeline 4 / field 4 as above. All table names, validators (including optional fields on historicalReveals.view/revealHash and investigationOperations), index names and index field order must be copied verbatim. Table order in the composed object is free but preserve it if you diff `schema.export()` (see section 5).

## 3. Does defineSchema compose from separate files? Constraints on convex/ files

Composition: yes, no installed-version obstacle.
- `export function defineSchema<Schema extends GenericSchema, StrictTableNameTypes extends boolean = true>(schema: Schema, options?) : SchemaDefinition<Schema, ...>` at WEB/node_modules/convex/src/server/schema.ts:1082. `GenericSchema = Record<string, TableDefinition>` (:862). It just takes an object, so `defineSchema({ ...legacyTables, ...fieldTables, ...timelineTables })` works. Types keep table names as long as each fragment exports a `const` object literal of `defineTable(...)` results (do not annotate as `Record<string, TableDefinition>`, that would widen and break `DataModel`/`Doc<"x">`). `DataModelFromSchemaDefinition` derives from `SchemaDef["tables"]` keys (:1099+).
- Duplicate keys across spreads would silently override; guard with a test that the union of key sets is 22 distinct names.
- `SchemaDefinition.export()` (schema.ts:949, @internal) serializes tables+indexes+validators to JSON, useful for a before/after equivalence check.

File-location constraints (from installed bundler source WEB/node_modules/convex/src/bundler/index.ts:405-512 `entryPoints`, and cli/lib/codegen.ts:845 which uses the same function for api.d.ts):
- Every .js/.ts/.tsx/.mjs/.cjs etc. file under convex/ is an entry point (a "module") and is bundled, EXCEPT: anything under `_generated/`; dotfiles; `#*`; any file whose basename is exactly `schema.ts`/`schema.js` at ANY depth (":base === schema.ts"); files with more than one dot in the basename (e.g. `foo.test.ts`, `field.schema.ts`); paths containing a space; a directory containing `convex.config.ts` (a component). `_deps/` is reserved (crash).
- Consequence: `convex/schema/field.ts`, `timeline.ts`, `legacy.ts` (the spec's planned names) ARE entry points. They contain no registered functions, which is legal (lib/*.ts already is the same case), but `convex dev`/codegen will then add `schema/field`, `schema/timeline`, `schema/legacy` to the tracked `_generated/api.d.ts` module list (`import type * as schema_field from "../schema/field.js"` and entries in `fullApi`). That edit collides with other branches that touch api.d.ts (S2 adds investigationCatalog registration; S1/S3 etc.). Cleaner options that add no api.d.ts churn:
  - (a) `convex/schema/field.schema.ts`, `timeline.schema.ts`, `legacy.schema.ts` (two dots, skipped by the bundler and codegen), or
  - (b) `convex/schema/legacy/schema.ts`, `convex/schema/field/schema.ts`, `convex/schema/timeline/schema.ts` (basename schema.ts, skipped), or
  - (c) keep the planned `convex/schema/*.ts` and accept regenerated api.d.ts entries (per spec generated bindings are regenerated at integration anyway).
  Either way `schema.ts` and the `schema/` directory can coexist (`./schema` resolves to the file; esbuild/Bundler resolution prefers file over directory; tsconfig "moduleResolution": "Bundler" in convex/tsconfig.json). The coexistence itself is unverified by execution, but module name "schema" vs "schema/field" do not collide.
- Test harness: tests use `import.meta.glob(["../**/*.ts", "../_generated/*.js", "!./**"])` (e.g. convex/tests/historical.test.ts). That glob will pick up fragment files as modules, harmless (no functions). convexTest(schema, modules) takes the composed schema from `../schema`.
- Fragments need `import { defineTable } from "convex/server"; import { v } from "convex/values";`. Legacy fragment owns/exports `companyId`, `sourceKind`, `decision` consts; Field/Timeline do not need them.
- Guideline from the copied guide: schema defaults exported from schema.ts; never import schema from `_generated`.

## 4. S2 overlap

- S2 (kb/tasks/S2-simulation-catalog.md) allowed schema.ts edit: ONLY add `by_case_createdAt` on investigationConversations(caseId, createdAt). Also kb/requests.md line 6 says S4 waits for it.
- Fragment holding it: Field fragment (investigationConversations is Field per lanes spec line 45). After P0-S: `investigationConversations: defineTable({...}).index("by_conversationId", ["conversationId"]).index("by_case_createdAt", ["caseId","createdAt"])` in the Field fragment. Note the guide's naming convention would prefer `by_caseId_and_createdAt`, but the task fixes `by_case_createdAt`; keep it, flag at review.
- Current S2 state: the local remote ref origin/S2-simulation-catalog is at 1154972, which is an ancestor of preview HEAD 7cf6ae6, i.e. NO implementation commits and no schema diff vs HEAD as of the last fetch (stale-ness unverified; no fetch allowed). No local S2 worktree exists (the friend works on a second computer). `grep by_case_createdAt` finds only kb docs, never code. HEAD does not contain the index.
- If P0-S runs before S2 is integrated:
  1. Textual conflict: P0-S deletes the 206-line body from schema.ts (moves tables to fragments); S2's one-line `.index("by_case_createdAt", ...)` hunk in schema.ts then conflicts (modify/delete of the region). Easy to resolve by hand: drop the schema.ts hunk and re-add the line in the Field fragment. Mistake mode: resolving by keeping both would create a duplicate index name (Convex rejects duplicate index names on a table at schema evaluation/deploy; stated from Convex behavior, not tested here).
  2. Generated api.d.ts: S2 adds `investigationCatalog` import/entry; P0-S under option (c) above adds schema_* entries. Adjacent lines in the same lists, so a mergeable-but-noisy conflict. Options (a)/(b) avoid it.
  3. Backfill: adding an index to an existing table is cheap here (small local data) but the guide recommends `staged: true` for large tables; unneeded for local, unverified for any shared deployment. P0-S says no deploy.
  4. S2's investigationCatalog.test.ts uses the composed schema import from "./schema" path through `../schema`; the root default export must remain, so S2's tests still work after the split.
- Safest sequencing (matches P0-S card "after current S2 writer/index checkpoint"): get S2's checkpoint pushed and audited, merge it into the shared base, THEN run P0-S so the index is moved as part of the extraction. If S2 is late: P0-S may include the index itself in the Field fragment and tell S2 to drop its schema.ts hunk (it still adds investigationCatalog.ts and its tests). Either way, only ONE side may add the index.

## 5. Local verification commands for P0-S (none touch ports 3102/3210/3214 or any Convex deployment)

Run from ROOT (cwd matters; do not run `pnpm dev`, `convex dev`, `convex codegen`, `convex deploy`, `convex run`, `pnpm convex:fixtures`).
- Typecheck, web workspace (includes convex/ since tsconfig include is **/*.ts): `pnpm --filter @domino/web exec tsc --noEmit --incremental false`. The package script `pnpm --filter @domino/web typecheck` is equivalent but, because tsconfig has `incremental: true`, it rewrites the git-ignored apps/web/tsconfig.tsbuildinfo.
- Convex-only project typecheck: `pnpm --filter @domino/web exec tsc -p convex --noEmit --incremental false` (convex/tsconfig.json; unverified that it passes today, since convex code imports ../../../packages/*).
- Backend tests (convex-test, in-memory, edge-runtime; tests read no process.env/CONVEX_URL, confirmed by grep): `pnpm --filter @domino/web exec vitest run convex/tests`. Files: activity, backend, computed, historical, investigation, parse tests. Whole web suite: `pnpm --filter @domino/web test` (adds component tests; vitest cache under node_modules/.vite is the only write, ignored).
- Lint/format check, read-only: `pnpm exec biome check apps/web/convex` (biome ignores `_generated`).
- Schema preservation proof (recommended, not existing): before the edit, capture `JSON.stringify(JSON.parse(schema.export()).tables.sort by tableName)` from the current schema.ts (e.g. in a throwaway vitest file in scratchpad or as the P0-S "narrowly necessary schema test"); after the split assert equality and that the table-name sets of the three fragments are disjoint and union to the 22 names. `export()` is `@internal`; its stability/ordering is unverified, so sort before comparing.
- Existing-row read check: the existing tests (backend/computed/historical/investigation) insert rows by validator through convex-test using the composed schema, which validates stored shapes (convex-test applies schema validation, unverified in detail).
- Do NOT regenerate `_generated/api.d.ts`/`dataModel.d.ts` with the CLI (needs a deployment or `convex codegen`, which may contact the backend). With fragments named per options (a)/(b) the existing generated files stay valid (dataModel.d.ts imports `../schema.js` only; unverified by running).

## Open items for the orchestrator
- Decide fragment file naming (option a/b/c in section 3) before P0-S starts. Spec's literal paths (c) cause api.d.ts churn.
- Decide how the worker reads the Convex guide (copy from domino-ai vs. read in place).
- S2 sequencing (section 4).
