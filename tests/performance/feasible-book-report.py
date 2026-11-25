"""Compare two completed signed venues at the same economic snapshot and wallet budget."""
import argparse
import json
from pathlib import Path


def load(directory, arm):
    orders = json.loads((directory / "feasible-orders.json").read_text())
    replay = json.loads((directory / "feasible-replay.json").read_text())
    assert replay["arm"] == arm and replay["events"] > 0
    custody = replay["reconciliation"]
    assert custody["actualVault"] == custody["allocatedVault"] and custody["unallocatedSurplus"] == "0"
    cases = {}
    for row in orders:
        _, name, signed_arm = row["label"].split()
        assert signed_arm == arm and name not in cases
        receipt = row["tx"]
        assert receipt["ws"] and receipt["signatures"] == 1 and receipt["feeLamports"] == "5000"
        assert receipt["computeUnitLimit"] == 800_000 and receipt["computeUnits"] <= receipt["computeUnitLimit"]
        assert (row["actual"] is None) == (receipt["error"] is not None)
        if row["actual"]:
            filled = {leg["instance"] for leg in row["actual"]["legs"]}
            assert filled.issubset(row["signedInstances"]) and len(filled) <= row["order"]["width"]
        cases[name] = row
    return cases, replay


def compare(wallet_dir, control_dir):
    wallet, wallet_replay = load(wallet_dir, "wallet")
    control, control_replay = load(control_dir, "control")
    assert wallet_replay["revision"] == control_replay["revision"]
    assert set(wallet) == {"curved", "constrained"}
    assert set(control) in (set(wallet), set(wallet) | {"mixed"})
    results = []
    for name, ordinary in wallet.items():
        trials = [control[name]]
        if name == "curved" and "mixed" in control:
            trials.append(control["mixed"])
        for trial in trials:
            for field in ("books", "order", "reference", "scoped", "shortlisted"):
                assert ordinary[field] == trial[field], f"{name} differs across venues in {field}"
        best = int(ordinary["reference"]["best"]["allIn"])
        actual = int(ordinary["actual"]["allIn"]) if ordinary["actual"] else None
        confirmed = [int(trial["actual"]["allIn"]) for trial in trials if trial["actual"]]
        assert confirmed, f"{name} lacks a signed executable control"
        buy = ordinary["order"]["side"] == 0
        executable = min(confirmed) if buy else max(confirmed)
        assert (executable >= best) if buy else (executable <= best)
        if name == "constrained":
            assert executable == best, "signed explicit split must confirm the margin boundary"
        results.append({
            "case": name, "requestedLots": ordinary["order"]["lots"],
            "walletAllInAtoms": None if actual is None else str(actual), "referenceAllInAtoms": str(best),
            "bestSignedControlAllInAtoms": str(executable),
            "walletDisadvantageVsControlAtoms": None if actual is None else str(actual - executable if buy else executable - actual),
            "walletMatchedReference": actual == best,
            "attempts": [{"label": trial["label"], "makers": trial["signedInstances"],
                          "units": trial["tx"]["computeUnits"], "error": trial["tx"]["error"]} for trial in [ordinary, *trials]],
        })
    return {"revision": wallet_replay["revision"], "cases": results,
            "walletMatchedBothReferences": all(row["walletMatchedReference"] for row in results),
            "replayedEvents": {"wallet": wallet_replay["events"], "control": control_replay["events"]}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wallet", type=Path)
    parser.add_argument("control", type=Path)
    args = parser.parse_args()
    print(json.dumps(compare(args.wallet, args.control), indent=2))
