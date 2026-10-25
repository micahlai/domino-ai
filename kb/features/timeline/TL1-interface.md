# TL1 fixed backend/UI interface

Backend owns `convex/timeline/baselines.ts`. UI owns `components/timeline/baseline/**` and the existing `components/timeline/seam/TimelineSeamHarness.tsx` integration. Workers use separate branches/checkouts and never edit each other's files.

- `timeline/baselines:save` public mutation args: `{ requestId: string, seedJson: string, modelJson: string, constraintsJson: string, assumptionNote: string, reviewed: boolean }`. Backend rejects `reviewed:false`. Returns `{ runId: string, companyId: string, created: boolean }`.
- `timeline/baselines:get` public query args: `{ companyId: string, runId: string }`. Returns `null` if not found under that company, otherwise `SavedBaseline` below. Read path does not run engine/provider.
- `SavedBaseline`: `{ runId: string, companyId: string, companyName: string, seedHash: string, inputHash: string, methodVersion: string, assumptionNote: string, model: CompanyModel, constraints: Constraint[], seed: WeeklySeedV1, forecast: Forecast, dominoes: Domino[], history: HistoryWeek[], pastEvents: PastEvent[], savedAt: string }`.
- Return only this projection (no database system fields). `savedAt` is an ISO timestamp. Domain runId stable across identical request retries; methodVersion frozen by backend. UI does not calculate cash or invent rule receipts.
- Use `makeFunctionReference` with these exact names/types until lead runs CLI codegen. Browser must not import backend runtime modules. Provider-free fixture `weeklyBoundaryFixtures.validKestrelWeeklySeed` initializes seed text; neutral model is explicit and must be reviewed.
- UI read link is `/playground/timeline-seam?companyId=...&runId=...`, encoded with URLSearchParams. Persist/open via that context and present not-found/errors honestly. Advanced JSON controls optional; primary controls use plain language.

This is a Timeline-local interface, not a new shared contract or Field seam version. Lead owns updating both workers if it must change. TL1S/B backend and TL1U UI acceptance still apply.
