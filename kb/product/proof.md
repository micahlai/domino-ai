> Historical planning document. The Kestrel examples, metrics and claims below are not accepted proof or the current demo script. Use [the October 24 shared product plan](team-reset-2026-10-24.md). Do not present unmeasured values or old planned capabilities as results.

# Proof it works

Fill this table with real numbers on Saturday evening (prompt E8). Never invent numbers.

## Results

| Measure | Kestrel (tuned) | Tally (held out) | Orbit (held out) | Baseline |
| --- | --- | --- | --- | --- |
| Fields mapped correctly | TBD | TBD | TBD | n/a |
| Stripe-to-bank tie-out | TBD | TBD | TBD | n/a |
| Forecast error, 1 week ahead | TBD | TBD | TBD | TBD (everyone pays on time) |
| Forecast error, 4 weeks ahead | TBD | TBD | TBD | TBD |
| Error week 1 → week 8 (learning) | TBD | TBD | TBD | n/a |
| Planted events found / total | TBD | TBD | TBD | n/a |
| Weeks of early warning (median) | TBD | TBD | TBD | n/a |
| Planted errors found / total | TBD | TBD | TBD | n/a |
| False alarms | TBD | TBD | TBD | n/a |
| Strangers who fixed the worst risk in 2 min | TBD of 3 | | | |

## Real vs simulated

| Part | Status |
| --- | --- |
| Companies, events, contracts | Simulated, based on public filings (see `kb/research/public-companies.md`) |
| Billing, CRM, cards, books, payroll | Our mock servers that copy each real tool's API shape (Stripe, HubSpot, Ramp, NetSuite/QuickBooks, Gusto) |
| Bank | Capital One Nessie hackathon API |
| Controller, customers, vendors | Played by people in the demo, or by models |
| Forecast, dominoes, multiverse, learning | Real code with tests |

## How we kept it honest

- We tuned only on Kestrel. Tally and Orbit stayed hidden until the final run.
- The engine and agents cannot read the answer key; a test enforces this.
