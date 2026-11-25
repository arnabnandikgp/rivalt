"""Audit scheduled wallet orders against finalized receipts and compare their lock sets."""
import argparse
import json
import math
from collections import Counter
from dataclasses import dataclass
from decimal import Decimal
from itertools import combinations
from pathlib import Path


def read(path):
    return json.loads(path.read_text())


def percentiles(samples):
    if not samples:
        return None
    ordered = sorted(samples)
    return {label: round(ordered[math.ceil(len(ordered) * fraction) - 1], 1)
            for label, fraction in [("p50", .50), ("p95", .95), ("max", 1)]}


def dollars_per_second(atoms, milliseconds):
    return format(Decimal(atoms) / 1000 / Decimal(str(milliseconds)), ".2f")


def audit_signed(directory, rows, roles):
    expected = {row["label"]: row for row in rows if row["signature"]}
    assert len({row["signature"] for row in expected.values()}) == len(expected)
    for file in directory.glob("wire-*.json"):
        wire = read(file)
        if not wire["label"].startswith("contention "):
            continue
        row = expected.pop(wire["label"])
        receipt = read(file.with_name(file.name.replace("wire-", "transaction-")))
        assert receipt["transaction"]["signatures"] == [row["signature"]] == [wire["signature"]]
        assert receipt["slot"] == row["slot"] and receipt["meta"]["err"] == row["error"]
        assert receipt["meta"]["computeUnitsConsumed"] == row["cu"]
        assert receipt["meta"]["fee"] == int(row["networkFeeLamports"])
        assert int(row["gross"]) == (int(row["target"]) if row["error"] is None else 0)
        assert int(row["fee"]) == (int(row["gross"]) + 4999) // 5000
        assert read(file.with_name(file.name.replace("wire-", "ws-")))["logs"]["params"]["result"]["value"]["signature"] == row["signature"]
        message = receipt["transaction"]["message"]
        keys, header = message["accountKeys"], message["header"]
        required = header["numRequiredSignatures"]
        assert required == 1 and roles[keys[0]] == f"payer {row['wallet']}"
        writable = keys[:required - header["numReadonlySignedAccounts"]] + keys[required:len(keys) - header["numReadonlyUnsignedAccounts"]]
        extra = receipt["meta"].get("loadedAddresses") or {}
        writable = set(writable) | set(extra.get("writable", []))
        assert writable == set(row["locks"]["write"])
        assert (set(keys) | set(extra.get("readonly", []))) - writable == set(row["locks"]["read"])
    assert not expected, list(expected)


def audit_maintenance(directory, windows):
    preflight = {sample["preflight"]["signature"]: sample["preflight"]["error"]
                 for window in windows for sample in window["refreshes"] if sample["preflight"]}
    sent = {report["signature"]: report["error"] for window in windows for report in window["reports"]}
    assert not set(preflight) & set(sent)
    assert len(preflight) + len(sent) == sum(len(window["refreshes"]) for window in windows)
    for file in directory.glob("wire-*.json"):
        wire = read(file)
        if wire["label"] != "P32 publisher available two-market reports":
            continue
        signature = wire["signature"]
        receipt = file.with_name(file.name.replace("wire-", "transaction-"))
        if signature in preflight:
            simulation = read(file.with_name(file.name.replace("wire-", "simulation-")))
            assert simulation["value"]["err"] == preflight.pop(signature) and not receipt.exists()
        elif signature in sent:
            final = read(receipt)
            assert final["transaction"]["signatures"][0] == signature and final["meta"]["err"] == sent.pop(signature)
    assert not preflight and not sent


def lock_overlap(rows, roles):
    """A full-message W/W or W/R overlap implies serialization if both execute.
    RPC broadcast-to-confirmation intervals only establish observed outstanding requests."""
    groups = {}
    for first, second in combinations(rows, 2):
        if first["wallet"] == second["wallet"]:
            continue
        group = "sameMarket" if first["market"] == second["market"] else "crossMarket"
        count = groups.setdefault(group, {"pairs": 0, "conflicting": 0, "outstandingPairs": 0,
                                          "outstandingConflicting": 0, "sharedAccounts": Counter()})
        left, right = first["locks"], second["locks"]
        ww = set(left["write"]) & set(right["write"])
        wr = (set(left["read"]) & set(right["write"])) | (set(left["write"]) & set(right["read"]))
        conflict = bool(ww or wr)
        overlap = max(first["broadcastMs"], second["broadcastMs"]) < min(first["observedMs"], second["observedMs"])
        count["pairs"] += 1
        count["conflicting"] += int(conflict)
        count["outstandingPairs"] += int(overlap)
        count["outstandingConflicting"] += int(overlap and conflict)
        for key in ww | wr:
            count["sharedAccounts"][roles.get(key, key) + (" W/W" if key in ww else " W/R")] += 1
    return groups


def summarize(window, gap, roles):
    rows = window["entries"]
    signed = [row for row in rows if row["signature"]]
    filled = [row for row in signed if row["error"] is None]
    duration = len(rows) * gap
    drained = max(duration, max(row["observedMs"] for row in rows))
    for row in rows:
        assert row["dueMs"] == row["id"] * gap and row["readyMs"] >= row["dueMs"] - 2
        assert row["observedMs"] >= row["readyMs"] and bool(row["unsigned"]) != bool(row["signature"])
        if row["signature"]:
            assert row["readyMs"] <= row["broadcastMs"] <= row["observedMs"]
    offered = sum(int(row["target"]) for row in rows)
    executed = sum(int(row["gross"]) for row in filled)
    return {
        "wallets": window["wallets"], "offered": len(rows), "signed": len(signed), "filled": len(filled),
        "unsignedRefusals": dict(Counter(row["unsigned"] for row in rows if row["unsigned"])),
        "signedRefusals": dict(Counter(json.dumps(row["error"]) for row in signed if row["error"] is not None)),
        "offeredIndexAtoms": str(offered), "filledGrossAtoms": str(executed),
        "scheduledMs": duration, "throughDrainMs": round(drained, 1),
        "offeredOrdersPerSecond": round(len(rows) * 1000 / duration, 2),
        "filledOrdersPerSecond": round(len(filled) * 1000 / drained, 2),
        "offeredDollarsPerSecond": dollars_per_second(offered, duration),
        "filledDollarsPerSecond": dollars_per_second(executed, drained),
        "outcomesFromArrivalMs": percentiles([row["observedMs"] - row["dueMs"] for row in rows]),
        "fillsFromArrivalMs": percentiles([row["observedMs"] - row["dueMs"] for row in filled]),
        "dispatchWaitMs": percentiles([max(0, row["readyMs"] - row["dueMs"]) for row in rows]),
        "snapshotThroughPreflightMs": percentiles([row["broadcastMs"] - row["readyMs"] for row in signed]),
        "broadcastToConfirmationMs": percentiles([row["observedMs"] - row["broadcastMs"] for row in signed]),
        "maintenanceAttempts": len(window["refreshes"]),
        "maintenancePreflightRefusals": sum(sample["preflight"] is not None for sample in window["refreshes"]),
        "maintenanceLandedRefusals": sum(report["error"] is not None for report in window["reports"]),
        "lockOverlap": lock_overlap(signed, roles),
    }


def verify_consumed_depth(directory, roles, rows):
    checkpoint, = read(directory / "application-sql-checkpoints.json")
    assert checkpoint["name"] == "wallet-contention"
    totals, makers = Counter(), {}
    for state in checkpoint["state"]["liquidity"]["makers"].values():
        market = ["BTC market", "ETH market"].index(roles[state["market"]])
        buy, sell = int(state["buyConsumed"]), int(state["sellConsumed"])
        assert buy >= 0 and sell >= 0
        totals[market, 0] += buy
        totals[market, 1] += sell
        if buy or sell:
            makers[roles[state["capital"]]] = {"buyLots": str(buy), "sellLots": str(sell)}
    expected = Counter()
    for row in rows:
        if row["signature"] and row["error"] is None:
            expected[row["market"], row["side"]] += int(row["lots"])
    assert totals == expected, "Final maker depth must equal all landed lots on each side"
    return makers


def native_scheduler(directory, rows, include_arrivals=False):
    signed = {row["signature"]: row for row in rows if row["signature"]}
    assert signed, "No signed trader order reached the validator"
    traces = {sig: [] for sig in signed}
    for line in (directory / "scheduler.trace").read_text().splitlines():
        timestamp, stage, member, signature, worker = line.split()
        if signature in signed:
            traces[signature].append((int(timestamp), stage, member, worker))
    segments = {}
    client = []
    admission_intervals = []
    assigned_workers = Counter()
    all_assignments = Counter()
    multiple_attempts = {}
    for signature, events in traces.items():
        events.sort()
        stages = [event[1] for event in events]
        all_assignments.update(int(event[3]) for event in events if event[1] == "assigned")
        for stage in ("admitted", "assigned", "worker"):
            assert stage in stages, f"{signature} has no {stage} timestamp"
        row = signed[signature]
        assert row["readyMs"] <= row["signedMs"] <= row["broadcastMs"] <= row["rpcAcceptedMs"] <= row["observedMs"]
        client.append({
            "snapshotAndSignMs": row["signedMs"] - row["readyMs"],
            "preflightAndSubscriptionMs": row["broadcastMs"] - row["signedMs"],
            "sendRpcMs": row["rpcAcceptedMs"] - row["broadcastMs"],
            "rpcResponseToObservedConfirmationMs": row["observedMs"] - row["rpcAcceptedMs"],
        })
        if stages.count("admitted") == 1 and len({e[2] for e in events}) == 1:
            # These landmarks are unambiguous even when a worker returns work
            # to the scheduler. The last interval can include earlier execution.
            assert stages[0] == "admitted" and stages.index("assigned") < stages.index("worker")
            start = events[0][0]
            starts = [event[0] - start for event in events if event[1] == "worker"]
            admission_intervals.append({"firstAssignmentUs": events[stages.index("assigned")][0] - start,
                                        "firstWorkerBatchUs": starts[0], "lastWorkerBatchUs": starts[-1]})
        if len(events) != 3:
            # Multiple admissions/assignments can occur when Agave retries.
            # Preserve these observations without guessing which landed.
            multiple_attempts[signature] = [{"usFromFirstEvent": event[0] - events[0][0],
                                             "stage": event[1], "id": event[2], "worker": event[3]}
                                            for event in events]
            continue
        assert stages == ["admitted", "assigned", "worker"] and len({e[2] for e in events}) == 1
        admitted, assigned, worker = (event[0] for event in events)
        segments[signature] = {
            "admitToAssignUs": assigned - admitted,
            "assignToWorkerBatchUs": worker - assigned,
            "admitToWorkerBatchUs": worker - admitted,
        }
        assigned_workers[int(events[1][3])] += 1
    filled = [value for signature, value in segments.items() if signed[signature]["error"] is None]
    result = {"signed": len(signed), "singleAttempt": len(segments), "singleAttemptFills": len(filled),
            "client": {key: percentiles([sample[key] for sample in client]) for key in client[0]},
            "singleAdmission": len(admission_intervals),
            "sinceAdmission": {key: percentiles([sample[key] for sample in admission_intervals])
                               for key in ("firstAssignmentUs", "firstWorkerBatchUs", "lastWorkerBatchUs")},
            "fillAdmitToWorkerBatchUs": percentiles([value["admitToWorkerBatchUs"] for value in filled]),
            "multipleAttempts": multiple_attempts,
            "singleAttemptWorkers": assigned_workers, "allAssignmentsByWorker": all_assignments,
            "timing": {key: percentiles([value[key] for value in segments.values()])
                       for key in ("admitToAssignUs", "assignToWorkerBatchUs", "admitToWorkerBatchUs")}}
    if include_arrivals:
        first_admissions = sorted(min(event[0] for event in events if event[1] == "admitted")
                                  for events in traces.values())
        intervals = [later - earlier for earlier, later in zip(first_admissions, first_admissions[1:])]
        span = sum(intervals)
        result["firstAdmissions"] = {"orders": len(first_admissions), "spanMs": round(span / 1000, 1),
                                     "meanOrdersPerSecond": round(1_000_000 * len(intervals) / span, 2) if span else None,
                                     "interarrivalUs": percentiles(intervals)}
    return result


@dataclass
class AuditedRun:
    placement: str
    revision: str
    conditions: tuple
    metrics: dict
    rows: list
    trace: list


def audit_run(directory, scheduler, include_arrivals=False):
    run = read(directory / "contention-windows.json")
    plan = read(directory / "scheduled-offers.json")
    replay = read(directory / "contention-replay.json")
    for key in ("placement", "revision", "build"):
        assert run[key] == plan[key] == replay[key]
    placement = run["placement"]
    assert replay["events"] > 0
    assert [window["wallets"] for window in run["windows"]] == ([12] if scheduler else [1, 12])
    assert len(plan["trace"]) == 48
    normalized = [(row["id"], row["stream"], row["dueMs"], row["side"], row["target"]) for row in plan["trace"]]
    conditions = (run["build"], run["gapMs"], normalized)
    totals = Counter()
    for row in plan["trace"]:
        totals[row["market"]] += int(row["target"])
    if placement == "split":
        assert totals[0] == totals[1] > 0
    else:
        assert set(totals) == {0 if placement == "btc" else 1}
    for window in run["windows"]:
        assert [{key: row[key] for key in plan["trace"][0]} for row in window["entries"]] == plan["trace"]
        assert len({row["wallet"] for row in window["entries"]}) == window["wallets"]
    rows = [row for window in run["windows"] for row in window["entries"]]
    audit_maintenance(directory, run["windows"])
    audit_signed(directory, rows, run["roles"])
    used = verify_consumed_depth(directory, run["roles"], rows)
    result = {"events": replay["events"], "consumedByMaker": used, "windows": [
        summarize(window, run["gapMs"], run["roles"]) for window in run["windows"]]}
    if scheduler:
        binary = (directory / "validator-sha256.txt").read_text().split()[0]
        version = (directory / "validator-version.txt").read_text().strip()
        assert version.startswith("solana-test-validator 4.2.2 (src:c9c6f328;")
        assert [(market["index"], market["status"]) for market in run["windows"][0]["openingMarkets"]] == [(0, 2), (1, 2)]
        conditions += (version, binary)
        result["scheduler"] = native_scheduler(directory, rows, include_arrivals)
    return AuditedRun(placement, run["revision"], conditions, result, rows, plan["trace"])


def wallet_preparation(rows):
    stages, batches = [], {}
    for row in rows:
        if not row["signature"]:
            continue
        reads = row["snapshotReads"]
        assert len(reads) == 4 and [r["accounts"] for r in reads[:3]] == [1, 4, 5]
        assert reads[3]["accounts"] > 5
        previous = row["readyMs"]
        rpc_ms = 0
        for name, read_event in zip(("makerRegistry", "registrations", "marginDiscovery", "coherentSnapshot"), reads):
            start, end = read_event["startMs"], read_event["endMs"]
            assert previous <= start <= end <= row["snapshotEndMs"]
            assert 0 <= read_event["programDataBytes"] <= read_event["dataBytes"]
            batches.setdefault(name, []).append((end - start, read_event))
            previous = end
            rpc_ms += end - start
        landmarks = [row[key] for key in ("snapshotEndMs", "routeEndMs", "blockhashStartMs", "blockhashEndMs", "signedMs")]
        assert sorted(landmarks) == landmarks
        snapshot, route, fetch_start, fetch_end, signed = landmarks
        durations = {"snapshotRpcMs": rpc_ms, "snapshotBetweenReadsMs": previous - row["readyMs"] - rpc_ms,
                     "snapshotAfterLastReadMs": snapshot - previous, "routeConstructionMs": route - snapshot,
                     "beforeBlockhashMs": fetch_start - route, "latestBlockhashMs": fetch_end - fetch_start,
                     "compileSignSerializeMs": signed - fetch_end}
        assert all(ms >= -1e-6 for ms in durations.values())
        assert math.isclose(sum(durations.values()), signed - row["readyMs"], abs_tol=1e-6)
        stages.append(durations)
    assert stages, "No signed order to profile"
    total = sum(sum(order.values()) for order in stages)
    return {"signed": len(stages), "unsigned": len(rows) - len(stages),
            "stages": {name: {**percentiles([order[name] for order in stages]),
                              "percentOfSummedPreparation": round(100 * sum(order[name] for order in stages) / total, 2)}
                       for name in stages[0]},
            "snapshotMs": percentiles([row["snapshotEndMs"] - row["readyMs"] for row in rows if row["signature"]]),
            "reads": {name: {"elapsedMs": percentiles([ms for ms, _ in samples]),
                             **{key: percentiles([read[key] for _, read in samples])
                                for key in ("accounts", "dataBytes", "programDataBytes")}}
                      for name, samples in batches.items()}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directories", type=Path, nargs="+")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--scheduler", action="store_true", help="Audit the three native queue traces")
    mode.add_argument("--preparation", action="store_true", help="Compare a baseline and profiled split-market trace")
    args = parser.parse_args()
    if args.preparation:
        if len(args.directories) != 2:
            parser.error("--preparation requires the baseline and measured split directories")
        baseline, measured = [audit_run(directory, True, include_arrivals=True) for directory in args.directories]
        assert baseline.placement == measured.placement == "split" and baseline.conditions == measured.conditions
        assert baseline.trace == measured.trace, "Scheduled orders differ"
        assert [row["wallet"] for row in baseline.rows] == [row["wallet"] for row in measured.rows]
        result = {"baseline": {"revision": baseline.revision, **baseline.metrics},
                  "measured": {"revision": measured.revision, **measured.metrics},
                  "preparation": wallet_preparation(measured.rows)}
    else:
        if len(args.directories) != 3:
            parser.error("Pass the three matched market directories")
        runs = [audit_run(directory, args.scheduler) for directory in args.directories]
        assert {run.placement for run in runs} == {"btc", "eth", "split"}
        assert all(run.revision == runs[0].revision and run.conditions == runs[0].conditions for run in runs)
        result = {run.placement: run.metrics for run in runs}
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
