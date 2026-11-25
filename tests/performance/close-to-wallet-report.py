"""Compare signed close-to-wallet runs, retaining every designated creditor at each cutoff."""
import json
from pathlib import Path
import sys


def report(directory):
    result = json.loads((Path(directory) / "cashout-result.json").read_text())
    rows = result["rows"]
    assert len({row["margin"] for row in rows}) == len(rows) == 2
    # Each trader bought and sold 1,000 lots at 60,002 and 60,998 atoms per lot.
    # The aggregate taker fee on each fill is rounded up to the next atom.
    gross = 60_998_000 - 60_002_000
    fees = 12_001 + 12_200
    overlap = []
    for index, row in enumerate(rows):
        assert tuple(map(int, (row["gain"], row["fees"], row["net"]))) == (gross, fees, gross - fees)
        for action in ("open", "close"):
            receipts = [r for r in result["receipts"] if r["label"] == f"{action} creditor {index}"]
            assert len(receipts) == 1 and receipts[0]["error"] is None
        withdrawals = [r for r in result["receipts"] if r["label"] == f"withdraw creditor {index}"]
        assert len(withdrawals) == int(row["withdrawalMs"] is not None)
        assert all(r["error"] is None for r in withdrawals)
        close = next(r for r in result["receipts"] if r["label"] == f"close creditor {index}")
        fills = [r for r in result["receipts"] if r["label"].startswith("traffic ") and r["error"] is None]
        overlap.append(sum(close["slot"] < r["slot"] < withdrawals[0]["slot"] for r in fills) if withdrawals else None)
    schedule = [point["ms"] for point in rows[0]["checkpoints"]]
    assert all([x["ms"] for x in row["checkpoints"]] == schedule for row in rows)
    cutoffs = []
    for index, limit in enumerate(schedule):
        points = [row["checkpoints"][index] for row in rows]
        assert all(0 <= p["observedMs"] <= limit for p in points)
        assert all(int(p["credited"]) + int(p["unpaid"]) == gross for p in points)
        assert all(0 <= int(p["withdrawn"]) <= min(gross - fees, int(p["credited"])) for p in points)
        counts = [sum(int(p["credited"]) == 0 for p in points),
                  sum(0 < int(p["credited"]) < gross for p in points),
                  sum(int(p["credited"]) == gross for p in points)]
        assert sum(counts) == len(points)
        cutoffs.append(dict(ms=limit, waiting=counts[0], partial=counts[1], fullyCredited=counts[2],
                            withdrawn=sum(int(p["withdrawn"]) == gross - fees for p in points),
                            unpaidAtoms=str(sum(int(p["unpaid"]) for p in points))))
    return result, cutoffs, overlap


if __name__ == "__main__":
    workers_only = sys.argv[1:2] == ["--workers"]
    runs = sys.argv[2:] if workers_only else sys.argv[1:]
    if len(runs) != 2:
        sys.exit("Usage: close-to-wallet-report.py TRADER_RUN WORKER_RUN | --workers BEFORE_RUN AFTER_RUN")
    before, after = map(report, runs)
    assert [before[0]["arm"], after[0]["arm"]] == (["worker", "worker"] if workers_only else ["trader", "worker"])
    for key in ("program", "openingPool", "backingReadyBeforeClose"):
        assert before[0][key] == after[0][key]
    if workers_only:
        for result, _, _ in (before, after):
            assert result["traffic"]["filled"] == result["traffic"]["offered"] == 48
            assert result["exitsObserved"] == 2
            assert [int(flow["collected"]) for flow in result["workerFlows"]] == [502_480, 480]
            assert list(map(int, result["remainingLossAtoms"])) == [0, 0]
    else:
        assert before[0]["revision"] == after[0]["revision"]
    for key in ("offered", "gapMs"):
        assert before[0]["traffic"][key] == after[0]["traffic"][key]
    assert before[0]["traffic"].get("dueMs") == after[0]["traffic"].get("dueMs")
    for result, cutoffs, overlap in (before, after):
        summary = dict(arm=result["arm"], revision=result["revision"], traffic=result["traffic"],
                       creditors=len(result["rows"]), cutoffs=cutoffs, otherFillsStrictlyBetweenCloseAndExit=overlap,
                       relativeToConfirmedCloseMs=[
                           {k: row[k] for k in ("firstCreditMs", "fullCreditMs", "withdrawalMs")} for row in result["rows"]])
        if workers_only:
            # Collections exclude the sampled slot: the receipt cannot order an observation within it.
            summary.update(workerFlows=result["workerFlows"], remainingLossAtoms=result["remainingLossAtoms"], marketsAtCutoffs=[
                dict(margin=row["margin"], progress=[
                    {k: point[k] for k in ("ms", "pool", "ethPool", "outstandingLossAtoms", "workerCollectedBeforeSlot")}
                    for point in row["checkpoints"]]) for row in result["rows"]])
        print(json.dumps(summary, indent=2))
