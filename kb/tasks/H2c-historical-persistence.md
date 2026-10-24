# H2c: Immutable historical run and reveal APIs
- **Goal:** Persist a historical run, reveal later disclosures and compare without rewriting the saved forecast.
- **Folder:** apps/web/convex/ including additive schema and generated bindings; exceptions this Result and contract-v1.md readiness section. No app/component edits.
- **Contracts used:** H2a historical schemas, H2b pure model, checked H1 bundle. Preserve operational companies/connect/engine/week APIs.
- **Done when:** Separate historical entry points validate input; save/retry and reveal are idempotent; run/source/method/assumption hashes persist; pre-reveal payloads exclude later evidence; company/run associations checked; reveal cannot modify prior forecast; concurrent/repeated calls tested; pnpm check passes.
- **Notes:** Use existing Convex tests and local isolated runtime only; no shared cloud dev/deploy/reseed. Imported later data stays server-side and never enters forecast/agent inputs. Only actual implemented/tested endpoint names belong in the API-ready packet; generate bindings through supported local tooling.
- **Handoff:** Push API-ready SHA on H2-historical-backend, update packet with actual names/args/results, reproducible setup and exact code SHA containing the complete evidence/contracts/engine/Convex/generated-bindings dependency closure. Do not claim browser integration from unit tests alone.
## Result
- Done:
- Files and commit:
- Verification:
- Watch out / next:
