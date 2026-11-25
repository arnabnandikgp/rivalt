"""Summarize two completed depth-benchmark runs. Amounts use test collateral atoms."""
import json
import sys
from collections import Counter
from decimal import Decimal
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
    requested = sum(int(row["requestedIndexAtoms"]) for row in rows)
    executed = sum(int(row["requestedIndexAtoms"]) for row in filled)
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
        "requestedIndexAtoms": str(requested), "filledIndexAtoms": str(executed),
        "indexNotionalFillPercent": format(Decimal(executed) * 100 / requested, ".2f") if requested else None,
        "grossExecutionAtoms": str(sum(int(row["fill"]["gross"]) for row in filled)),
        "takerFeeAtoms": str(sum(int(row["fill"]["fee"]) for row in filled)),
        "signedNetworkLamports": str(sum(int(row["receipt"]["feeLamports"]) for row in rows)),
        "refusals": [{"reason": reason, "instructionError": json.loads(error), "count": count}
                     for (reason, error), count in failures.items()],
    }


def dollar_outcome(row):
    """Price the whole-lot perp exposure in test USD at collateral parity."""
    def usd(atoms):
        return format(Decimal(atoms).scaleb(-6), ".6f")

    lots = int(row["lots"])
    index_value = int(row["requestedIndexAtoms"])
    index_per_lot, remainder = divmod(index_value, lots)
    assert remainder == 0 and row["side"] in (0, 1) and row["marketIndex"] in (0, 1)
    buy = row["side"] == 0
    limit = int(row["allInLimit"])
    quoted = row["publishedBest"]
    reference = row["best"]  # Maker-capital control excludes the flat, one-atom maker.
    fill = row["fill"]
    executed = None
    if fill is not None:
        gross, fee = int(fill["gross"]), int(fill["fee"])
        legs = fill["legs"]
        assert sum(int(leg["lots"]) for leg in legs) == lots
        assert sum(int(leg["gross"]) for leg in legs) == gross
        assert fee == (gross + 4999) // 5000 and fee <= int(row["maxFee"])
        all_in = gross + fee if buy else gross - fee
        headroom = limit - all_in if buy else all_in - limit
        assert headroom >= 0 and all_in == int(reference["allIn"])
        price_cost = gross - index_value if buy else index_value - gross
        lots_per_asset = (1_000_000, 100_000)[row["marketIndex"]]
        executed = {
            "makerIds": [leg["id"] for leg in legs], "grossUsd": usd(gross),
            "averageFillPriceUsdPerAsset": format(Decimal(usd(gross)) * lots_per_asset / lots, ".6f"),
            "priceCostVsIndexUsd": usd(price_cost), "takerFeeUsd": usd(fee),
            "allInUsd": usd(all_in), "totalCostVsIndexUsd": usd(price_cost + fee),
            "insideSignedLimitUsd": usd(headroom),
        }
    return {
        "book": row["book"], "case": row["control"], "market": ("BTC", "ETH")[row["marketIndex"]],
        "side": "buy" if buy else "sell", "targetUsd": str(row["dollars"]),
        "requestedIndexUsd": usd(index_value), "filledIndexUsd": usd(index_value if fill else 0),
        "publishedDepthIndexUsd": usd(int(row["published"]) * index_per_lot),
        "largestPublishedPairIndexUsd": usd(int(row["maxPairDepth"]) * index_per_lot),
        "bestPublishedPairAllInUsd": usd(int(quoted["allIn"])) if quoted else None,
        "bestPairAfterMakerCapitalAllInUsd": usd(int(reference["allIn"])) if reference else None,
        "signedAllInLimitUsd": usd(limit), "execution": executed,
        "refusal": None if fill else row["expectedRefusal"] or "quote fits; execution refused",
        "instructionError": row["receipt"]["error"], "networkFeeLamports": str(row["receipt"]["feeLamports"]),
        "signature": row["receipt"]["signature"],
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
    for run in runs:
        cases = {row["control"]: row for row in run["rows"] if row["control"].startswith("maker-capital")}
        fallback = cases["maker-capital-fallback"]
        assert fallback["publishedBest"]["legs"][0]["id"] == 0 and fallback["best"]["legs"][0]["id"] == 1
        assert fallback["pair"]["explicit"]["error"] is None
        if run["build"]["artifactSet"] == "funded-maker-routing":
            assert fallback["pair"]["routed"]["error"] is None
            for field in ("legs", "gross", "fee"):
                assert fallback["fill"][field] == fallback["best"][field]
        else:
            assert run["build"]["artifactSet"] == "bounded-entry-settlement"
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
            "ordinaryBtc": summarize([row for row in rows if row["control"] == "ordinary" and row["marketIndex"] == 0]),
            "ordinaryBooks": {name: summarize(group) for name, group in groups.items()},
            "dollarOrders": [dollar_outcome(row) for row in rows], "all": summarize(rows),
            "matchedSuccessfulSimulations": costs,
        }
    print(json.dumps(result, indent=2))
