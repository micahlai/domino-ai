# Nessie API (checked 2026-10-24)

Primary source: the official OpenAPI 3.0.3 spec served by the Nessie site itself, `https://nessieisreal.com/nessie-openapi-spec.yaml` (fetched 2026-10-24, 2835 lines, no key needed). It is the file the site's interactive docs page (`https://nessieisreal.com/docs`) loads. The Getting Started page text comes from the site's own JS bundle (`https://nessieisreal.com/assets/GettingStarted-6xGdEJuW.js`).

Important: the site was rebuilt. The old host `api.reimaginebanking.com` no longer resolves in DNS (checked 2026-10-24). Old SDKs and old blog posts that use it describe the legacy API, which differs from the current spec. Legacy info below is labelled "legacy" and is NOT confirmed for the current API.

Money note for the team: our app stores integer cents. The current Nessie spec types `amount` and `balance` as plain integers and never says dollars or cents. Unit is unknown. Treat Nessie numbers as opaque integers and send cents consistently, or confirm with one test call once you have a key. Do not send decimals: the spec says integer.

## Answers

1. Signup and API key.
   - Sign in with GitHub (OAuth) on `https://nessieisreal.com` (Login button), then open `https://nessieisreal.com/profile` to copy the key. Profile also lists the customers you can access. Source: Getting Started page JS above and Profile page JS `https://nessieisreal.com/assets/Profile-Ds7eLmSw.js`. Checked 2026-10-24.
   - The key is a query parameter named `key`, on every request: `?key=YOUR_API_KEY`. Spec securityScheme: `type: apiKey, in: query, name: key`. No header auth is documented. Source: spec `components.securitySchemes.ApiKeyAuth`.
   - Each GitHub login gets its own key and its own "customer sandbox" (Getting Started step 1).
   - Enterprise endpoints (`/enterprise/...`) are read-only for everyone. All other endpoints act as a customer on data you own.

2. Base URL.
   - Spec lists: production `https://prod-api.nessieisreal.com`, QA `https://qa-api.nessieisreal.com`. The site's docs UI defaults to `https://prod-api.nessieisreal.com` (docs bundle). Use https.
   - The Getting Started page example writes `api.nessieisreal.com/customers?key=...` with no scheme. `https://api.nessieisreal.com/` answers 403 (no key sent), `http://api.nessieisreal.com` refused the connection on port 80. Whether `api.nessieisreal.com` is an alias of prod: unknown. Use `prod-api` since it is what the spec and docs UI use.
   - http is not usable on `api.nessieisreal.com` (connection refused). For `prod-api` http was not tested; use https.

3. Endpoints and bodies: see the Endpoints table. Summary for our flow:
   - Create customer: `POST /customers` with `first_name`, `last_name`, `address` (all required). Response is the string "Customer created" style per spec; the new id is probably not in the body, so list `GET /customers` afterwards to get `_id`. (Response body for customer create: see spec; not verified live.)
   - Create account: `POST /customers/{id}/accounts` with `type`, `nickname`, `rewards`, `balance` (all required). Types: `Credit Card`, `Savings`, `Checking`. Starting balance field is `balance` (integer, minimum 0). Response is a string "Account created", so list `GET /customers/{id}/accounts` to get the account `_id`.
   - Deposit: `POST /accounts/{id}/deposits` with `medium`, `transaction_date`, `status`, `amount`, `description` (all required).
   - Withdrawal: `POST /accounts/{id}/withdrawals`. The spec gives only "type: object" with no fields. Legacy SDK shape (not confirmed for current API): `medium`, `transaction_date`, `status`, `amount`, `description`.
   - Purchase: the current spec has NO create purchase endpoint and NO list-purchases-for-account endpoint. It only has `GET/PUT/DELETE /purchase/{purchase_id}`. Legacy API had `POST /accounts/{id}/purchases` with `merchant_id`, `medium`, `purchase_date`, `amount`, `status`, `description`. Whether that route still exists on prod: unknown. Plan to model payments as withdrawals unless a test proves purchases work.
   - Bill: `POST /accounts/{id}/bills` with `status` (pending, cancelled, completed, recurring), `payee`, `payment_amount` required; `nickname`, `payment_date`, `recurring_date` optional. Note `payment_amount` is a float while deposit `amount` is an integer.
   - Transfer: no create endpoint in the current spec, only `GET/PUT/DELETE /transfers/{transfer_id}`.
   - Get account (balance): `GET /accounts/{id}`, field `balance`.
   - List: deposits `GET /accounts/{id}/deposits`, withdrawals `GET /accounts/{id}/withdrawals`. Purchases per account: not in spec.
   - Delete (reset seeded data): `DELETE /accounts/{id}`, `/deposits/{id}`, `/withdrawal/{id}`, `/purchase/{id}`, `/transfers/{id}`, `/bills/{billId}`, `/loans/{id}`. There is no `DELETE /customers/{id}` and no delete for merchants in the spec. Whether deleting an account cascades to its deposits: unknown.

4. Date fields.
   - Deposit create requires `transaction_date` as a plain string. The spec gives no format, no example, no min/max, and no rule against past dates. So the field is client-supplied, which suggests back-dating is accepted, but this is NOT confirmed (no live call was made, by instruction).
   - Format: not documented in the current spec. Legacy SDK test sample uses `"2015-12-02"` (YYYY-MM-DD) for `purchase_date` (source: `https://github.com/nessieisreal/nessie-javascript-sdk/blob/master/lib/tests/purchaseTests.js`). Use `YYYY-MM-DD` and verify with one call.
   - Does posted balance change immediately, or depend on date/status? Unknown. `status` is a free string on deposits in the spec (no enum). Legacy samples use `"pending"`. The spec never says that a deposit changes `balance` at all. Our app should compute its own running balance from the transaction list and not depend on Nessie's `balance` moving.
   - Test to run once you have a key: create an account with `balance: 0`, post one deposit with a past `transaction_date` and `status: "completed"`, then `GET` the deposit and the account. Check that the date is preserved and whether `balance` moved.

5. Amount units and limits.
   - Deposit `amount`: integer. Account `balance`: integer, minimum 0. Account `rewards`: integer, minimum 0. Bill `payment_amount`: float. Dollars vs cents: unknown (not stated).
   - Other validation limits: none documented. Ids are 24-char strings (Mongo-style). Account numbers are 16 chars. `recurring_date` on bills is 1 to 31.
   - Source: spec schemas `Account`, `AccountCreate`, `Deposit`, `DepositCreate`, `Bill`.

6. Batch, rate limits, persistence, sharing.
   - Batch creation: none in the spec. Every create is one POST. 26 weeks of deposits plus payments means roughly 52 to 200 calls; script it sequentially.
   - Rate limits: none documented. Unknown.
   - Persistence: unknown. Nothing in the spec or site says data is wiped or kept.
   - Cross-key visibility: the docs say each GitHub login gets "your own API key and customer sandbox", and `GET /customers` says "all customers for the authenticated user". That points to per-key isolation, but explicit cross-key visibility is not stated, so treat as likely isolated, unconfirmed. Enterprise endpoints are read-only and read "all data in the system", so data you create may be visible to enterprise reads (Getting Started step 3).

7. Gotchas.
   - Create calls return plain strings ("Account created", "Deposit created"), not the new object, per the spec. Expect to re-list to get ids. Not verified live.
   - Legacy host `api.reimaginebanking.com` is dead; many tutorials and SDKs (Ruby, JS, Swift, Android) still point there and may use routes the new API lacks.
   - Current spec is missing purchase and transfer creation and gives no body for withdrawals.
   - Browser (CORS) support: unknown. An unauthenticated probe of `https://prod-api.nessieisreal.com/` returned 403 with `x-amzn-errortype: MissingAuthenticationTokenException` and no CORS headers, which is not conclusive. Safest: call Nessie from our server, never from the browser. That also keeps the key out of client code, since the key travels in the URL query string.
   - The key is in the query string, so it can leak into logs and URLs. Do not log full URLs.
   - Downtime: nothing published. Unknown. A keyless `GET https://prod-api.nessieisreal.com/atms` returned 502 on 2026-10-24 (the spec lists /atms as public data). Could be an outage or key enforcement; recheck with a key. Seed early and cache the ids so the demo does not depend on Nessie being up.
   - Convex: connector code runs in Convex actions, which cannot read the root `.env.local`. Set `NESSIE_API_KEY` and `NESSIE_BASE_URL` on each Convex deployment (dashboard: Settings, Environment Variables). Seeding scripts run locally and read `.env.local`. The spec lists a QA server (`https://qa-api.nessieisreal.com`); do not use it unless told.
   - Spec inconsistency: GET account, customer and deposit have `404`/`401` documented; unauthorised returns the string "unauthorized".

## Endpoints

All paths take `?key=API_KEY`. Base `https://prod-api.nessieisreal.com`. Source for every row: `https://nessieisreal.com/nessie-openapi-spec.yaml` (checked 2026-10-24) unless noted.

| Method | Path | Body fields | Source / notes |
|---|---|---|---|
| GET | /customers | none | list your customers |
| POST | /customers | first_name, last_name, address{street_number, street_name, city, state, zip} (all required) | CustomerCreate |
| GET | /customers/{id} | none | |
| PUT | /customers/{id} | first_name, last_name, address (all optional) | CustomerUpdate |
| GET | /customers/{id}/accounts | none | list accounts |
| POST | /customers/{id}/accounts | type (Credit Card, Savings, Checking), nickname, rewards (int >= 0), balance (int >= 0); all required | AccountCreate; returns string "Account created" |
| GET | /accounts | none | all your accounts |
| GET | /accounts/{id} | none | has `balance` |
| PUT | /accounts/{id} | nickname | AccountUpdate |
| DELETE | /accounts/{id} | none | reset |
| GET | /accounts/{id}/customer | none | |
| GET | /accounts/{id}/deposits | none | list |
| POST | /accounts/{id}/deposits | medium, transaction_date, status, amount (int), description; all required, all strings except amount | DepositCreate; returns "Deposit created"; `medium` allowed values undocumented (legacy sample: "balance") |
| GET | /deposits | none | all deposits |
| GET | /deposits/{id} | none | |
| PUT | /deposits/{id} | same fields, all optional | DepositUpdate; returns "Accepted deposit update" |
| DELETE | /deposits/{id} | none | reset |
| GET | /accounts/{id}/withdrawals | none | list |
| POST | /accounts/{id}/withdrawals | undocumented (spec: bare object). Legacy guess: medium, transaction_date, status, amount, description | not confirmed |
| GET/PUT/DELETE | /withdrawal/{withdrawal_id} | PUT body undocumented | note singular path |
| GET/PUT/DELETE | /purchase/{purchase_id} | PUT body undocumented | no POST, no per-account list in spec; legacy create body: merchant_id, medium, purchase_date, amount, status, description (legacy SDK, unconfirmed) |
| GET/PUT/DELETE | /transfers/{transfer_id} | PUT body undocumented | no POST in spec |
| GET | /accounts/{id}/bills, /customers/{id}/bills | none | |
| POST | /accounts/{id}/bills | status (pending/cancelled/completed/recurring), payee, payment_amount (float) required; nickname, payment_date, recurring_date optional | BillCreate |
| GET/PUT/DELETE | /bills/{billId} | | |
| GET/POST | /merchants | POST: name required; category, address, geocode optional | |
| GET/PUT | /merchants/{id} | | no delete |
| GET/POST | /accounts/{id}/loans, GET/PUT/DELETE /loans/{id} | not needed for us | |
| GET | /atms, /atms/{id}, /branches, /branches/{id} | none | public data |
| GET | /enterprise/customers, /enterprise/customers/{customer_id}, /enterprise/deposits, /enterprise/deposits/{deposit_id}, /enterprise/withdrawal/{withdrawal_id} | none | read-only analyst view |

Legacy-only references: `https://github.com/nessieisreal/nessie-javascript-sdk` (last pushed 2024-05-24, targets `http://api.reimaginebanking.com:80`).

## Unknowns

- Whether `transaction_date` accepts past dates, its exact format, and whether the server validates it. Highest priority to test.
- Whether deposits or withdrawals change the account `balance`, and whether `status` or date affects that.
- Dollars vs cents for `amount` and `balance`.
- Withdrawal create body; whether purchase and transfer create routes still exist on prod.
- Whether create responses ever return the new id.
- Rate limits, data retention or wipe schedule, exact cross-key isolation.
- CORS behavior, uptime guarantees, and whether `api.nessieisreal.com` is the same service as `prod-api.nessieisreal.com`.
- Allowed values for `medium` and `status` on deposits and withdrawals.
- Whether deleting an account removes its deposits and withdrawals.
