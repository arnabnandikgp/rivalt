"""Rebuild the six matched BTC economic comparisons from retained signed runs."""
import argparse
import json
from collections import Counter
from decimal import Decimal
from math import ceil
from pathlib import Path

NAMES = {"omitted reprice", "fragmented 5000", "fragmented 10000", "fragmented 20000",
         "thin bids", "deep replacement", "immediately after replenishment A", "immediately after replenishment B", "concurrent wallet A", "concurrent wallet B"}
SCALE = Decimal(1_000_000)


def percentile(values, fraction):
    return sorted(values)[ceil(len(values) * fraction) - 1]


def money(atoms):
    return str(Decimal(atoms) / SCALE)


def summarize(run):
    rows = run["entries"]
    assert len(rows) == len(NAMES) and {row["name"] for row in rows} == NAMES
    signed = [row for row in rows if row["signature"]]
    assert len({row["signature"] for row in signed}) == len(signed)
    assert int(run["reconciliation"]["actualVault"]) == int(run["reconciliation"]["allocatedVault"])
    filled = [row for row in rows if row["actual"]]
    details = []
    missed = Counter()
    for row in rows:
        actual = row["actual"]
        if actual:
            gross, fee = int(actual["gross"]), int(actual["fee"])
            assert int(actual["allIn"]) == int(row["shortlisted"]["allIn"])
            assert fee == (gross + 4999) // 5000
            assert sum(int(leg["lots"]) for leg in actual["legs"]) == int(row["requestedLots"])
            assert 0 <= int(row["missedAcrossDirectoryAtoms"])
        else:
            missed[row["classification"]] += 1
        details.append(dict(order=row["name"], side="sell" if row["side"] else "buy",
                            requested=money(row["requestedIndexAtoms"]), classification=row["classification"],
                            supplied=row["supplied"], error=row["error"],
                            filledIndex=money(row["requestedIndexAtoms"]) if actual else "0",
                            filledGross=money(actual["gross"]) if actual else None,
                            vwap=str(Decimal(actual["gross"]) / Decimal(row["requestedLots"])) if actual else None,
                            takerFee=money(actual["fee"]) if actual else None,
                            **{key: money(row[key]["allIn"]) if row[key] else None
                               for key in ("unrestricted", "bounded", "shortlisted", "actual")}))
    concurrent = [row for row in rows if row["name"].startswith("concurrent wallet")]
    assert len(concurrent) == 2 and len({row["batchConfirmedMs"] for row in concurrent}) == 1
    seconds = concurrent[0]["batchConfirmedMs"] / 1000
    latency = [row["confirmedMs"] for row in signed]
    return dict(makers=run["count"], legs=run["width"], offered=len(rows), signed=len(signed), filled=len(filled),
                requested=money(sum(int(row["requestedIndexAtoms"]) for row in rows)),
                filledIndex=money(sum(int(row["requestedIndexAtoms"]) for row in filled)),
                takerFees=money(sum(int(row["actual"]["fee"]) for row in filled)),
                gapOnFills=money(sum(int(row["missedAcrossDirectoryAtoms"]) for row in filled)),
                txFeeLamports=sum(int(row["feeLamports"]) for row in rows), refusals=dict(missed),
                signedConfirmedP50ms=round(percentile(latency, .50), 1),
                signedConfirmedP95ms=round(percentile(latency, .95), 1),
                competingFills=sum(bool(row["actual"]) for row in concurrent),
                competingBatchSeconds=round(seconds, 3),
                competingConfirmedOffersPerSecond=round(2 / seconds, 2),
                competingFillsPerSecond=round(sum(bool(row["actual"]) for row in concurrent) / seconds, 2),
                replayedEvents=run["events"], perOrder=details)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directories", type=Path, nargs=6)
    args = parser.parse_args()
    runs = [json.loads((directory / "comparison.json").read_text()) for directory in args.directories]
    assert len({run["revision"] for run in runs}) == 1
    assert {(run["count"], run["width"]) for run in runs} == {(n, k) for n in (16, 32) for k in (2, 4, 8)}
    schedules = [sorted((row["name"], row["side"], row["requestedLots"]) for row in run["entries"]) for run in runs]
    assert all(schedule == schedules[0] for schedule in schedules)
    print(json.dumps([summarize(run) for run in sorted(runs, key=lambda run: (run["count"], run["width"]))], indent=2))


if __name__ == "__main__":
    main()
