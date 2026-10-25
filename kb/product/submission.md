> Historical planning document. The Kestrel examples, metrics and claims below are not accepted proof or the current demo script. Use [the October 24 shared product plan](team-reset-2026-10-24.md). Do not present unmeasured values or old planned capabilities as results.

# Submission checklist

## Everyone (Devpost)
- [ ] Demo video under 3 minutes, opens with the moment (demo step 3)
- [ ] One line on the seats: "the FP&A analyst who owns the cash forecast"
- [ ] Proof: link to `kb/product/proof.md` numbers and the real/simulated table
- [ ] Repo link, README with quick start
- [ ] Select tracks: Hyphenate, Microsoft, CREAO, Convex, Capital One Nessie (+ Apify, CRS if built)

## Hyphenate
- [ ] Live demo running for real; event dialog ready for their own scenario
- [ ] See `hyphenate-checklist.md`

## Microsoft "Built for the Real World"
- [ ] Customer understanding: notes from talks with Hyphenate and a finance person (quotes)
- [ ] Measurable usefulness: proof table
- [ ] Path to production: swap each mock base URL for the real API (Stripe, Ramp, HubSpot, Gusto, bank); the mapping agent re-learns fields; read-only access
- [ ] Responsible design: propose-only agents, approvals, no auto-send, record
- [ ] Confirm whether a Microsoft product is required

## CREAO "AI-First Disruptor"
- [ ] A CREAO agent does core work: learning the company (mapSource, readConstraints)
- [x] Agent ids: mapSource `02a902ae-5e45-425b-9b1b-62882b57f4f4`, constraints `fde63788-fe39-436d-abd7-10d6f651e61a`, brief `6d6cad92-08c5-4091-b78c-a1252d8f1e5d`
- [ ] One run share link per agent in the README
- [ ] Select the CREAO track on Devpost

## Convex
- [ ] Convex is the only database; live queries drive the multiverse

## Capital One "Best Use of Nessie"
- [ ] Nessie holds Kestrel's bank account; connectors pull from it; tie-out uses it

## Add-ons (only if built)
- [ ] Apify: Actor for customer news risk signals; public pages only, no LinkedIn
- [ ] CRS: business credit data improves late-payment chance (test data only)
