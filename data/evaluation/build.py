"""Build origin slices, labels and the safe manifest from fetched SEC packages.

Usage: python3 -I data/evaluation/build.py
Reads raw packages offline (no network). Test slices/labels go to sealed/ (git-ignored);
development ones to development/. Prints counts and reason categories only, never amounts.
Each sealed read is appended to read-ledger.jsonl.
"""
import hashlib, json, os, pathlib, secrets
from datetime import date, datetime, timezone

HERE = pathlib.Path(__file__).resolve().parent
PROTOCOL = HERE.parent.parent / "kb/spec/forecast-evaluation-protocol-v1.md"
CASH = "CashAndCashEquivalentsAtCarryingValue"
COMBINED = "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"
OCF = "NetCashProvidedByUsedInOperatingActivities"
ICF = "NetCashProvidedByUsedInInvestingActivities"
ORIGINAL_FORMS = ("10-Q", "10-K")


def quarters(first, last):
    y, q = first
    while (y, q) <= last:
        yield y, q
        y, q = (y + 1, 1) if q == 4 else (y, q + 1)


COMPANIES = {  # name: (role per target, cik); cohort fixed by protocol v1 before outcome inspection
    "tenable": ("0001660280", {t: "test" for t in quarters((2024, 1), (2025, 4))}),
    "varonis": ("0001361113", {t: "test" for t in quarters((2024, 1), (2025, 4))}),
    "amplitude": ("0001866692", {**{t: "development" for t in quarters((2021, 1), (2022, 4))},
                                 **{t: "validation" for t in quarters((2023, 1), (2023, 4))}}),
}


def qend(y, q):
    return date(y, q * 3, 31 if q in (1, 4) else 30).isoformat()


def prev(y, q):
    return (y - 1, 4) if q == 1 else (y, q - 1)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dump(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, sort_keys=True, separators=(",", ":")))
    return sha(path)


def log_read(path, purpose):
    if "sealed" in path.parts:
        with (HERE / "read-ledger.jsonl").open("a") as f:
            f.write(json.dumps({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                "reader": os.environ.get("CUSTODY_READER", "E0 custodian (Claude Opus 5.5 worker)"),
                                "file": str(path.relative_to(HERE)), "purpose": purpose}) + "\n")


def load(path, purpose):
    log_read(path, purpose)
    # parse_int/parse_float=str keeps SEC's decimal lexemes exactly
    return json.loads(path.read_bytes(), parse_int=str, parse_float=str)


def build_company(name, cik, targets):
    base = HERE / ("sealed" if "test" in targets.values() else "development")
    subs = load(base / f"raw/{name}-submissions.json", "filing acceptance metadata for origin/label selection")
    facts = load(base / f"raw/{name}-companyfacts.json", "build origin slices, labels and coverage reasons")
    r = subs["filings"]["recent"]
    filings = [dict(form=f, report=rd, accepted=a or None, accn=n)
               for f, rd, a, n in zip(r["form"], r["reportDate"], r["acceptanceDateTime"], r["accessionNumber"])]
    accepted = {f["accn"]: f["accepted"] for f in filings}
    rows, non_usd = [], 0
    for concept, body in facts.get("facts", {}).get("us-gaap", {}).items():
        for unit, items in body["units"].items():
            if unit != "USD":
                non_usd += len(items) if concept in (CASH, COMBINED, OCF, ICF) else 0
                continue
            for it in items:
                rows.append({"concept": concept, **{k: it.get(k) for k in ("start", "end", "val", "accn", "form", "fy", "fp", "filed")},
                             "acceptedAt": accepted.get(it["accn"])})

    def first_original(period_end):
        c = [f for f in filings if f["form"] in ORIGINAL_FORMS and f["report"] == period_end]
        return min(c, key=lambda f: f["accepted"] or "9") if c else None

    def pick(visible, concept, end, start=None, accn=None):
        """Earliest-accepted original row; None if missing, 'conflict' if one accession disagrees with itself."""
        c = [x for x in visible if x["concept"] == concept and x["end"] == end and x.get("start") == start
             and (accn is None or x["accn"] == accn)]
        if not c:
            return None
        first = min(c, key=lambda x: x["acceptedAt"])
        return "conflict" if len({x["val"] for x in c if x["accn"] == first["accn"]}) > 1 else first

    pairs, labels = [], []
    for (y, q), role in targets.items():
        o_end, t_end = qend(*prev(y, q)), qend(y, q)
        t_start = (date(y, q * 3 - 2, 1)).isoformat()
        reasons, origin, slice_sha = [], first_original(o_end), None
        if not origin:
            reasons.append("origin_filing_missing")
        elif not origin["accepted"]:
            reasons.append("origin_acceptance_missing")
        elif not (t_start <= origin["accepted"][:10] <= t_end):
            reasons.append("origin_outside_target_quarter")
        if origin and origin["accepted"]:
            visible = [x for x in rows if x["acceptedAt"] and x["acceptedAt"] <= origin["accepted"]]
            oy, oq = prev(y, q)
            ytd_start = f"{oy}-01-01"
            needs = [(CASH, o_end, None, "origin_cash"), (COMBINED, o_end, None, "origin_combined_cash"),
                     (OCF, o_end, ytd_start, "ytd_ocf"), (ICF, o_end, ytd_start, "ytd_icf")]
            if oq > 1:  # candidate single-quarter flows need the compatible preceding YTD
                p_end = qend(oy, oq - 1)
                needs += [(OCF, p_end, ytd_start, "predecessor_ytd_ocf"), (ICF, p_end, ytd_start, "predecessor_ytd_icf")]
            for concept, end, start, role_name in needs:
                got = pick(visible, concept, end, start)
                if got is None:
                    reasons.append(f"{role_name}_missing")
                elif got == "conflict":
                    reasons.append(f"{role_name}_same_accession_conflict")
            slice_sha = dump(base / f"slices/{name}-{y}Q{q}.json",
                             {"company": name, "target": f"{y}Q{q}", "originAccession": origin["accn"],
                              "originAcceptedAt": origin["accepted"], "rows": sorted(visible, key=json.dumps)})
        target = first_original(t_end)
        label = None
        if not target:
            reasons.append("target_filing_missing")
        elif not target["accepted"]:
            reasons.append("target_acceptance_missing")
        else:
            label = pick([x for x in rows if x["acceptedAt"]], CASH, t_end, None, target["accn"])
            if label in (None, "conflict"):
                reasons.append("target_label_missing" if label is None else "target_label_conflict")
                label = None
        if label:
            comb = pick([x for x in rows if x["acceptedAt"]], COMBINED, t_end, None, target["accn"])
            labels.append({"company": name, "target": f"{y}Q{q}", "accn": label["accn"], "cashUsd": label["val"],
                           "combinedUsd": comb["val"] if isinstance(comb, dict) else None})
        pairs.append({"company": name, "role": role, "target": f"{y}Q{q}", "targetQuarterEnd": t_end,
                      "originPeriodEnd": o_end, "originAccession": origin and origin["accn"],
                      "originForm": origin and origin["form"], "originAcceptedAt": origin and origin["accepted"],
                      "targetAccession": target and target["accn"], "targetAcceptedAtPresent": bool(target and target["accepted"]),
                      "originSliceSha256": slice_sha, "eligible": not reasons, "missing": sorted(set(reasons))})
    ident = {"name": subs["name"], "cik": cik, "tickers": subs["tickers"], "fiscalYearEnd": subs["fiscalYearEnd"],
             "nonUsdRequiredRows": non_usd, "rowsWithoutAcceptance": sum(1 for x in rows if not x["acceptedAt"])}
    return ident, pairs, labels, base


def main():
    manifest = {"protocol": {"path": "kb/spec/forecast-evaluation-protocol-v1.md", "sha256": sha(PROTOCOL)},
                "method": "earliest-accepted original 10-Q/10-K per period; visibility = acceptanceDateTime <= origin; USD us-gaap only",
                "companies": {}, "pairs": [], "raw": {}, "labels": {}}
    sealed_labels = []
    for name, (cik, targets) in COMPANIES.items():
        ident, pairs, labels, base = build_company(name, cik, targets)
        manifest["companies"][name] = ident
        manifest["pairs"] += pairs
        for p in sorted((base / "raw").glob(f"{name}-*.json")):
            manifest["raw"][str(p.relative_to(HERE))] = sha(p)
        if base.name == "sealed":
            sealed_labels += labels
        else:
            manifest["labels"]["development/labels.json"] = dump(base / "labels.json", labels)
    # random salt so the file hash cannot be brute-forced from guessed amounts; kept stable across rebuilds
    lp = HERE / "sealed/labels.json"
    salt = load(lp, "reuse label salt")["salt"] if lp.exists() else secrets.token_hex(32)
    manifest["labels"]["sealed/labels.json"] = dump(lp, {"salt": salt, "labels": sealed_labels})
    test = [p for p in manifest["pairs"] if p["role"] == "test"]
    manifest["summary"] = {"testPlanned": len(test), "testEligible": sum(p["eligible"] for p in test),
                           "testMissing": sorted({m for p in test for m in p["missing"]})}
    out = HERE / "manifest.json"
    out.write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n")
    for role in ("test", "development", "validation"):
        ps = [p for p in manifest["pairs"] if p["role"] == role]
        print(role, "planned", len(ps), "eligible", sum(p["eligible"] for p in ps),
              "missing", sorted({m for p in ps for m in p["missing"]}))
    print("manifest sha256", sha(out))


if __name__ == "__main__":
    main()
