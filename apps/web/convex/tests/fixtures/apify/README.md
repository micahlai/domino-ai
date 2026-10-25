Recorded Apify API v2 responses (real runs of apify/google-search-scraper on 2026-10-25, from the
isolated local smoke), trimmed to the fields Domino reads. Used by convex/tests/apify.test.ts and
fieldApify.test.ts; tests never touch the network.

- `run-succeeded.json`: `GET /v2/actor-runs/S9NcXY5xnQVkdUfXU` after the run settled (cost
  $0.00455: one search-page-scraped event plus actor start).
- `items-match.json`: dataset items of that run, query `"Northwind Health" (...)`.
- `items-empty.json`: dataset items of run lF0Fyo28NXCEK8kd9, query `"Acme Logistics" (...)`.
  Ten bankruptcy headlines, none about Acme Logistics: the name filter must report no signals.
