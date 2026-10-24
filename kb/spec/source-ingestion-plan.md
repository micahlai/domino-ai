# Source ingestion rollout

Decision: use a small Fetch Request/Response mock handler that accepts only an observable Snapshot plus document fixtures. A Node server loads world JSON and passes only snapshot to it; a later Convex HTTP wrapper can use the same handler. No runtime queues, pending events or answer keys may cross the handler boundary. Counterargument: the original prompt specified Hono; the native handler avoids a framework dependency and runs in both required hosts.

## Source representation and conversion

Keep distinct source-shaped envelopes, dates and amounts from E2. Serve authenticated OpenAPI and paginated records for billing customers/invoices/plans/pending settlements, CRM deals, cards, bills, accounts, payroll and documents. Explicitly label them synthetic. Recorded Stripe payouts can be derived only from observed Stripe bank transactions; pending settlements come from public pendingPayouts. Never infer private future collection dates.

The connector must follow saved FieldMapping field paths and a small deterministic conversion grammar. No eval, generated JavaScript, reference mappings or answer-key imports. Proposal: transforms are strings `canonical.path:operation`; allowed operations are identity, dollars_to_cents, unix_seconds_to_date, iso_datetime_to_date, string_to_boolean, deal_stage. Unknown operations or prose notes fail visibly. Decimal conversion parses strings exactly, rejects fractions beyond cents unless trailing zeros, checks safe range. Map source null optional values to omitted canonical fields under explicit field policy. Guard prototype-polluting paths, duplicate targets, contradictory transforms and non-owned URLs. Validate complete records and final snapshot; partial invalid ingestion must never be marked ready.

The mapping agent receives OpenAPI and bounded samples. Update its prompt to the exact grammar before wiring, while retaining FieldMapping.transforms string[] contract. Save the validated mappings and actual provider identity. User-visible source steps state failed mappings and validation counts. Existing free-text mappings are not executable until revalidated/relearned under this policy.

## Bank and deployment

Nessie uses the verified prod-api base, synthetic resources and cached per-company IDs. Opening balance plus posted transactions defines cash because the tested account.balance does not update. Retain stable transaction IDs locally and reconcile response records. Never reset or delete another project's data. Seed and re-seed must be retry-aware; uncertain POST results require reconciliation, not blind duplicate retries.

Convex development cannot reach a laptop localhost server. The shared mock Fetch handler can be exposed by a scoped Convex HTTP route with server-side MOCKS_API_KEY, company identity and world-version selection. Browser code never receives provider/mock keys. Store simulator worlds only in internal backend tables and expose only the observable Snapshot. Provider credentials go to deployment env only when the corresponding action is ready and reviewed.

## Ordering

C3 contracts and E3c consumer adoption; E1b deterministic runtime and rolling observations; E2a source handler/server and E5a mapping/pull helpers; E2b Nessie seeder; E7b internal state/version, connect/action wiring and retained generations. Agent C3/schema/grammar adoption follows E6c. Enable week controls only after an end-to-end development run succeeds. This is a plan, not completed behavior.
