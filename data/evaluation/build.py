"""Build origin slices, labels and the safe manifest from fetched SEC packages.

Usage: python3 -I data/evaluation/build.py
Reads raw packages offline (no network). Test slices/labels go to sealed/, the Freshworks
acceptance package to withheld/ (both git-ignored); development ones to development/.
Prints counts and reason categories only, never amounts.
Every read of sealed/ or withheld/ bytes is appended to read-ledger.jsonl.
Model workers must not run this: it reads sealed/.
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
CUSTODY_DIRS = ("sealed", "withheld")


def quarters(first, last):
    y, q = first
    while (y, q) <= last:
        yield y, q
        y, q = (y + 1, 1) if q == 4 else (y, q + 1)


COMPANIES = {  # name: (cik, package dir, role per target); fixed by protocol v1 before outcome inspection
    "tenable": ("0001660280", "sealed", {t: "test" for t in quarters((2024, 1), (2025, 4))}),
    "varonis": ("0001361113", "sealed", {t: "test" for t in quarters((2024, 1), (2025, 4))}),
    "amplitude": ("0001866692", "development", {**{t: "development" for t in quarters((2021, 1), (2022, 4))},
                                                **{t: "validation" for t in quarters((2023, 1), (2023, 4))}}),
    # exposed company; withheld from mapping development until the normalizer/dictionary commit freezes
    "freshworks": ("0001544522", "withheld", {(2023, 3): "mapping-acceptance"}),
}


def qend(y, q):
    return date(y, q * 3, 31 if q in (1, 4) else 30).isoformat()


def prev(y, q):
    return (y - 1, 4) if q == 1 else (y, q - 1)


def inside_quarter(accepted, y, q):
    """Strictly inside: boundary days are excluded because SEC's acceptance timezone label is unverified."""
    return date(y, q * 3 - 2, 1).isoformat() < accepted[:10] < qend(y, q)


def first_original(filings, period_end):
    """First original 10-Q/10-K for the period by filing chronology (filed date, then accession number).
    Acceptance time plays no part, so an unverified first filing is never skipped for a later one."""
    c = [f for f in filings if f["form"] in ORIGINAL_FORMS and f["report"] == period_end]
    return min(c, key=lambda f: (f["filed"], f["accn"])) if c else None


def pinned(rows, concept, end, start, accn):
    """The row from exactly this accession; None if absent, 'conflict' if it disagrees with itself.
    Never substitutes a later comparative or amendment row."""
    vals = {x["val"] for x in rows if x["concept"] == concept and x["end"] == end
            and x.get("start") == start and x["accn"] == accn}
    return None if not vals else "conflict" if len(vals) > 1 else vals.pop()


def origin_reasons(filings, rows, y, q):
    """Eligibility reasons for one target's origin inputs (empty list = eligible inputs)."""
    oy, oq = prev(y, q)
    o_end, ytd = qend(oy, oq), f"{oy}-01-01"
    origin = first_original(filings, o_end)
    if not origin:
        return origin, ["origin_filing_missing"]
    if not origin["accepted"]:
        return origin, ["origin_acceptance_missing"]
    reasons = [] if inside_quarter(origin["accepted"], y, q) else ["origin_outside_target_quarter"]
    needs = [(CASH, o_end, None, origin, "origin_cash"), (COMBINED, o_end, None, origin, "origin_combined_cash"),
             (OCF, o_end, ytd, origin, "ytd_ocf"), (ICF, o_end, ytd, origin, "ytd_icf")]
    if oq > 1:  # candidate single-quarter flows need the compatible preceding YTD from its own original filing
        p_end = qend(oy, oq - 1)
        pred = first_original(filings, p_end)
        if not pred:
            reasons.append("predecessor_original_filing_unavailable")
        elif not pred["accepted"]:
            reasons.append("predecessor_acceptance_missing")
        elif pred["accepted"] > origin["accepted"]:
            reasons.append("predecessor_accepted_after_origin")
        else:
            needs += [(OCF, p_end, ytd, pred, "predecessor_ytd_ocf"), (ICF, p_end, ytd, pred, "predecessor_ytd_icf")]
    for concept, end, start, filing, role in needs:
        got = pinned(rows, concept, end, start, filing["accn"])
        if got is None:
            reasons.append(f"{role}_original_row_missing")
        elif got == "conflict":
            reasons.append(f"{role}_same_accession_conflict")
    return origin, reasons


def log_read(path, purpose):
    if any(d in path.parts for d in CUSTODY_DIRS):
        with (HERE / "read-ledger.jsonl").open("a") as f:
            f.write(json.dumps({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                "reader": os.environ.get("CUSTODY_READER", "E0 custodian (Claude Opus 5.5 worker)"),
                                "file": str(path.relative_to(HERE)), "purpose": purpose}) + "\n")


def read(path, purpose):
    log_read(path, purpose)
    return path.read_bytes()


def sha(path, purpose="hash for manifest"):
    return hashlib.sha256(read(path, purpose)).hexdigest()


def dump(path, obj):
    """Write and hash the in-memory bytes, so no extra read of custody files."""
    data = json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def load(path, purpose):
    # parse_int/parse_float=str keeps SEC's decimal lexemes exactly
    return json.loads(read(path, purpose), parse_int=str, parse_float=str)


def build_company(name, cik, pkg, targets):
    base = HERE / pkg
    subs = load(base / f"raw/{name}-submissions.json", "filing acceptance metadata for origin/label selection")
    facts = load(base / f"raw/{name}-companyfacts.json", "build origin slices, labels and coverage reasons")
    r = subs["filings"]["recent"]
    filings = [dict(form=f, report=rd, filed=fd, accepted=a or None, accn=n) for f, rd, fd, a, n in
               zip(r["form"], r["reportDate"], r["filingDate"], r["acceptanceDateTime"], r["accessionNumber"])]
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
    pairs, labels = build_pairs(name, base, filings, rows, targets)
    ident = {"name": subs["name"], "cik": cik, "tickers": subs["tickers"], "fiscalYearEnd": subs["fiscalYearEnd"],
             "package": pkg, "nonUsdRequiredRows": non_usd,
             "rowsWithoutAcceptance": sum(1 for x in rows if not x["acceptedAt"])}
    return ident, pairs, labels, base


def build_pairs(name, base, filings, rows, targets):
    """Pairs (safe metadata) and labels (custody only); writes origin slices under base/slices."""
    pairs, labels = [], []
    for (y, q), role in targets.items():
        t_end = qend(y, q)
        origin, reasons = origin_reasons(filings, rows, y, q)
        slice_sha = None
        if origin and origin["accepted"]:
            visible = [x for x in rows if x["acceptedAt"] and x["acceptedAt"] <= origin["accepted"]]
            slice_sha = dump(base / f"slices/{name}-{y}Q{q}.json",
                             {"company": name, "target": f"{y}Q{q}", "originAccession": origin["accn"],
                              "originAcceptedAt": origin["accepted"], "rows": sorted(visible, key=json.dumps)})
        target, label = first_original(filings, t_end), None
        if not target:
            reasons.append("target_filing_missing")
        elif not target["accepted"]:
            reasons.append("target_acceptance_missing")
        else:
            label = pinned(rows, CASH, t_end, None, target["accn"])
            if label in (None, "conflict"):
                reasons.append("target_label_original_row_missing" if label is None else "target_label_conflict")
                label = None
        if label:
            comb = pinned(rows, COMBINED, t_end, None, target["accn"])
            labels.append({"company": name, "target": f"{y}Q{q}", "accn": target["accn"], "cashUsd": label,
                           "combinedUsd": comb if comb != "conflict" else None})
        pairs.append({"company": name, "role": role, "target": f"{y}Q{q}", "targetQuarterEnd": t_end,
                      "originPeriodEnd": qend(*prev(y, q)), "originAccession": origin and origin["accn"],
                      "originForm": origin and origin["form"], "originAcceptedAt": origin and origin["accepted"],
                      "targetAccession": target and target["accn"], "targetForm": target and target["form"],
                      "targetAcceptedAt": target and target["accepted"],
                      "originSliceSha256": slice_sha, "eligible": not reasons, "missing": sorted(set(reasons))})
    return pairs, labels


def main():
    manifest = {"protocol": {"path": "kb/spec/forecast-evaluation-protocol-v1.md", "sha256": sha(PROTOCOL)},
                "method": "inputs pinned to the first original 10-Q/10-K accession for each period (filing chronology), no substitution; "
                          "origin acceptance strictly inside target quarter (boundary days excluded); "
                          "visibility = acceptanceDateTime <= origin; USD us-gaap only",
                "companies": {}, "pairs": [], "raw": {}, "labels": {}}
    sealed_labels = []
    for name, (cik, pkg, targets) in COMPANIES.items():
        ident, pairs, labels, base = build_company(name, cik, pkg, targets)
        manifest["companies"][name] = ident
        manifest["pairs"] += pairs
        for p in sorted((base / "raw").glob(f"{name}-*.json")):
            manifest["raw"][str(p.relative_to(HERE))] = sha(p)
        if pkg == "sealed":
            sealed_labels += labels
        else:
            manifest["labels"][f"{pkg}/labels-{name}.json"] = dump(base / f"labels-{name}.json", labels)
    # random salt so the file hash cannot be brute-forced from guessed amounts; kept stable across rebuilds
    lp = HERE / "sealed/labels.json"
    salt = load(lp, "reuse label salt")["salt"] if lp.exists() else secrets.token_hex(32)
    manifest["labels"]["sealed/labels.json"] = dump(lp, {"salt": salt, "labels": sealed_labels})
    test = [p for p in manifest["pairs"] if p["role"] == "test"]
    manifest["summary"] = {"testPlanned": len(test), "testEligible": sum(p["eligible"] for p in test),
                           "testMissing": sorted({m for p in test for m in p["missing"]})}
    out = HERE / "manifest.json"
    out.write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n")
    for role in ("test", "development", "validation", "mapping-acceptance"):
        ps = [p for p in manifest["pairs"] if p["role"] == role]
        print(role, "planned", len(ps), "eligible", sum(p["eligible"] for p in ps),
              "missing", sorted({m for p in ps for m in p["missing"]}))
    print("manifest sha256", sha(out))


if __name__ == "__main__":
    main()
