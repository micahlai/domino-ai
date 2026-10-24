# S0: Fill local CREAO configuration

- **Goal:** Create the three Domino agents and populate all CREAO fields in the ignored root `.env` from the signed-in Chrome account.
- **Folder:** `.` (only `.env`, README agent references, and task/status/research notes in `kb/`).
- **Contracts used:** Agents, FieldMapping, Constraint, Evidence, CompanyModel (read-only prompt definitions).
- **Done when:** All five values match CREAO, one mock run per job completes with verified output, `.env` remains ignored, and `pnpm check` passes.
- **Notes:** Build spec §9.3. Human approved agent and key creation. Never put credentials in notes, output, or commits. Record real IDs only.
