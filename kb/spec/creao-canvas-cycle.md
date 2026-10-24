# Current architecture: CREAO-driven company investigation

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

## Verified API boundary, October24

Official docs: https://docs.creao.ai/developer-api/api-paths, /developer-api/streaming-events, /developer-api/agent-memory/get-agent-memory, /developer-api/overview.
Current configured key was inspected by scope only: app-scoped, with existing map/constraints/brief agent slots. No key printed or changed. Account-only endpoint not called with incompatible key. Existing app adapter supports predefined runs/poll/results, not detailed coordinator events or memory.
Account API supports agent lifecycle, NDJSON stream, memory and usage. Super Agent routes are allowlisted; do not infer account entitlement from docs. User added CREAO_ACCOUNT_API_KEY into ignored domino-ai/.env.local; current key returns401 with Node24. Until authentication succeeds, implement provider-independent durable/UI pieces and preserve honest unavailable state. No secret copy to remote machine/Git. No automatic paid fallback. Inspect metadata with read-only calls before bounded execution.

Call: actual CREAO jobs behind Domino-owned durable records, with a strict capability allowlist. Counterargument: handing the entire workflow/state to CREAO is simpler, but API access and historical memory isolation could block or contaminate the demo.

## Historical memory isolation gate

CREAO documents automatic long-term memory scoped per personal agent, not per conversation: https://docs.creao.ai/developer-api/agent-memory. A fresh conversation alone therefore does not establish a clean historical cutoff. Dedicated agent identities must be tied to their permitted case/cutoff/visibility, with memory checked before reuse and never shared backward from revealed outcomes. If access cannot prove isolation, block historical provider execution rather than claim an uncontaminated replay. Do not clear or overwrite unrelated agent memory.

Account capabilities can first be checked read-only via GET /v1/agents and GET /v1/account/usage. Agent creation is itself an asynchronous operation, not a synchronous config insert: https://docs.creao.ai/developer-api/agents/create-agent. No creation, execution or entitlement has been verified yet. User added an account-format key. Node24 read-only usage and agents requests returned401 AUTHENTICATION_REQUIRED; canonical env parsing matched. No capability or execution verified. User asked to replace key, no retry loop.
