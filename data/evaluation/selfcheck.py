"""Synthetic-row self-check for build.py selection rules. No SEC data is read.

Usage: python3 -I data/evaluation/selfcheck.py
"""
import importlib.util, pathlib, sys

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("build", pathlib.Path(__file__).resolve().parent / "build.py")
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


def f(accn, form, report, accepted):
    return {"accn": accn, "form": form, "report": report, "accepted": accepted}


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

print("selfcheck ok")
