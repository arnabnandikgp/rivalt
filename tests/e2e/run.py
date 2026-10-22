#!/usr/bin/env python3
"""P11's explicit broad local matrix; not an automatic pre-PR requirement."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import platform
import signal
import subprocess
import sys
import time
from pathlib import Path

from matrix import PROGRAMS, STAGES, build_report, digest, markdown, require

REPO = Path(__file__).resolve().parents[2]


def git(*args):
    return subprocess.check_output(["git", *args], cwd=REPO, text=True).strip()


def write(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def identities():
    names = ["Cargo.lock", "pnpm-lock.yaml", "tests/anchor-conformance/pnpm-lock.yaml", "rust-toolchain.toml",
             "ops/toolchain-downloads.json", "tests/e2e/matrix.py", "ops/local-keys.mjs"]
    names += sorted(str(p) for folder in ["scenarios", "packages/sdk/idl"] for p in Path(folder).glob("*.json"))
    names += sorted(str(p) for folder in ["tests/e2e", "tests/financial"] for p in Path(folder).glob("*.py"))
    names += sorted(str(p) for p in Path("tests/rpc-contract").glob("*-cases.ts"))
    return {name: digest(name) for name in sorted(set(names))}


def execute(command, log, env, timeout):
    # A separate process group permits scoped cancellation, including service children.
    with log.open("wb") as output:
        process = subprocess.Popen(command, cwd=REPO, env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            return process.wait(timeout=timeout)
        except BaseException:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=list(STAGES), help="Target one rerunnable stage; other scenarios explicitly remain not-run")
    args = parser.parse_args()
    os.chdir(REPO)
    revision = git("rev-parse", "HEAD")
    require(not git("status", "--porcelain"), "Commit the coherent source before acceptance; dirty runs are not evidence")
    require(os.environ.get("RIVALT_SLOT_TIME", "50") == "50", "P11's verified integrated profile requires 50 ms slots")
    run_id = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + f"-{os.getpid()}"
    root = Path(".local/matrix") / run_id
    root.mkdir(parents=True, exist_ok=False)
    (root / "runs").mkdir()
    run = {"schema": 1, "runId": run_id, "revision": revision, "sourceDirty": False, "selectedStage": args.stage,
           "startedUtc": dt.datetime.now(dt.timezone.utc).isoformat(), "host": {"system": platform.system(), "machine": platform.machine(), "release": platform.release(), "python": platform.python_version()},
           "configuration": {"slotTimeMs": 50, "fundingIntervalSeconds": 2, "browserFundingIntervalSeconds": 5,
                             "rpcPort": int(os.environ.get("RIVALT_RPC_PORT", "18899")), "wsPort": int(os.environ.get("RIVALT_WS_PORT", "18900")),
                             "postgresPort": int(os.environ.get("RIVALT_PG_PORT", "15432")), "resetApiPort": int(os.environ.get("RIVALT_RESET_API_PORT", "18082")),
                             "rpc": "loopback HTTP", "ws": "loopback WS", "postgres": "18.6 Apple Containers", "load": "sequential functional/fault scenarios, not offered-load benchmark"},
           "seeds": {"economicReference": "0x524956414c54", "programKeys": "SHA256 rivalt/p01/local-only/<role>",
                     "actorKeys": "SHA256 rivalt/p02/local-only/<role>", "faults": "ordered explicit observations in tests/e2e/matrix.py",
                     "replayLimit": "Actual chain wall time and signatures vary; replay preserves deterministic fixtures, fault order and assertions"},
           "identities": identities(), "binaries": {}, "stages": {s: {"status": "not-run", "command": ["bash", script],
             "directory": f"runs/{run_id}-{s}", "files": {}} for s, script in STAGES.items()}}
    started = time.monotonic()

    def checkpoint():
        run["elapsedSeconds"] = round(time.monotonic() - started, 3)
        write(root / "run.json", run)
        report = build_report(root, run)
        write(root / "matrix.json", report)
        (root / "matrix.md").write_text(markdown(report))
        return report

    def interrupt(_signum, _frame):
        raise InterruptedError("Matrix interrupted; remaining scenarios are not-run")

    signal.signal(signal.SIGTERM, interrupt)
    checkpoint()
    print(f"Matrix evidence: {root}", flush=True)
    for stage, script in STAGES.items():
        if args.stage and stage != args.stage:
            continue
        row = run["stages"][stage]
        row.update(status="running", startedUtc=dt.datetime.now(dt.timezone.utc).isoformat())
        checkpoint()
        print(f"Starting {stage}: bash {script}", flush=True)
        before = time.monotonic()
        try:
            require(git("rev-parse", "HEAD") == revision and not git("status", "--porcelain"), "Source changed during acceptance")
            env = {**os.environ, "RIVALT_SLOT_TIME": "50", "RIVALT_FUNDING_INTERVAL_SECONDS": "2", "RIVALT_RUN_DIR": str(root / row["directory"])}
            row["exit"] = execute(["bash", script], root / f"{stage}.log", env, 3600)
            require(row["exit"] == 0, f"{stage} command exited {row['exit']}; see {stage}.log")
            require(git("rev-parse", "HEAD") == revision and not git("status", "--porcelain"), "Source changed during acceptance")
            require(identities() == run["identities"], "Configuration/IDL/lock/fixture identity changed")
            binaries = {n: digest(f"target/deploy/{n}.so") for n in PROGRAMS}
            require(not run["binaries"] or binaries == run["binaries"], "Program binaries changed between environments")
            run["binaries"] = binaries
            directory = root / row["directory"]
            # Hash public report filenames only. Keys, env files, DB volumes and deployment buffers are never listed.
            public = ["summary.json", "financial.json", "svm.json", "maker-svm.json", "route-svm.json", "settlement-svm.json",
                      "oracle-svm.json", "order-svm.json", "resolution-svm.json", "custody.json", "maker-rpc.json", "route-rpc.json",
                      "indexer-rpc.json", "indexer-reset.json", "lifecycle.json", "oracle.json", "orders.json", "resolution.json",
                      "browser.json", "browser-transactions.json", "toolchain.json", "postgres-version.txt", "postgres-image.json", "container-version.txt"]
            row["files"] = {name: digest(directory / name) for name in public if (directory / name).exists()}
            row["status"] = "pass"
        except (Exception, KeyboardInterrupt) as e:
            row.update(status="fail", reason=str(e), exit=row.get("exit", 130 if isinstance(e, KeyboardInterrupt) else 1))
            print(f"Failed {stage}: {e}", flush=True)
        finally:
            run["sourceDirty"] = bool(git("status", "--porcelain")) or git("rev-parse", "HEAD") != revision
            row.update(elapsedSeconds=round(time.monotonic() - before, 3), finishedUtc=dt.datetime.now(dt.timezone.utc).isoformat())
            row["logSha256"] = digest(root / f"{stage}.log") if (root / f"{stage}.log").exists() else None
            report = checkpoint()
        if row["status"] == "fail":
            break
        # A completed command with corrupt/missing evidence must stop too.
        owned = [r for r in report["scenarios"] if r["status"] == "fail"]
        if owned:
            print(f"Evidence validation failed: {owned}", flush=True)
            break
        print(f"Passed {stage}; report updated", flush=True)
    run["finishedUtc"] = dt.datetime.now(dt.timezone.utc).isoformat()
    report = checkpoint()
    print(f"Matrix {report['result']}: {root / 'matrix.md'}", flush=True)
    if args.stage:
        return 0 if run["stages"][args.stage]["status"] == "pass" and report["result"] != "fail" else 1
    return 0 if report["result"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
