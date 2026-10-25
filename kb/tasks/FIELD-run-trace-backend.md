# FIELD exact-run trace backend
- Goal: exact saved calculation evidence for scenarios/suggestions without latest-run contamination.
- Own: apps/web/convex Field analyst/advisor/AI/log/trace code and tests; Field schema optional metadata/indexes and composition test; apps/web/lib/field-trace-contract.ts; this Result and TAKEOVER-RUN-TRACE-BACKEND.md.
- Read: AGENTS.md, RUN-TRACES-CONTRACT.md, exact explorer seam report, existing Field lifecycle/types before edit.
- Deliver: pinned inputs used by all numerical stages; exact run query; once-frozen completed/failed receipt including candidate effects and truthful provider/cache provenance; legacy evidence limitations.
- API: fieldTrace.get({companyId,runId,scenarioId?,fixKind?}); shared validated browser-safe contract announced early to root/UI.
- No: contracts/engine/Timeline schemas or backend/UI, new tables, providers, main/ports, root handoff, merge/push.
- Check: exact company/run isolation, model/rule drift after start, terminal trace immutability, old suggestion receipt after upsert, provider reuse attribution, legacy fallback, lifecycle failures, tsc/Vitest/Biome.
- Result: pending.
