# E6a provider feasibility

Checked 2026-10-24 against official public documentation. This is a route and contract assessment, not a live integration test.

## CREAO

- The [API Trigger guide](https://docs.creao.ai/pro/api-trigger) describes two separate paths. An app-scoped `capi_` key calls `POST https://agent.creao.ai/api/v1/apps/{appId}/runs` with an `inputs` object. An account-level `cr_sk_` key calls the CREAO CLI API at `https://developer.creao.ai/v1/*`. Both use bearer authentication and consume account credits. Keys belong on the server, not in browser code or logs.
- For the CLI path, [authentication](https://docs.creao.ai/developer-api/authentication) specifies `Authorization: Bearer` with a Developer Console Account API key. [Create async run](https://docs.creao.ai/developer-api/runs/create-async-run) documents `POST /v1/runs` with `agent_id` and JSON `input` (up to 256 KB serialized), returning a pending `run_id`. [Get run status](https://docs.creao.ai/developer-api/runs/get-run-status) documents `GET /v1/runs/{run_id}` and a completed result object, commonly with `result.text`. The [quickstart](https://docs.creao.ai/developer-api/quickstart) identifies `completed`, `failed`, and `cancelled` as terminal statuses.
- A backend using polling must reach CREAO over HTTPS. If a CREAO agent fetches Domino mock APIs, those APIs must be reachable from CREAO rather than only on localhost. A webhook is optional; if used, CREAO [requires a publicly reachable HTTP or HTTPS URL](https://docs.creao.ai/pro/api-trigger). This slice does not start mocks or test outbound reachability.
- **Unconfirmed for Domino:** ownership and IDs of three runnable agents (mapping, constraints, brief); the input fields each agent expects; whether each run reliably emits JSON matching `FieldMapping[]` or `Constraint[]`, or useful nonempty brief text; account access, credits, observed latency, and live fallback behavior. `result.text` is an agent response, not a structured-output guarantee. E6b must select one API path, configure agents, extract response text, parse it, and run authenticated fixture calls before any live claim.

## Anthropic Claude

- The official [Messages API reference](https://platform.claude.com/docs/en/api/messages/create) documents `POST https://api.anthropic.com/v1/messages` with a model, `max_tokens`, and `messages`; the response has content blocks such as `{type: "text", text: "..."}`. Its current example shows an API key as `Authorization: Bearer` and an `anthropic-version` header. An E6b adapter must use the API version and authentication supported by its chosen client at implementation time.
- A backend needs outbound HTTPS access to Anthropic and a server-side credential. No credential, model entitlement, live response, output shape for Domino prompts, cost, or latency was tested here. The Messages response is not itself a `FixCandidate[]`; the adapter must extract text and pass it through this router's validation.

## E6a boundary

`createAgentRouter` accepts injected clients returning `unknown`. Offline tests exercise job selection, schema checks, bounded retries, and fallback. They do not exercise either provider API. The router does not construct prompts, perform transport, cache results, or calculate money. Explanation length uses `Intl.Segmenter` with English sentence boundaries; that is a mechanical guard, not a quality or factuality check. E6b needs live adapters and fixture-backed evaluation after credentials and dependency choices are approved by the integration owner.
