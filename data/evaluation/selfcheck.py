"""Synthetic-row self-check for build.py selection rules. No SEC data is read.

Usage: python3 -I data/evaluation/selfcheck.py
"""
import importlib.util, json, pathlib, sys, tempfile

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("build", pathlib.Path(__file__).resolve().parent / "build.py")
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def f(accn, form, report, accepted, filed=None):
    return {"accn": accn, "form": form, "report": report, "accepted": accepted, "filed": filed or accepted[:10]}


def row(concept, end, start, val, accn):
    return {"concept": concept, "end": end, "start": start, "val": val, "accn": accn}


def full(accn, end, ytd):
    return [row(b.CASH, end, None, "1", accn), row(b.COMBINED, end, None, "2", accn),
            row(b.OCF, end, ytd, "3", accn), row(b.ICF, end, ytd, "4", accn)]


# Target 2024Q3: origin is the original 2024Q2 10-Q; predecessor is the original 2024Q1 10-Q.
Q1, Q2 = "2024-03-31", "2024-06-30"
filings = [f("q1", "10-Q", Q1, "2024-05-01T20:00:00.000Z"), f("q2", "10-Q", Q2, "2024-08-01T20:00:00.000Z"),
           f("q2a", "10-Q/A", Q2, "2024-08-05T20:00:00.000Z"), f("q3", "10-Q", "2024-09-30", "2024-10-30T20:00:00.000Z")]
good = full("q2", Q2, "2024-01-01") + full("q1", Q1, "2024-01-01")[2:]
assert b.origin_reasons(filings, good, 2024, 3) == (filings[1], []), "complete original rows are eligible"

# Item 1: original origin row missing; amendment and later-comparative rows must not stand in.
no_cash = [x for x in good if not (x["concept"] == b.CASH and x["accn"] == "q2")]
subs = no_cash + [row(b.CASH, Q2, None, "9", "q2a"), row(b.CASH, Q2, None, "9", "q3")]
_, reasons = b.origin_reasons(filings, subs, 2024, 3)
assert reasons == ["origin_cash_original_row_missing"], reasons

# Item 1: predecessor YTD present only as a later comparative (in q2), not in its original q1 filing.
pred_cmp = [x for x in good if x["accn"] == "q2"] + [row(b.OCF, Q1, "2024-01-01", "9", "q2"), row(b.ICF, Q1, "2024-01-01", "9", "q2")]
_, reasons = b.origin_reasons(filings, pred_cmp, 2024, 3)
assert reasons == ["predecessor_ytd_ocf_original_row_missing", "predecessor_ytd_icf_original_row_missing"], reasons

# Item 1: conflicting values inside the pinned accession block eligibility.
_, reasons = b.origin_reasons(filings, good + [row(b.CASH, Q2, None, "8", "q2")], 2024, 3)
assert reasons == ["origin_cash_same_accession_conflict"], reasons

# Item 1: the first original wins over a later original-form refiling of the same period.
assert b.first_original(filings + [f("q2late", "10-Q", Q2, "2024-09-01T20:00:00.000Z")], Q2)["accn"] == "q2"
assert b.pinned(subs, b.CASH, Q2, None, "q2") is None

# Item 5: strict quarter boundary (first and last calendar days excluded).
assert not b.inside_quarter("2024-07-01T10:00:00.000Z", 2024, 3)
assert not b.inside_quarter("2024-09-30T10:00:00.000Z", 2024, 3)
assert not b.inside_quarter("2024-06-30T23:59:59.000Z", 2024, 3)
assert not b.inside_quarter("2024-10-01T00:00:00.000Z", 2024, 3)
assert b.inside_quarter("2024-07-02T00:00:00.000Z", 2024, 3) and b.inside_quarter("2024-09-29T23:59:59.000Z", 2024, 3)
edge = [dict(x, accepted="2024-07-01T12:00:00.000Z") if x["accn"] == "q2" else x for x in filings]
_, reasons = b.origin_reasons(edge, good, 2024, 3)
assert reasons == ["origin_outside_target_quarter"], reasons

# Round-2 item 1: an earlier original with an unknown acceptance instant is never skipped for a later original.
unknown = [f("q2early", "10-Q", Q2, None, filed="2024-07-20"), *filings]
assert b.first_original(unknown, Q2)["accn"] == "q2early"
origin, reasons = b.origin_reasons(unknown, good, 2024, 3)
assert origin["accn"] == "q2early" and reasons == ["origin_acceptance_missing"], reasons
same_day = [f("0002-24-000002", "10-Q", Q2, "2024-08-01T09:00:00.000Z", filed="2024-08-01"),
            f("0002-24-000001", "10-Q", Q2, None, filed="2024-08-01")]
assert b.first_original(same_day, Q2)["accn"] == "0002-24-000001", "accession sequence breaks filed-date ties"
pred_unknown = [dict(x, accepted=None) if x["accn"] == "q1" else x for x in filings]
assert b.origin_reasons(pred_unknown, good, 2024, 3)[1] == ["predecessor_acceptance_missing"]
target_unknown = [dict(x, accepted=None) if x["accn"] == "q3" else x for x in filings]

with tempfile.TemporaryDirectory() as tmp:
    b.HERE = pathlib.Path(tmp)
    (b.HERE / "sealed").mkdir()
    (b.HERE / "development").mkdir()

    # Committed pair metadata carries target accession, form and actual acceptance instant.
    acc = {x["accn"]: x["accepted"] for x in filings}
    rows3 = [dict(x, acceptedAt=acc[x["accn"]]) for x in
             good + [row(b.CASH, "2024-09-30", None, "5", "q3"), row(b.COMBINED, "2024-09-30", None, "6", "q3")]]
    pairs, labels = b.build_pairs("synthetic", b.HERE / "sealed", filings, rows3, {(2024, 3): "test"})
    p = pairs[0]
    assert p["eligible"] and p["targetAccession"] == "q3" and p["targetForm"] == "10-Q"
    assert p["targetAcceptedAt"] == "2024-10-30T20:00:00.000Z" and p["originAcceptedAt"] == "2024-08-01T20:00:00.000Z"
    assert "val" not in json.dumps(pairs) and len(labels) == 1
    p = b.build_pairs("synthetic", b.HERE / "sealed", target_unknown, rows3, {(2024, 3): "test"})[0][0]
    assert not p["eligible"] and p["missing"] == ["target_acceptance_missing"] and p["targetAcceptedAt"] is None

    # Every custody read, including hashing, reaches the read ledger; development reads do not.
    for d in ("sealed", "development"):
        (b.HERE / d / "x.json").write_text("{}")
    b.load(b.HERE / "sealed/x.json", "probe load")
    b.sha(b.HERE / "sealed/x.json")
    b.sha(b.HERE / "development/x.json")
    ledger = [json.loads(l) for l in (b.HERE / "read-ledger.jsonl").read_text().splitlines()]
    assert [(e["file"], e["purpose"]) for e in ledger] == [("sealed/x.json", "probe load"), ("sealed/x.json", "hash for manifest")], ledger
    assert all(e["reader"] and e["at"] for e in ledger)

# Mapping-acceptance package config: Freshworks 2023Q3 only, withheld custody, logged reads.
assert b.COMPANIES["freshworks"] == ("0001544522", "withheld", {(2023, 3): "mapping-acceptance"})
assert "withheld" in b.CUSTODY_DIRS and "sealed" in b.CUSTODY_DIRS
assert all(b.COMPANIES[c][1] == "sealed" and len(b.COMPANIES[c][2]) == 8 for c in ("tenable", "varonis"))

print("selfcheck ok")
