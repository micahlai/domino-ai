# Sponsor notes

- **Hyphenate (formerly Maximor):** autonomous finance. Judges ask: real enough, would you hire it, something new, the moment. Prize $8K/$5K/$3K. Past HackMIT Maximor winners: VistaAI (PE roll-up integration), CFO-Sabbatical (16 bots, AR to forecast propagation), Sherlock, Money Maxer, TrueUp. Nobody did a multiverse stress test.
- **Microsoft Grand Prize:** customer understanding, measurable usefulness, path to production, responsible design, end-to-end.
- **Figma Idea to Demo:** stage log + Figma Slides + Edu verification. $2K workflow, $2K stage log, $500 design, $500 creative.
- **CREAO:** a CREAO agent (agent.creao.ai) must do the core work; agent id + run share link in README. API setup verified below.
- **Convex:** best use of Convex. **Capital One:** best use of Nessie.

## CREAO API setup verified 2026-10-24

- Official docs: [API Trigger](https://docs.creao.ai/pro/api-trigger). Root `.env` uses `CREAO_API_BASE_URL=https://agent.creao.ai/api/v1`. The local key was created in chat Settings → API keys; the same key successfully started all three Domino agents. Agent-page scoped keys are limited to one agent.
- Create: `POST /apps/{appId}/runs`, `Authorization: Bearer <local key>`, JSON body `{ "inputs": { "prompt": "<JSON-encoded job input>" } }`. Response is HTTP 202 with `id`, `status`, `appId`, and `appName`.
- Poll: `GET /apps/{appId}/runs/{runId}` with the same Bearer header until `completed`, `failed`, or `cancelled`. The owner chat is `/chat?threadId={threadId}`. Three initial mock runs completed during setup; no systematic latency benchmark was taken.
- The observed `result.text` was a JSON memory summary, **not the job output**. The mapper returned a JSON file in `result.artifacts`. The corrected constraint run returned its valid JSON array inside `result.chatText`, surrounded by narration; the initial constraint run had returned a file. The brief was in `result.chatText` and included a tool-use preamble. E6 must handle these varying formats and validate extracted job output with the contract schemas rather than parsing the memory summary as the result. Strict raw-output formatting is not yet reliable.
- Artifact URLs are authenticated `/runs/{runId}/artifacts/download?artifactId=...` endpoints. Follow the HTTPS storage redirect without forwarding Authorization to a different origin. Do not persist signed storage URLs.
- Agents are private, have one required `prompt` input, no connectors, and no schedules. Autonomy was switched to Ask first. IDs are in the README and submission checklist. The Constraint Reader was corrected to require the literal category `evidence.source="document"`; filenames belong in `evidence.ref`.
- The Developer Console `/v2` API is a separate project-key product with USD billing and a zero balance on this account at setup. Do not mix its keys, agent IDs, or billing with the chat API used here. No funds were added.
- The E6 code adapter and public judging share links remain separate follow-up work. Local credentials are never included here.

### Verified mock runs (owner access)

- [Source mapping](https://agent.creao.ai/chat?threadId=ab009dbf-d941-438d-a54b-0cd65ac1244c): invoice amount maps to `amount_due`; JSON artifact passes `FieldMappingSchema[]`.
- [Constraint reading](https://agent.creao.ai/chat?threadId=2919221a-4088-4e76-897a-797b3fae8852): corrected JSON content passes `ConstraintSchema[]`; exact quote covers the usable-cash restriction and source category is `document`.
- [Weekly brief](https://agent.creao.ai/chat?threadId=6dfded2d-2e97-45f8-9c0c-393a89f72bad): repeats the supplied grade and cites the supplied miss/model. Tool-use narration still appears before the brief.
