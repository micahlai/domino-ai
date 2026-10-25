# S2 ff8b27c Codex re-audit (round 2)

Reviewer: Codex CLI 0.159.2, read-only, session 01a1710e-0b3f-7451-971d-55a8af18b259. Repair by lead at Jayden request. P3-2 (card text) fixed in follow-up commit; P3-1 (test cannot observe read count) recorded as known gap.

**ACCEPT `ff8b27c`.** The prior P2 is resolved. Two nonblocking findings remain.

1. **P3: Regression tests do not protect the pagination call.** [investigationCatalog.test.ts:275](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-S2/apps/web/convex/investigationCatalog.test.ts:275>). Both new tests still pass when the cap call is removed in an isolated copy. Add a read-count or pagination-options assertion at that boundary.

2. **P3: Handoff describes superseded behavior.** [S2-simulation-catalog.md:14](</Users/jaydenl/Dev/Hackathon/CalHacks 26/domino-S2/kb/tasks/S2-simulation-catalog.md:14>). Options no longer pass unchanged: every caller row cap becomes 26, including smaller caps. Update the bounds description too.

Independent instrumentation counted the harness’s actual pagination `rowsRead` counter before rejection:

| Caller `maximumRowsRead` | `bd7e880` | `ff8b27c` |
|---|---:|---:|
| Omitted | 500 | 26 |
| 1,000 | 500 | 26 |
| `MAX_SAFE_INTEGER` | 500 | 26 |

All **80 row/byte-budget combinations** stayed at or below 26 after repair. Oversized requests performed no operation/proof reads. These measure logical pagination reads; convex-test separately enumerates its in-memory source.

Installed Convex **1.48.0** documents the row limit without an `endCursor` exemption and forwards both options unconditionally to `1.0/queryPage`. The harness enforces the limit during range traversal. **Production backend enforcement remains empirically unverified** because its implementation is absent locally and this audit is offline. I judge that nonblocking given the explicit production API contract. This is not a production I/O measurement.

Checks:

- **Typechecks:** web + Convex **2/2 passed**, incremental disabled.
- **Web Vitest:** **410/410 passed**, 27 files.
- **Independent probes:** **63/63 passed**, including 125 status permutations, all page sizes 1..25, and **1,250 bounded endCursor comparisons**. Normal cursor metadata, byte-limited continuation, isolation, allowlist, output proofs, truncation, and read-only behavior passed.
- **Biome:** **38 files passed**.
- **API:** helper registration flags absent; API type assertions passed. Repair leaves `api.d.ts` unchanged.
- **Ownership/schema:** **5/5 files authorized**; all 22 table validators and previous indexes preserved.

Repository unchanged. No network, prohibited-data access, Convex dev/deploy/codegen, or reserved-port access.

[Full audit, probes, and evidence](</var/folders/_x/xd2ms3z958s6pfllwphw48vm0000gn/T/domino-s2-reaudit-jh4p4ddz/AUDIT.md>)