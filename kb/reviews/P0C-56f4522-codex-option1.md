# P0-C 56f4522 Codex scoped audit (option 1)

Reviewer: Codex CLI 0.159.2, read-only, session 01a17104-f050-7091-bd68-0040cf27cf77. Scope: JSON-text boundary only (Jayden option 1).

**ACCEPT `56f4522` under option 1.** No in-scope findings.

- **81,741 JSON-text calls:** zero exceptions. Forced all eight public catches with hostile thrown values; zero observations of those values or prototype pollution.
- **2,140-case differential:** zero contract-accepted/engine-rejected seeds.
- **431 earlier boundary cases + 35 new cap cases:** zero acceptance gaps. Actually ran the engine at and beyond depth 16, 10,000 derivation visits, lag 3,660, benefit start `9999-12-31`, and ±2^49.
- Both prior in-scope repros now reject: the **8,000-link chain** and **2^49 lag**.
- **Fixtures:** 6/6 byte-identical to `189fb0d`; all hashes unchanged; 52/52 independent assertions pass.
- **Regressions:** 97/97 general, 497/497 second-round, 8/8 original gaps rejected, 3/3 canonical assertions, and 30/30 non-text getter probes.
- **Required checks:** 489/489 contracts tests, 4/4 typechecks, Biome clean across 32 contracts files.
- Header and card clearly document the JSON-text/internal-schema split.

[Full audit and evidence](/tmp/domino-p0c-56f4522.S8U9hj/AUDIT.md)

Repository clean. No network or sealed/withheld data access. Approval covers the scoped JSON-text seam; hostile object-schema behavior remains excluded.