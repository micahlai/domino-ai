# Current architecture: CREAO-driven company investigation

## Selected integration: existing app-scoped CREAO

User explicitly chose the older app-scoped integration. Use capi credentials and https://agent.creao.ai/api/v1/apps/{appId}/runs. Do not use the developer/account key, developer v1/v2 or separate USD wallet. Keep new key unused without deleting/changing it. G2c implements the historical adapter using existing bounded transport. Actual historical agent configuration, compatible instruction profiles, memory isolation and CREAO coordinator cycle still require verification. Document coarse API lifecycle honestly; no invented internal tool/agent nodes. Preserve the source/engine/conversation workflow in Domino.

## Correction: verified v2 project key, October24

The supplied CREAO_ACCOUNT_API_KEY variable currently contains a valid Developer Platform v2 PROJECT key. Read-only GET https://developer.creao.ai/v2/me returned200 with project/key identity resolved; no IDs or key exposed. Earlier v1 agents/usage401 resulted from API-generation mismatch, not proof of an invalid key. Do not ask user to replace it or retry v1 with it. The shared cr_sk_ prefix does not distinguish v1 Account keys from v2 project keys.

Current official docs inspected in browser: https://developer.creao.ai/docs/, https://developer.creao.ai/docs/get-started/authentication, https://developer.creao.ai/docs/models-and-pricing. v2 uses a separate USD wallet; consumer/team Pro Plus chat credits do not fund it. v1 CLI is separately documented as consumer-credit funded. User screenshot shows Team plan Pro Plus in agent.creao.ai, but remaining balance was not read. User reports developer wallet empty. No purchases, top-ups, agent creation or paid v2 execution authorized/performed. Do not switch to new paid fallback.

v2 hosted agents are project-scoped and separate from consumer agents; documented current v2 routes are me/agents/runs/realtime. Skills/secrets/workspaces/files and Super Agent route family are not exposed there. Do not port v1 memory API assumptions to v2. Assess whether existing app-scoped CREAO integration can satisfy the bounded coordinator/research journey using the existing subscription before proposing separate spend. Account-wide v1 memory/realtime entitlement remains unknown; v2 authentication alone proves neither funding nor these capabilities.

Latest user direction: keep working until the full canvas journey works; CREAO coordinator/research is product architecture, not optional after dashboard. Preserve main. User moved R1 to this computer; local isolated worktree, one UI writer. Show app-authored agent instructions/profiles, not secret prompts or hidden reasoning.

## First complete cycle

Question or authorized source update -> actual CREAO coordinator selects from the available bounded capabilities -> source/research investigation -> validated, date-filtered company knowledge -> Domino engine computes immutable forecast -> scenario specialist proposes one supported costed response -> actual nodes/output chart update -> user reveal/feedback retained as new dated knowledge. Saved predictions and historical knowledge remain immutable. Forecast improvement requires untouched-period evaluation, not a memory claim.

The initial curated2U case remains a retrospective cash miss with explicit costs and unknown benefit/downside. Do not add unsupported debt or bankruptcy claims. External research may propose evidenced hypotheses, never silently replace reported facts. Historical replay must exclude later facts AND prior conversation/memory containing later outcomes from a cutoff task.

## Durable ownership

Domino owns server-side jobs/statuses/messages/records, source hashes and publication boundaries, engine, graph and versioned instruction snapshots. Scheduled or source-change wakeups run in the backend with bounded steps and idempotent receipts, independent of an open browser. Local backend still requires this computer running until an authorized hosted deployment. Do not create unbounded paid periodic research. A scheduled check can inspect freshness and queue only a relevant change; one controlled cycle is the first gate.

CREAO owns actual coordinator/research execution using verified APIs. If only coarse lifecycle is exposed, show coarse lifecycle honestly. Never infer hidden subagents/tools from prose or animations. Generated connector proposals require tests and access before registration; arbitrary connector generation is later breadth after one proven cycle, not a blocker for curated evidence.

## Profiles shown on agent nodes

Show app-authored role, concise working style, exact safe instructions/profile version used for the run, allowed capabilities/tools, permitted evidence/cutoff, actual provider/model when known, status and output. Read-only for now. Keep IDs/hashes/raw metadata behind details. Do not expose credentials, private account memory, chain-of-thought, or unrelated system prompts. Stored runs keep their original instruction snapshot if a profile changes later.

## Selected API boundary

Current implementation uses the existing app-scoped transport at agent.creao.ai/api/v1. It starts configured agent jobs and polls/results, without verified internal agent/tool events or memory controls. Official app route reference: https://docs.creao.ai/pro/api-trigger. Its old account-key setup instructions should not be followed for this project; current Developer Console creates a different v2 project key, verified above and intentionally unused.

Call: actual CREAO jobs behind Domino-owned durable records and a strict capability allowlist. Counterargument: delegating the entire workflow/state to CREAO is simpler, but limited API events and historical memory isolation could block or contaminate the demo.

## Historical memory isolation gate

CREAO documents long-term memory scoped per personal agent: https://docs.creao.ai/developer-api/agent-memory. A fresh conversation alone does not establish a clean historical cutoff. Under the selected app-scoped route, use dedicated historical agent identities with compatible instructions and verified bounded case/cutoff/visibility. Never pass later observations to a pre-cutoff identity or reuse old operational agents with uncontrolled prior memory. If isolation cannot be established through available app settings, disclose/block that live acceptance gate instead of claiming an uncontaminated replay. Do not clear or overwrite unrelated memory. App-scoped API access does not grant the separate account memory APIs.
