# E2 · Mock servers + Stripe/Nessie seeding + `pnpm seed` (Jayden)

Tool: Claude Code. Branch: `E2-mocks-seed`. Folders: `apps/mocks`, `packages/sim/src/seed`. Depends on: E1.
Skill files (in skills/): kb-sync.

## Prompt

```
Read and follow these skill files: skills/kb-sync/SKILL.md. Read AGENTS.md and kb/spec/build-spec.md §8.

Part A: apps/mocks (Hono, TypeScript, port 4010, require header x-api-key = MOCKS_API_KEY).
Serve the simulated company's data in each real tool's own style, on purpose different from our canonical format:
- /crm (HubSpot-like): GET /crm/v3/objects/deals with properties { dealname, amount (string, dollars), dealstage ("closedwon" etc.), closedate (ISO datetime), contract_signed ("true"/"false") }, paging with "after".
- /cards (Ramp-like): GET /developer/v1/transactions -> { data: [{ id, amount (number, dollars), merchant_name, sk_category_name, user_transaction_time }], page: { next } }.
- /books (NetSuite/QuickBooks-like): GET /v1/bills -> { Bill: [{ Id, VendorRef: { name }, TotalAmt (dollars), DueDate, Balance }] } and GET /v1/accounts.
- /payroll (Gusto-like): GET /v1/companies/:id/payrolls -> [{ payroll_uuid, check_date, totals: { net_pay, employer_taxes, company_debit } (strings, dollars) }].
- /docs: static files: loan-agreement.pdf text (section 7.2 defines Unrestricted Cash, excludes lease collateral), office-lease (collateral $600,000), customer contracts, board policy (18 months runway). Serve as .txt and .pdf if easy; .txt is enough.
- Each tool serves /<tool>/openapi.json describing its endpoints (the mapping agent reads this).
The server reads data from a JSON file written by the seed script (data/local/world.json), so it can restart instantly.

Part B: packages/sim/src/seed + root "pnpm seed":
1. createCompany(SIM_COMPANY, SIM_SEED).
2. Write data/local/world.json for the mocks.
3. Stripe (test mode only; refuse unless STRIPE_SECRET_KEY starts with sk_test_): create customers and invoices
   for the named customers and a sample of others; mark paid ones paid. Keep it under 200 API calls; cache ids in
   data/local/stripe-ids.json so re-seeding is fast.
4. Nessie: create one customer + checking account for Kestrel; post deposits and payments for the history weeks
   (batch where the API allows). Confirm the base URL and endpoints from the Nessie docs; if a call shape is unclear,
   stop and ask me. Cache ids in data/local/nessie-ids.json.
5. Print a summary: counts per source and the total cash.

Add a tiny Dockerfile or start script so apps/mocks can deploy to Fly.io or Railway (public URL for CREAO).
Tests: each mock endpoint returns data that the canonical Zod schemas can parse AFTER a hand-written reference mapping
(put reference mappings in packages/sim/src/eval/trueMappings.ts and use them in the answer key).
When done: pnpm check passes, board row E2, handoff.
```

## Done when
- `pnpm seed` fills Stripe test mode, Nessie and the mocks; `curl localhost:4010/crm/openapi.json` works.
