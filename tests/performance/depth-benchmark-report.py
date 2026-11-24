"""Summarize two completed depth-benchmark runs. Amounts use test collateral atoms."""
import json
import sys
from collections import Counter
from pathlib import Path


def load(path, arm):
    result = json.loads((Path(path) / "depth-benchmark.json").read_text())
    assert result["arm"] == arm and result["events"] > 0
    rows = result["rows"]
    assert len({row["label"] for row in rows}) == len(rows)
    assert len({row["receipt"]["signature"] for row in rows}) == len(rows)
    return result


def summarize(rows):
    filled = [row for row in rows if row["fill"] is not None]
    failures = Counter()
    for row in rows:
        receipt = row["receipt"]
        assert receipt["ws"] and receipt["signatures"] == 1
        assert receipt["error"] == row["measured"]["error"]
        if row["fill"] is None:
            reason = row["expectedRefusal"] or "quote fits; execution refused"
            failures[(reason, json.dumps(receipt["error"]["InstructionError"][1]))] += 1
    return {
        "offered": len(rows), "filled": len(filled),
        "single": sum(len(row["fill"]["legs"]) == 1 for row in filled),
        "split": sum(len(row["fill"]["legs"]) == 2 for row in filled),
        "requestedIndexAtoms": sum(int(row["requestedIndexAtoms"]) for row in rows),
        "filledIndexAtoms": sum(int(row["requestedIndexAtoms"]) for row in filled),
        "grossExecutionAtoms": sum(int(row["fill"]["gross"]) for row in filled),
        "takerFeeAtoms": sum(int(row["fill"]["fee"]) for row in filled),
        "signedNetworkLamports": sum(int(row["receipt"]["feeLamports"]) for row in rows),
        "refusals": [{"reason": reason, "instructionError": json.loads(error), "count": count}
                     for (reason, error), count in failures.items()],
    }


def matched(rows):
    """A CU delta requires two successful alternatives on one bank. Never subtract across runs."""
    for row in rows:
        pair = row["pair"]
        if not pair or pair["routed"]["error"] is not None or pair["explicit"]["error"] is not None:
            continue
        legs = len(row["best"]["legs"])
        routed, explicit = pair["routed"], pair["explicit"]
        assert len(routed["makerQuoteUnits"]) == len(explicit["makerQuoteUnits"]) == legs
        yield {
            "label": row["label"], "market": row["marketIndex"], "slot": pair["slot"], "legs": legs,
            "routedCU": routed["units"], "explicitCU": explicit["units"],
            "extraTxCU": routed["units"] - explicit["units"],
            "routedInstructionCU": routed["routeUnits"], "explicitInstructionCU": explicit["routeUnits"],
            "routedMakerCU": sum(routed["makerQuoteUnits"]), "explicitMakerCU": sum(explicit["makerQuoteUnits"]),
        }


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: python3 tests/performance/depth-benchmark-report.py ROUTED_RUN EXPLICIT_RUN")
    runs = [load(path, arm) for path, arm in zip(sys.argv[1:], ["routed", "explicit"])]
    assert runs[0]["revision"] == runs[1]["revision"] and runs[0]["build"] == runs[1]["build"]
    assert [row["label"] for row in runs[0]["rows"]] == [row["label"] for row in runs[1]["rows"]]
    # Both artifacts use the bounded-entry deployment. Keep the decisive paired witness in the report.
    for run in runs:
        cases = {row["control"]: row for row in run["rows"] if row["control"].startswith("maker-capital")}
        fallback = cases["maker-capital-fallback"]
        assert fallback["publishedBest"]["legs"][0]["id"] == 0 and fallback["best"]["legs"][0]["id"] == 1
        assert fallback["pair"]["explicit"]["error"] is None
        assert fallback["pair"]["routed"]["error"]["InstructionError"][1] == {"Custom": 6133}
        assert (fallback["fill"] is None) == (run["arm"] == "routed")
        assert cases["maker-capital-limit"]["fill"] is None
        for row in run["rows"]:
            if row["expectedRefusal"]:
                assert row["fill"] is None
            if row["control"] == "ordinary":
                assert (row["fill"] is None) == bool(row["expectedRefusal"]), row["label"]
    result = {}
    for run in runs:
        rows = run["rows"]
        groups = {book: [row for row in rows if row["book"] == book and row["control"] == "ordinary"]
                  for book in ("deep", "fragmented", "one-sided")}
        assert all(len(group) == 10 for group in groups.values())
        costs = list(matched(rows))
        assert {entry["legs"] for entry in costs} == {1, 2}
        result[run["arm"]] = {
            "revision": run["revision"], "program": run["build"]["revision"], "events": run["events"],
            "withdrawalAtoms": run["withdrawal"], "unpaidScaled": run["unpaid"],
            "all": summarize(rows), "ordinaryBooks": {name: summarize(group) for name, group in groups.items()},
            "matchedSuccessfulSimulations": costs,
        }
    print(json.dumps(result, indent=2))
