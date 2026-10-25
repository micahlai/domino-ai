# Field live demo

Runs /field (worker page) and /field/map (brain map) on the real field.* backend, on an
isolated local Convex. Synthetic mock sources only; nothing moves money.

Never use ports 3102, 3210 or 3214 (other running apps).

## Start (two terminals, from apps/web)

```sh
source ~/.nvm/nvm.sh && nvm use 24

# 1. Isolated local Convex. Writes apps/web/.env.local (gitignored) pointing Next at it.
CONVEX_AGENT_MODE=anonymous npx convex dev --local-cloud-port 3260 --local-site-port 3261

# Optional: real Apify searches for counterparty news (capped at 3 runs per ingest and 20 per
# day, cached 24 h). Without it the research agent logs "Apify not configured" and skips.
# npx convex env set APIFY_TOKEN <token>

# 2. Create the live feed (six mock sources, first ingest queued). Run again for a fresh
#    company: the pages follow the newest feed.
npx convex run field:setup '{}'

# 3. Next dev on a free port, reading NEXT_PUBLIC_CONVEX_URL from .env.local.
npx next dev --hostname 127.0.0.1 --port 3114
```

Open http://127.0.0.1:3114/field. The header badge must say "Live". "Demo data" appears
only when NEXT_PUBLIC_CONVEX_URL is empty.

## Click path

1. Pick "Card spike" in the "With" menu, press **New entries arrive** (field.advanceFeed
   with `anomaly: "unusual_amount"`).
2. Press **Ingest now** (field.ingestNow). A high "Unusual amount" flag appears in the review
   queue; the activity list shows reads, mapping, the saved version and the audit.
3. Open **Brain map**, plant "Duplicate bill", press New entries arrive, then Ingest now.
   Dots run source -> Ingestion agent -> tool and Ingestion agent -> Audit agent.
4. Back on **Worker**, type a note on the card spike flag and press **Approve**
   (field.decide). It moves to "decided flags" with the note.
5. **Export seed for simulation** (field.exportSeed). The dialog shows
   "Checked: valid weekly seed, fingerprint ..." from lib/feature-boundary/verify.ts.
6. Optional: the **Auto ingest** switch (field.setAutoIngest) runs an ingest every 45 s,
   at most 120 runs. Turn it off after the demo.

Each anomaly can be planted once per mock week; a second plant in the same week shows an error.
Advance the week (New entries arrive with no anomaly) and try again.

## Stop

Ctrl-C both terminals, then confirm nothing listens on 3114/3260/3261:
`lsof -iTCP:3114 -iTCP:3260 -iTCP:3261 -sTCP:LISTEN`.
