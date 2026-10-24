# Domino build spec

Status: v1, 2026-10-24. Owners: Jayden (engine), Micah (product).
Language: Simplified Technical English. Short sentences. One idea per line.
UI design details are in `design-spec.md`. Convex functions are in `convex-api.md`.

---

## 1. Product

### 1.1 What Domino is

Domino helps a B2B software company avoid running out of cash.
It predicts problems before they happen.
It shows what each problem causes.
It tests fixes before anyone acts.

### 1.2 The problem

Cash comes in late and leaves on time.
One late customer payment can cause a chain of problems:

1. Usable cash drops.
2. Cash falls below the lender's minimum.
3. The company must pause hiring or pay a bill late.

This chain is the domino effect. Today an FP&A analyst finds it by hand in a spreadsheet, often too late.

### 1.3 What Domino does

| Step | What happens | Who does it |
| --- | --- | --- |
| Learn | Connects to the company's tools, maps their data, learns how each customer pays | CREAO agents + code checks |
| Predict | Forecasts usable cash for 13 weeks. Finds risky events the normal forecast ignores. | Engine (code) |
| Simulate | Makes a branch of the timeline for each risk. Shows which dominoes fall. | Engine (code) |
| Fix | Suggests fixes. Simulates each fix as a branch under the risk. | Claude proposes, engine scores |
| Approve | A person approves a fix. Domino records who, when and why. | Person |
| Improve | Each week, grades its forecast against the bank and learns. | Engine (code) |

### 1.4 Who uses it

- **Seat:** the FP&A analyst who owns the cash forecast.
- **Approver:** the controller. Large actions also need the CFO.
- **Demo company:** Kestrel Data, a simulated B2B software company (section 7).

### 1.5 Rules that never change

1. Domino suggests. A person approves.
2. Domino never moves money and never sends a message by itself.
3. Code calculates every number. AI never calculates money.
4. Every number, rule and suggestion links to its proof.

---

## 2. The branching timeline (core concept)

All branches show on one cash chart as separate lines.

| Branch kind | Meaning | Parent | Line color |
| --- | --- | --- | --- |
| `base` | The normal forecast. Everything happens as planned. | none | Grey |
| `event` | The base plus one risky event (for example "Acme pays 45 days late"). Has a probability. | base | Red |
| `fix` | An event branch plus one fix (for example "Offer Acme 2% to pay now"). | event | Green |

- A branch stores only its `changes` relative to its parent. The engine applies the changes of all ancestors, in order.
- The red dashed line is the lender's minimum (a `min_cash` constraint).
- The selected branch is drawn thicker. Other branches are lighter.
- Each branch has its own domino chain and status (`draft`, `proposed`, `approved`, `rejected`).

### 2.1 The multiverse timeline (the hero visual and our "wow")

One wide timeline. Past on the left, future on the right.

| Part | What it shows | Data |
| --- | --- | --- |
| Past | Real usable cash, week by week, for 26 weeks. Markers for real events ("Acme paid 24 days late"). | `engine.history`, `engine.pastEvents` |
| Today | A vertical line. Every future starts here. | `snapshot.asOf` |
| Futures | Many thin lines fan out from today: one per universe (each risk alone, pairs of top risks, the worst case). Good futures go up, bad ones go down. | `engine.stressTest` |
| Outcome markers | Each universe line ends with a check (survives) or a cross at the week it breaks a rule. | `Universe.survives`, `breaksAt` |
| Lender's limit | Red dashed line across the future side. | `constraints` |
| Resilience score | Big number: "Survives 7 of 11 futures (64%)". | `ResilienceReport` |
| Apply fixes | Toggle. Broken lines bend up and turn green. Score animates: 64% to 93%. | `stressTest` with fixes |
| Breaking points | Plain sentences: "Kestrel breaks if Acme pays 38 or more days late." | `breakingPoints` |

The question the screen answers: **"Is our company resistant to what might happen, and what makes it more resistant?"**

The branch tree, domino chain and fix cards (section 3) are the detail view. A user clicks any future line to open it as a branch.

---

## 3. User flow (also the demo flow)

1. **Connect.** User clicks "Connect company". The connect screen shows each data source being found, learned and checked against the bank.
2. **The multiverse.** The timeline draws the past, then fans out every predicted future from today. Headline: "Kestrel survives 7 of 11 possible futures."
3. **Risks.** The broken futures are the risks. The branch tree lists them, ranked by chance times impact.
4. **Open a risk.** The event branch appears on the chart. The domino chain shows what falls and when.
5. **Try fixes.** Fix cards appear. "Simulate" adds a fix branch. The user compares lines.
6. **Apply fixes to every future.** The "Apply fixes" toggle reruns the multiverse. Broken lines bend up and turn green. "Survives 9 of 11 futures."
7. **Approve.** "Approve" sends the fix to the approval record. Nothing is sent outside.
8. **Add an event.** The user (or a judge) picks an event. Domino adds it as a new future and suggests fixes.
9. **Next week.** New data arrives. Domino grades last week's forecast, learns, and updates every branch.

---

## 4. Architecture

Seven modules. Each has one owner. Modules talk only through `packages/contracts`.

| Module | Folder | Owner | Job |
| --- | --- | --- | --- |
| Contracts | `packages/contracts` | Both | Types, Zod schemas, fixtures |
| Simulator | `packages/sim` | Jayden | Generates companies, events, planted errors, answer key |
| Data tools | `apps/mocks` (Stripe, CRM, Ramp, books, payroll, docs) + Nessie | Jayden | Serve simulated data in each tool's real format |
| Connectors | `apps/web/convex/connectors/` | Jayden | Pull from tools, map to canonical records, tie out to bank |
| Engine | `packages/engine` | Jayden | Forecast, dominoes, risk scan, fix scoring, grading, learning |
| Agents | `packages/agents` | Jayden (explain wording: Micah) | CREAO and Claude behind one interface |
| Convex | `apps/web/convex/` | Micah | Schema, queries, mutations, scheduled jobs |
| Web UI | `apps/web` | Micah | Every screen |

Data flow:

1. `sim` creates Kestrel and writes its records to the mock servers and to Nessie (`pnpm seed`).
2. Connectors pull from the tools, use the learned field mappings, and save a `Snapshot` in Convex.
3. A Convex action runs the engine on the snapshot. It writes branches, risks and dominoes.
4. Convex actions call agents for fix proposals and explanations. The engine scores every fix.
5. The UI reads Convex with live queries. Every change appears at once.

---

## 5. Contracts

The source of truth is code: `packages/contracts/src/`.

| File | Holds |
| --- | --- |
| `core.ts` | `Cents`, `ISODate`, `Evidence`, canonical records, `Snapshot`, `Constraint`, `CompanyModel` |
| `branches.ts` | `Change`, `Forecast`, `Domino`, `Branch`, `RiskEvent`, `FixCandidate` |
| `sim.ts` | `WorldState`, `AnswerKey`, `PlantedError`, `FieldMapping` |
| `modules.ts` | `Simulator`, `Connector`, `Engine`, `Agents` interfaces |
| `fixtures/index.ts` | Kestrel fixtures that pass every schema. The UI uses these first. |

Rules:

- Every type has a Zod schema. Parse every outside input.
- Money: integer cents. Dates: `YYYY-MM-DD`. Weeks start on Monday.
- To change a contract, use `skills/contract-change/SKILL.md`.

---

## 6. Engine (packages/engine)

Pure TypeScript. No network, no AI, no clock, no randomness. Same input, same output.

### 6.1 `forecast(snapshot, model, changes)`

1. Make 13 weeks, starting the Monday after `snapshot.asOf`.
2. Apply `changes` to a copy of the snapshot (see 6.6).
3. **Cash in**, per open invoice: expected pay date = `due + model.customerDelayDays[customerId].mean` (round to whole days). Put the amount in the week that holds that date.
4. **Cash in**, per signed `won` deal that is not invoiced yet: expected cash = `expectedClose + paymentTermsDays + mean delay`.
5. Unsigned `won` deals add **no** cash. (This is a planted-error pattern.)
6. **Cash out:** payroll runs on their dates; unpaid bills on their due dates; each `recurringSpend` item every `everyDays`.
7. For each week: `closing = opening + inflow - outflow`; `usable = closing - snapshot.restrictedCash`.
8. `lowPoint` = the week with the smallest `usable`.

### 6.2 `dominoes(forecast, constraints, snapshot)`

Walk the weeks in order. Add a domino when a rule breaks, then add what it causes.

| Trigger | Domino label | Causes next |
| --- | --- | --- |
| A delayed or lost invoice in the branch changes | "<Customer> pays <amount> <n> days late" | Cash drop |
| Usable cash drops by more than 5% in one week | "Usable cash drops to <amount>" | Rule checks below |
| `usable < min_cash.limit` | "Usable cash falls below the lender's <amount> minimum" | "Hiring plan must pause" |
| Not enough usable cash for a critical bill on its due date | "<Vendor> bill is paid late" | The consequence from that vendor's contract evidence |
| Runway (usable / average monthly net burn) below `min_runway_months` | "Runway drops below <n> months" | "Board must approve a new plan" |

Each domino has `order`, `weekStart`, `causedBy` and `evidence`.

### 6.3 `scanRisks(snapshot, model, constraints)`

Find events the base forecast ignores. Score each one.

| Risk type | Chance from | Change |
| --- | --- | --- |
| Late payment | Share of the customer's past invoices paid more than 14 days late (min 3 samples, else 0.1) | `delay_invoice` by the customer's p90 delay |
| Non-renewal | 0.25 base; 0.5 if the renewal deal is `won` but `signed=false`; 0.6 if usage fell (Orbit only) | `lose_invoice` |
| Spend spike | Card or cloud spend growing faster than 20% over 4 weeks | `remove_cash` of the extra amount |
| Customer failure | Only from the Apify add-on news signal | `lose_invoice` for all open invoices |

- `impactLowPoint` = base low point minus low point with the change. Positive = worse.
- Rank by `probability * impactLowPoint`. Return the top 5.

### 6.4 `scoreFix(parent, fix, snapshot, model, constraints)`

1. Build a new branch: `kind: "fix"`, `parentId: parent.id`, `changes: fix.changes`.
2. Forecast with all ancestor changes plus the fix changes.
3. Compute dominoes.
4. A fix is **useful** only if it raises the low point. Drop fixes that do not.
5. Rank useful fixes: first by "removes every broken rule", then by low-point gain, then by lower risk.

### 6.5 `grade(previous, actualBank)` and `learn(snapshot, model, history)`

- **Error metric:** for each past week, `abs(forecast closing - actual closing) / actual closing`. Report the mean, in percent.
- **Misses:** each week with error over 3%. For each miss, find the record that caused it (for example "Acme paid 12 days later than forecast").
- **Learning:**
  1. Update each customer's delay `mean` and `p90` from their paid invoices.
  2. Update recurring spend from card transactions (same merchant, regular gaps).
  3. Propose a rule for each repeated miss.
  4. Re-run the forecasts for past weeks with the new model.
  5. Keep the change only if the mean error goes down. Store `errorBefore` and `errorAfter`.
  6. Increase `model.version`.

### 6.6 `history`, `pastEvents` and `stressTest` (multiverse)

- `history(snapshot, weeks)`: rebuild weekly closing and usable cash backward from `cashOnHand` and `bankTxns`.
- `pastEvents(snapshot, model)`: invoices paid more than 14 days late, churned customers, won deals over $50K, card spend spikes, payroll steps up. Each with evidence.
- `stressTest(snapshot, model, constraints, risks, fixes)`:
  1. Universes = base, each risk alone, each pair of the top 4 risks, and all bad risks together.
  2. For each universe: forecast with the risks' changes (and the fixes, when given). A fix applies only in universes where its target exists.
  3. `survives` = no `min_cash` or `pay_by_date` rule breaks in 13 weeks.
  4. `probability` = product of the chances of its risks. `survivalRate` = probability-weighted share that survive.
  5. Breaking points: for the top late-payment risk, binary search the smallest delay (days) that breaks a rule. For renewals, the smallest total lost amount.
- Keep it under 200 ms for Kestrel so the toggle feels instant. Universes are independent, so this is easy.

### 6.7 How changes apply

| Change | Effect on the snapshot copy |
| --- | --- |
| `delay_invoice` | Add `days` to the invoice's expected pay date |
| `lose_invoice` | Remove the invoice from cash in |
| `churn` | Remove the customer's invoices and won deals with dates on or after `fromDate` |
| `add_cash` / `remove_cash` | Add a one-time cash item on `date` |
| `delay_bill` | Add `days` to the bill's due date. Not allowed on `critical` bills. |
| `discount_early_pay` | Invoice is paid on `payOn` at `amount * (100 - percent) / 100`, rounded to whole cents |
| `shift_hire` | Remove `monthlyCost` prorated by day from `fromDate` until `toDate` |

---

## 7. Simulator (packages/sim)

### 7.1 Kestrel Data (main company)

| Parameter | Value | Basis |
| --- | --- | --- |
| Annual recurring revenue | $24M | Scaled from public B2B software peers |
| Customers | about 300; 4 named large customers in fixtures | |
| Billing | 80% annual up front, 20% monthly | Peer disclosures |
| Payment terms | Net 30; large customers Net 60 | |
| Payment delay | Most customers 0 to 10 days; 2 chronic late payers (21+ days) | |
| Renewals | Cluster at quarter ends | Peer seasonality |
| Headcount | 120; payroll every two weeks, about $600K a run | |
| Cloud | Quarterly payment, about $210K | |
| Card spend | About $38K a month on software | |
| Cash on hand | $4.5M, of which $600K is lease collateral (restricted) | |
| Loan rule | Usable cash at least $3M at all times | Loan agreement section 7.2 |
| Board rule | At least 18 months of runway | Board policy |

Calibrate ratios from 5 public B2B software companies (SEC EDGAR): Amplitude, PagerDuty, Sprout Social, Freshworks, Box. Record the companies and ratios in `kb/research/public-companies.md`.

### 7.2 Test companies (held out)

- **Tally:** small, fast-growing, monthly billing, burns cash.
- **Orbit:** usage-based billing, uneven cloud costs.

Do not tune the engine on Tally or Orbit. Use them only for the final proof numbers.

### 7.3 Events the simulator can plant

Late payment, non-renewal, customer bankruptcy, early big deal, cloud usage spike, faster hiring, lower credit line.

### 7.4 Planted errors (answer key)

Duplicate vendor bill. Vendor bank details changed one day before a large payment. Restricted cash counted as usable. Payment applied to the wrong invoice. Card charge with no receipt. Renewal marked won in the CRM with no signed contract.

### 7.5 Functions

- `createCompany(profile, seed)` gives 26 weeks of history plus pending events.
- `advanceWeek(world, injected)` moves one week ahead and applies pending and injected events.
- `answerKey(world)` is only for `packages/sim/src/eval/`.
- CLI: `pnpm sim:print` prints the forecast and dominoes as a table. `pnpm seed` writes data to all tools and Convex.

---

## 8. Data tools and connectors

### 8.1 Sources

| Source | Plays | Built with | Messy part on purpose |
| --- | --- | --- | --- |
| Billing | Stripe | `apps/mocks` `/stripe` (copies Stripe's API shape) | Payouts net of fees, several payments per payout |
| Bank | Business bank | Capital One Nessie | Deposits land 1 to 3 days after the Stripe payout |
| Sales pipeline | HubSpot-like CRM | `apps/mocks` `/crm` | Amounts as strings in dollars; "closedwon" before contract signed |
| Cards | Ramp-like | `apps/mocks` `/cards` | Merchant names differ from vendor names |
| Books | NetSuite/QuickBooks-like | `apps/mocks` `/books` | Some entries late or in the wrong account |
| Payroll | Gusto-like | `apps/mocks` `/payroll` | Quarterly bonus runs |
| Documents | PDFs | `apps/mocks` `/docs` (static files) | Loan defines cash differently from the books |

Each mock endpoint has its own field names and units, so the mapping agent has real work to do. Each one serves an `/openapi.json`.

**Why mocks.** Every tool except the bank is our own mock server that copies the real tool's API shape (field names, units, paging). Nessie is Capital One's hackathon bank API.

- No accounts or keys needed. Same data on every run.
- We control the messy parts and keep a perfect answer key.
- Path to production: point a connector at the real API's base URL. The mapping agent learns the real field names the same way.

### 8.2 Connectors

1. The `mapSource` agent reads the source's `/openapi.json` and 5 sample records. It returns `FieldMapping[]`.
2. Code applies the mapping and parses the result with Zod.
3. **Tie-out check:** total Stripe payouts in the last 4 weeks must match bank deposits from Stripe within 1%. If not, the source is marked `needs review` and a person is asked.
4. Mappings are saved in the `sources` table, so the agent runs once per source.

---

## 9. Agents (packages/agents)

### 9.1 Jobs and backends

| Job | Default backend | Input | Output |
| --- | --- | --- | --- |
| `mapSource` | CREAO | API docs + samples | `FieldMapping[]` |
| `readConstraints` | CREAO | Document text | `Constraint[]` |
| `weeklyBrief` | CREAO | Grade + model | Plain-English text |
| `proposeFixes` | Claude | Branch + snapshot | `FixCandidate[]` |
| `explain` | Claude | Branch | Max 3 sentences |

- `AGENT_BACKEND_<JOB>` picks the backend. Both versions implement the same `Agents` interface.
- Every output is parsed with Zod. On failure: retry once, then use Claude.
- Cache results by input hash in Convex, so the demo replays fast.

### 9.2 Prompt rules

- Give the agent the contract types as JSON schema. Ask for JSON only.
- Give the evidence it may cite. It must cite a record id or a document quote for every claim.
- Never give money math to the agent. It proposes `Change` objects; the engine computes the effect.
- `explain`: plain words, no finance jargon, max 3 sentences, name the week and the amount.

### 9.3 CREAO

- One CREAO agent per job: mapping, constraints, weekly brief.
- Put each agent id and one run share link in `kb/product/submission.md` and the README.
- Mock servers must have a public URL so CREAO agents can call them.

---

## 10. Proof (how we show it works)

See `kb/product/proof.md` for live numbers.

| Measure | How | Compared with |
| --- | --- | --- |
| Mapping accuracy | Share of fields mapped correctly | Answer key |
| Forecast accuracy | Mean error at 1 and 4 weeks ahead | Baseline that assumes everyone pays on time |
| Self-improvement | Mean error week by week over 8 weeks | Domino in week 1 |
| Early warning | Planted events found, weeks of warning, false alarms | Answer key |
| Data errors | Planted errors found and missed | Answer key |
| Ease of use | 3 strangers try to find and fix the worst risk in 2 minutes | Number who succeed |

---

## 11. Plan and gates

Deadline assumed Sunday 9 AM. Prompts are in `prompts/`.

| Phase | Jayden (engine) | Micah (product) | Gate |
| --- | --- | --- | --- |
| Fri night: setup | S0, then E1 and E3 in parallel, E6 started | S0, P1, P2, Figma sketch | Both run `pnpm dev`; playground shows fixture multiverse |
| Sat 8 AM to 12 PM | E1, E2, E3, E4 | P3 (hero timeline), P4 | Multiverse shows real engine output for Kestrel |
| Sat 12 PM to 6 PM | E5, E6, E7 | P5, P6 | Full demo flow works end to end |
| Sat 6 PM to 12 AM | E8 | P7 (user test, Figma) | Every proof number is real |
| Sun 12 AM to 6 AM | Add-ons only if gate passed | P8 (video, submission) | Code freeze 6 AM |

If a gate is missed, cut scope. Do not move the gate.
