# I3: Enable controls for the computed company
- **Goal:** Let the live computed company add known events and simulate fixes while accurately labeling unfinished week advancement.
- **Folder:** apps/web/components/company; exceptions: convex/companies.ts and its focused tests for a read-only capabilities query, generated API bindings, this card Result. No other Convex behavior or schema changes.
- **Contracts used:** Existing company IDs, Branch, engine actions and computed base-branch identity helper.
- **Done when:** Computed-company event/simulation buttons enable, fixture/legacy companies remain gated, Next week remains disabled, focused tests and full check/build pass. Existing sample playground remains intact.
- **Notes:** Launch only after I2 reviewed and merged. Add a read-only companies.capabilities query deriving readiness from a saved computed base branch for the company's current snapshot/date, using the server helper rather than parsing IDs in UI. Missing company/snapshot/computed base means false. No readiness inferred from company name or arbitrary UI flags.
- **Scope:** Replace global flags in LiveCompany with queried capabilities; pass simulation readiness into LiveFixes; handle loading safely; revise stale copy to say events and fixes are available and week advancement is not, where applicable. Preserve approval confirmation and the no-execution wording. No automatic approval, mock metric changes or forced favorable scores.
- **Verification:** Test readiness true for current computed base, false for fixture and stale-date branches, and unavailable company. Check type/build and existing UI tests. Codex will exercise browser after deployment; report that separately.
- **Coordination:** You are not alone. No env/dependency/contract/hero styling edits, provider calls, deployment, secrets, other checkout writes, subagents, pull/rebase/reset/stash/merge/push. Commit only owned files and Result for independent review. Claude directly authorized by user.
## Result (worker fills this in when done)
- Done:
- What changed (files):
- Watch out:
