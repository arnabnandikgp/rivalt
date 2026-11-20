"""Audit payer costs and writable overlap during measured paired-route rounds."""
import collections
import json
import math
from pathlib import Path
import sys


def summarize(directory):
    def read(name):
        return json.loads((directory / name).read_text())

    run = read("successor-route-locks.json")
    signed = {receipt["signature"]: burst["workload"] for burst in run["bursts"]
              for receipt in burst["receipts"]}
    rounds = run["workload"]["rounds"]
    assert len(signed) == run["workload"]["landed"] == rounds * 12
    costs = collections.defaultdict(lambda: collections.Counter())
    observations = collections.defaultdict(list)
    wires = sorted(directory.glob("wire-*.json"), key=lambda path: int(path.stem.split("-")[1]))
    measured = [i for i, path in enumerate(wires) if read(path.name)["signature"] in signed]
    # Every pair starts with one signed refresh and one signed impact publication.
    window = wires[measured[0]-2:measured[-1]+1]
    assert len(window) == 2 * len(signed)
    for path in window:
        wire = read(path.name)
        receipt = read(path.name.replace("wire-", "transaction-"))
        assert receipt["transaction"]["signatures"][0] == wire["signature"] and receipt["meta"]["err"] is None
        payer = receipt["transaction"]["message"]["accountKeys"][0]
        if wire["signature"] in signed:
            kind = "trader fill"
            observations[signed[wire["signature"]]].append(receipt["meta"]["computeUnitsConsumed"])
        elif wire["label"] == "refresh independent sources and six maker publications":
            kind = "operator source and maker refresh"
        else:
            assert wire["label"] == "P32 publisher available two-market reports"
            kind = "operator impact publication"
        costs[kind][payer] += receipt["meta"]["fee"]
    assert len(costs["trader fill"]) == 3
    assert sum(costs["trader fill"].values()) == run["workload"]["traderLamports"]
    limits = {}
    for workload, values in observations.items():
        assert len(values) == 4 * rounds
        ordered = sorted(values)
        overlaps = {tuple(b["overlap"]) for b in run["bursts"] if b["workload"] == workload}
        assert len(overlaps) == 1
        limits[workload] = dict(fills=len(values), minCU=ordered[0], p95CU=ordered[math.ceil(len(values)*0.95)-1],
                                maxCU=ordered[-1], sharedWrites=list(overlaps.pop()))
    return dict(workload=run["workload"], resources=limits, lamportsByRoleAndPayer=costs)


if __name__ == "__main__":
    print(json.dumps(summarize(Path(sys.argv[1])), indent=2))
