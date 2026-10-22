"""Independent evidence checks. No SDK, indexer or Rust arithmetic is imported."""
from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from pathlib import Path

STAGES = {
    "checks": "ops/checks.sh", "regression": "ops/rpc-smoke.sh",
    "lifecycle": "ops/lifecycle-smoke.sh", "oracle": "ops/oracle-smoke.sh",
    "orders": "ops/orders-smoke.sh", "resolution": "ops/resolution-smoke.sh",
    "browser": "ops/browser-smoke.sh",
}
SCENARIOS = [
    ("A01", "Stack, SDK and signed RPC", ["regression/summary.json"]),
    ("A02", "Cash, claims and custody", ["regression/financial.json", "regression/custody.json"]),
    ("A03", "Maker interface and capital", ["regression/maker-rpc.json"]),
    ("A04", "Atomic one/two-maker routes", ["regression/route-rpc.json"]),
    ("A05", "Quote races and current authority", ["regression/route-rpc.json", "lifecycle/lifecycle.json"]),
    ("A06", "Indexer, database and reset recovery", ["regression/indexer-rpc.json", "regression/indexer-reset.json"]),
    ("A07", "Complete funded lifecycle", ["lifecycle/lifecycle.json"]),
    ("A08", "Ambiguous submit and restart", ["lifecycle/lifecycle.json"]),
    ("A09", "Authenticated source failures", ["oracle/oracle.json", "oracle/oracle-svm.json"]),
    ("A10", "Funding gaps and turnover", ["oracle/oracle.json", "oracle/oracle-svm.json"]),
    ("A11", "Persistent orders and races", ["orders/orders.json", "orders/order-svm.json"]),
    ("A12", "Existing-position TP/SL", ["orders/orders.json", "orders/order-svm.json", "browser/browser.json"]),
    ("A13", "Funded liquidation", ["resolution/resolution.json", "resolution/resolution-svm.json"]),
    ("A14", "Complete-cohort default", ["resolution/resolution.json", "resolution/resolution-svm.json"]),
    ("A15", "Wallet UI and API-stopped exits", ["browser/browser.json"]),
]
# Stable observations, checked against the actual harness's completed assertions.
# These are fault definitions, not saved outcomes or transferred historical counts.
FAULTS = {
    "lost-ack-and-executor-kill": ("lifecycle/lifecycle.json", "lost acknowledgement plus SIGKILL/restart"),
    "maker-outage": ("lifecycle/lifecycle.json", "maker A outage excluded"),
    "competing-settlement-workers": ("lifecycle/lifecycle.json", "keeper restart and competing workers"),
    "unknown-expired-deposit": ("lifecycle/lifecycle.json", "expired deposit without monotonic authority remains unresolved"),
    "hidden-failed-fee": ("lifecycle/lifecycle.json", "hidden failed landing cannot release fee reservation"),
    "sql-rollback": ("regression/indexer-rpc.json", "projection/events/outbox/checkpoint roll back together"),
    "duplicate-reordered-events": ("regression/indexer-rpc.json", "duplicate/reordered finalized observations"),
    "rpc-history-gap": ("regression/indexer-rpc.json", "pruned history explicitly blocks readiness"),
    "rpc-metadata-gap": ("regression/indexer-rpc.json", "missing transaction metadata fails closed"),
    "ws-disconnect": ("regression/indexer-rpc.json", "WS disconnect reconnects"),
    "database-restart": ("regression/indexer-rpc.json", "PostgreSQL process restart preserves"),
    "database-rebuild": ("regression/indexer-rpc.json", "fresh PostgreSQL database rebuilt"),
    "chain-reset-isolation": ("regression/indexer-reset.json", "original projection unchanged"),
    "source-maker-outage": ("oracle/oracle.json", "required-maker outage records invalid observations"),
    "funding-worker-outage": ("oracle/oracle.json", "worker outage derives restrictive mode"),
    "stale-authenticated-source": ("oracle/oracle.json", "stale authenticated sources block valuation"),
    "competing-order-workers": ("orders/orders.json", "persisted keeper bytes and two discovery processes"),
    "withdrawal-fill-races": ("orders/orders.json", "both withdrawal/fill races"),
    "protective-generation": ("orders/orders.json", "close/reopen invalidates old protection"),
    "frozen-default-restart": ("resolution/resolution.json", "two keepers stop between pages"),
    "default-source-emergency": ("resolution/resolution.json", "actual source outage retains zero pinned price"),
    "browser-reload": ("browser/browser.json", "browser reload reconcile the original signed deposit"),
    "venue-api-stopped": ("browser/browser.json", "actual venue API process stopped"),
}
STATE_REPORTS = {
    "regression/indexer-rpc.json": "finalState", "lifecycle/lifecycle.json": "state",
    "oracle/oracle.json": "final", "orders/orders.json": "final",
    "resolution/resolution.json": "final", "browser/browser.json": "projection",
}
PROGRAMS = ["clearing", "maker_a", "maker_b", "oracle_fixture", "hostile_maker"]


def require(ok, message):
    if not ok:
        raise ValueError(message)


def integer(value):
    require(isinstance(value, str) and re.fullmatch(r"-?(0|[1-9][0-9]{0,99})", value),
            "financial values must be decimal integer strings")
    return int(value)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def source_identity(value, revision):
    require(isinstance(value, dict) and value.get("revision") == revision, "stale or absent source revision")
    require(value.get("sourceDirty") is False, "dirty or absent source identity")
    # Resolution contains independently generated signed subruns; validate those too.
    def visit(x):
        if isinstance(x, dict):
            if "revision" in x or "sourceDirty" in x:
                require(x.get("revision") == revision and x.get("sourceDirty") is False, "nested stale/dirty evidence")
            for child in x.values():
                visit(child)
        elif isinstance(x, list):
            for child in x:
                visit(child)
    visit(value)


def reconcile(state, actual_vault, cohort, surplus="0"):
    """I01/I02/I03 at a common M/F; sum(q)=0 cancels common mark/funding terms."""
    market, participants = state["market"], state["participants"]
    require(isinstance(cohort, list) and 1 <= len(cohort) <= 64, "missing/invalid chain cohort")
    require(len(cohort) == len(set(cohort)) and set(cohort) == set(participants), "incomplete/aliased participant cohort")
    require(len({p["id"] for p in participants.values()}) == len(cohort), "duplicate stable participant IDs")
    cash = sum(integer(p["cash"]) for p in participants.values())
    lots = sum(integer(p["lots"]) for p in participants.values())
    gross = sum(abs(integer(p["lots"])) for p in participants.values())
    claims = sum(integer(p["virtualScaled"]) + integer(p["lots"]) * integer(p["fundingCheckpointScaled"])
                 for p in participants.values())
    require(all(integer(p["cash"]) >= 0 and integer(p["reserved"]) >= 0 for p in participants.values()), "negative cash/reserve")
    pools = [integer(market[k]) for k in ["settlement", "insurance", "fees"]]
    require(all(p >= 0 for p in pools), "negative pool")
    allocated, actual, extra = integer(market["allocatedVault"]), integer(actual_vault), integer(surplus)
    require(cash == integer(market["totalCash"]), "participant cash != market cash")
    require(cash + sum(pools) == allocated and extra >= 0 and allocated + extra == actual, "cash/pools/actual vault mismatch")
    require(lots == 0, "net exposure != zero")
    require(gross == integer(market["grossLots"]), "gross exposure mismatch")
    require(claims == pools[0] * 1_000_000_000, "fully accrued claims != settlement cash")
    return {"participants": len(cohort), "cashAtoms": str(cash), "netLots": str(lots), "grossLots": str(gross),
            "claimsScaled": str(claims), "settlementAtoms": str(pools[0]), "insuranceAtoms": str(pools[1]),
            "feeAtoms": str(pools[2]), "actualVaultAtoms": str(actual), "unallocatedSurplusAtoms": str(extra), "status": "pass"}


def state_check(report, key):
    state = report[STATE_REPORTS[key]]
    if "reconciliation" in report:
        r = report["reconciliation"]
        require(r["participants"] == len(state["participants"]), "chain participant count mismatch")
        require(str(r["sequence"]) == state["sequence"], "chain checkpoint mismatch")
        # Indexer.reconcile independently enumerates the actual registry and verifies each account.
        cohort, vault, surplus = list(state["participants"]), r["actualVault"], r["unallocatedSurplus"]
    elif key.startswith("browser/"):
        chain = report["final"]
        cohort, vault, surplus = chain["members"], chain["actualVault"], "0"
        require(state["sequence"] == chain["m"]["sequence"], "browser checkpoint mismatch")
        for member in cohort:
            for field in ["cash", "lots", "virtualScaled", "fundingCheckpointScaled", "reserved", "generation", "nonce"]:
                require(state["participants"][member][field] == chain["participants"][member][field], "browser projection differs from chain")
    else:
        cohort, vault, surplus = report["cohort"], report["vault"], "0"
    return reconcile(state, vault, cohort, surplus)


def populations(report, key):
    result = {}
    signed = [c for c in report.get("checks", []) if isinstance(c, dict) and "status" in c]
    if signed:
        require(all(c["status"] in ["pass", "rejected"] for c in signed), "invalid signed scenario outcome")
        if not key.endswith("-svm.json"):
            require(all(c.get("signature") for c in signed), "RPC scenario has no signature")
        result["signedCases"] = signed
        result["signedCounts"] = dict(Counter(c["status"] for c in signed))
    for name in ["intents", "walletSignatures", "signedRejections", "unsignedRejections"]:
        if name in report:
            result[name] = report[name]
    if "intents" in result:
        allowed = {"pending", "unresolved", "finalized", "failed", "expired-unexecuted"}
        require(all(x["status"] in allowed and x.get("signature") and x.get("wireSha256") for x in result["intents"]), "invalid durable intent outcome")
        result["intentCounts"] = dict(Counter(x["status"] for x in result["intents"]))
    if key in STATE_REPORTS:
        state = report[STATE_REPORTS[key]]
        result["orders"] = [{"participant": address, **order} for address, p in state["participants"].items()
                            for order in p.get("book", {}).get("orders", []) if order["id"] != "0"]
    # These populations are not eligible-normal throughput denominators.
    return result


def validate_report(value, key, revision, binaries):
    source_identity(value, revision)
    if "result" in value and isinstance(value["result"], str):
        require(value["result"] == "pass", "reported non-passing result")
    if key not in {"regression/summary.json", "regression/financial.json", "resolution/resolution-svm.json"}:
        require(isinstance(value.get("checks"), list) and value["checks"], "missing observations")
    if key == "regression/financial.json":
        require(value.get("result") == "pass" and value.get("seed") == "0x524956414c54", "missing independent reference proof")
        require(all(isinstance(value.get(k), int) and value[k] > 0 for k in ["allocation_cases", "funding_cases", "default_cases"]), "empty independent reference population")
    if "binaries" in value:
        for name, sha in value["binaries"].items():
            require(binaries.get(name) == sha, f"binary identity mismatch: {name}")
    if "binarySha256" in value:
        require(value["binarySha256"] == binaries.get("clearing"), "clearing binary mismatch")
    for budget in value.get("budgets", []):
        require(0 <= integer(budget["spent"]) + integer(budget["committed"]) <= integer(budget["cap"]), "operator budget overflow")
    if key == "regression/summary.json":
        require(value["signatureVerification"] is True and value["blockhashVerification"] is True, "verification disabled")
        for name in ["independentSignatureVerification", "legacyLiveDecode", "failedTransactionRollback"]:
            require(value[name] == "pass", f"missing RPC proof: {name}")
    if key == "resolution/resolution-svm.json":
        require(value["pageEquivalence"] is True, "missing legal-page equivalence")
        results = value["results"]
        require({(r["pageSize"], r["cohortSize"], r["emergency"]) for r in results} ==
                {(1, 5, False), (2, 5, False), (3, 5, False), (4, 5, False), (4, 64, True)}, "missing legal page/full cohort case")
        expected = [r["result"]["expected"] for r in results if r["cohortSize"] == 5]
        require(all(r == expected[0] for r in expected), "legal page payout disagreement")
        for child in results:
            validate_report(child, "resolution/page-svm.json", revision, binaries)
    if key == "browser/browser.json":
        require(value["errors"] == [], "browser/source errors")
        counts = Counter(x["status"] for x in value["walletSignatures"])
        require(counts["finalized"] > 0 and counts["unresolved"] > 0, "browser missing success/ambiguous population")
    if key == "lifecycle/lifecycle.json":
        statuses = {x["status"] for x in value["intents"]}
        require({"finalized", "failed", "unresolved", "expired-unexecuted"} <= statuses, "missing lifecycle outcome populations")
    if key in STATE_REPORTS:
        metrics = value.get("metrics", value.get("firstMetrics", {}))
        require(metrics.get("notifications", 0) > 0, "no actual WS notifications")
        return state_check(value, key)
    return None


def build_report(root, run):
    """Never infer pass from absent files, earlier runs or an interrupted command."""
    root = Path(root)
    cache, errors, reconciliations, observed, hashes, paths = {}, {}, {}, {}, {}, {}
    stages = run["stages"]
    wanted = set(k for _, _, keys in SCENARIOS for k in keys) | set(STATE_REPORTS)
    for key in sorted(wanted):
        stage = key.split("/")[0]
        if stages[stage]["status"] != "pass":
            continue
        try:
            path = root / stages[stage].get("directory", f"runs/{stage}") / Path(key).name
            expected = stages[stage]["files"].get(Path(key).name)
            require(expected and digest(path) == expected, "missing or changed report artifact")
            value = json.loads(path.read_text())
            for field, source in [("idlSha256", "packages/sdk/idl/clearing.json"),
                                  ("cargoLockSha256", "Cargo.lock"), ("pnpmLockSha256", "pnpm-lock.yaml")]:
                if field in value:
                    require(value[field] == run.get("identities", {}).get(source), f"IDL/lock identity mismatch: {source}")
            reconciled = validate_report(value, key, run["revision"], run["binaries"])
            cache[key], hashes[key] = value, expected
            paths[key] = str(path.relative_to(root))
            observed[key] = populations(value, key)
            if reconciled:
                reconciliations[key] = reconciled
        except (OSError, ValueError, KeyError, TypeError) as e:
            errors[key] = str(e)
    rows = []
    for identifier, name, keys in SCENARIOS:
        direct = {k.split("/")[0] for k in keys} | ({"checks"} if identifier == "A01" else set())
        needed = {"checks"} | direct
        failed = [s for s in direct if stages[s]["status"] == "fail"]
        incomplete = [s for s in needed if stages[s]["status"] != "pass"]
        reasons = [f"{k}: {errors[k]}" for k in keys if k in errors]
        status = "fail" if failed or reasons else "not-run" if incomplete else "pass"
        rows.append({"id": identifier, "scenario": name, "status": status, "evidence": keys,
                     "reasons": reasons + [f"stage {s}: {stages[s]['status']}" for s in sorted(incomplete)]})
    faults = []
    for name, (key, fragment) in FAULTS.items():
        matches = [s for s in cache.get(key, {}).get("checks", []) if isinstance(s, str) and fragment in s]
        status = "pass" if matches else "fail" if key in cache or key in errors else "not-run"
        faults.append({"fault": name, "status": status, "evidence": key, "observation": matches})
    dirty = run.get("sourceDirty", False)
    all_pass = not dirty and all(r["status"] == "pass" for r in rows + faults) and len(reconciliations) == len(STATE_REPORTS)
    status = "pass" if all_pass else "fail" if dirty or errors or any(r["status"] == "fail" for r in rows + faults) else "not-run"
    rows.append({"id": "A16", "scenario": "Integrated fault matrix and independent conservation", "status": status,
                 "reasons": list(errors.values()) + (["Source changed during acceptance"] if dirty else []) + ([] if all_pass else ["Requires every A01–A15 row, fault observation and all six reconciliations"] )})
    rows.extend({"id": f"A{n}", "scenario": name, "status": "not-run", "reasons": ["Separate phase; not claimed by P11"]}
                for n, name in [(17, "Load and real 24-hour soak"), (18, "Real dependency verification"),
                                (19, "Devnet parity"), (20, "Independent maker"), (21, "Funded pilot review")])
    return {"revision": run["revision"], "sourceDirty": run.get("sourceDirty", False), "result": status, "scenarios": rows,
            "faults": faults, "reconciliations": reconciliations, "populations": observed, "reportHashes": hashes, "reportPaths": paths,
            "limitations": ["Controlled local source/maker/wallet profile", "No load, soak, real-cluster or independent-review claim",
                            "Fault populations are separate from normal eligible execution performance"]}


def markdown(report):
    lines = [f"# Integrated acceptance — {report['result']}", "", f"Source: `{report['revision']}`", "",
             "| Scenario | Result | Evidence / reason |", "|---|---|---|"]
    for row in report["scenarios"]:
        detail = "; ".join(row.get("reasons", [])) or ", ".join(row.get("evidence", []))
        lines.append(f"| {row['id']} {row['scenario']} | {row['status']} | {detail} |")
    lines.extend(["", "`matrix.json` retains faults, independent balances and all outcome populations.", ""])
    return "\n".join(lines)
