# apps/mocks

Synthetic source APIs for Domino: billing (Stripe-style), CRM (HubSpot-style), cards (Ramp-style),
books (QuickBooks-style), payroll (Gusto-style) and documents. Each serves the observable Snapshot in
its own shape and units on purpose. This is a documented mock contract, not real provider
compatibility. Owner: Jayden.

- `src/handler.ts`: pure Fetch handler (`Request` in, `Response` out). No fs, env or network, so a
  later Convex HTTP route can reuse it. Accepts a Snapshot only; extra keys are stripped by parsing.
- `src/server.ts`: Node host. Loads the world JSON, validates it with `WorldStateSchema`, passes
  only `world.snapshot` to the handler.
- `src/openapi.ts`: per-source OpenAPI 3.1 (fields, units in `x-unit`, null vs omitted, paging).

## Run

```sh
MOCKS_API_KEY=<local value> pnpm --filter @domino/mocks start
curl -H "x-api-key: <local value>" http://127.0.0.1:4010/stripe/openapi.json
```

| Env | Default | Meaning |
| --- | --- | --- |
| `MOCKS_API_KEY` | none | Required. Unset or empty: every request gets 503. |
| `MOCKS_WORLD_PATH` | repo-root `data/local/world.json` | World JSON written by the seed. A set value is relative to the cwd. |
| `MOCKS_PORT` | `4010` | Port. |
| `MOCKS_HOST` | `127.0.0.1` | Bind address. Localhost only by default. |

The server re-reads the world file when its mtime or size changes, so a re-seed shows up on the next
request. An invalid file returns 503 until fixed; it never serves the stale copy.

## Routes

Every route, including `/health`, docs and OpenAPI, needs `x-api-key`. GET only.
Errors are JSON `{ "error": { "code", "message" } }`. Lists are ordered by id; limits 1 to 100,
default 10.

| Source | Routes | Paging |
| --- | --- | --- |
| stripe | `/stripe/v1/customers`, `invoices`, `payouts`, `pending_payouts`, `balance_transactions`, `billing_plans` | `limit`, `starting_after=<id>` |
| crm | `/crm/crm/v3/objects/deals` | `limit`, `after=<cursor>` |
| cards | `/cards/developer/v1/transactions` | `page_size`, `start=<cursor>` |
| books | `/books/v1/bills`, `/books/v1/accounts` | `limit`, `cursor` |
| payroll | `/payroll/v1/companies/:companyId/payrolls` | `limit`, `cursor`; next in `x-next-cursor` header |
| docs | `/docs/documents`, `/docs/documents/:id/text` | `limit`, `cursor` |

Each source also serves `/<source>/openapi.json`. `/health` returns company id and as-of date.

Recorded payouts come only from bank transactions with counterparty `Stripe`; they carry no invoice or
fee breakdown because the snapshot has none. Collected-but-not-deposited money is the separate
`pending_payouts` list.
