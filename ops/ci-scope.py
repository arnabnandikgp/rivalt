"""Select hosted checks from both sides of the stacked PR delta."""
import json
import os
import subprocess
from pathlib import PurePosixPath


CLIENT_INPUTS = {
    ".npmrc", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "vitest.config.ts",
    "crates/clearing-accounting/src/price_policy.rs", "ops/generate-price-policy.py",
    "tests/financial/check_liquidity_allocation.py", "tests/financial/check_maker_curve_parity.py",
    "tests/financial/maker_curve_reference.py", "tests/financial/test_maker_curve_contract.py",
}
SHARED_FINANCIAL = {"reference", "clearing", "makers", "pages", "indexed"}
RUST_CONFIG = {"Anchor.toml", "Cargo.toml", "Cargo.lock", "rust-toolchain.toml"}
PROBES = {
    "tests/fixtures/clearing-math/": "clearing-math-probe",
    "tests/fixtures/hostile-maker/": "hostile-maker",
    "tests/fixtures/oracle/": "oracle-fixture",
    "tests/programs/default-proof/": "default-proof-probe",
    "tests/programs/frozen-plan/": "frozen-plan-probe",
}
INDEXED_PATHS = ("crates/default-plan-selection/src/market_indexed/",
                 "crates/default-plan-selection/tests/funded_listed_episode.rs",
                 "tests/financial/indexed_default_certificate.py",
                 "tests/financial/test_indexed_default_wire.py",
                 "tests/financial/test_indexed_market_priority.py")
SETTLEMENT = "programs/clearing/src/instructions/account_safety/"


def client_scope(paths, tooling):
    clients = set()
    for path in paths:
        if path.startswith("apps/trader/"):
            clients.add("trader")
        elif path.startswith("packages/indexer/"):
            # A shared event encoder or decoder can affect consumers across workspaces.
            if PurePosixPath(path).name in {"events.ts", "account-events.ts", "scoped-events.ts"}:
                return "full"
            clients.add("indexer")
        elif (path in CLIENT_INPUTS or path.endswith((".ts", ".tsx", ".mjs", ".cjs"))
              or path.startswith(("apps/", "packages/", "tests/anchor-conformance/",
                                  "tests/anchor-rc2-conformance/", "tests/performance/baselines/"))
              or (path.startswith("tests/fixtures/") and not path.startswith(tuple(PROBES)))):
            return "full"
    if tooling or len(clients) > 1:
        return "full"
    return next(iter(clients), "none")


def scope(paths):
    paths = [path for path in paths if not path.endswith(".md")]
    tooling = any(path.startswith(".github/workflows/") or path == "ops/ci-scope.py" for path in paths)
    shared = tooling or bool(RUST_CONFIG.intersection(paths))
    checks = set()
    probes = set()
    if shared:
        checks.update(SHARED_FINANCIAL)
        probes.update(PROBES.values())

    for path in paths:
        if path.startswith(INDEXED_PATHS):
            checks.add("indexed")
        elif path.startswith(("crates/financial-core/", "crates/risk-engine/", "crates/clearing-accounting/",
                              "crates/default-plan-selection/")):
            checks.update(SHARED_FINANCIAL)
        elif path.startswith("crates/maker-interface/"):
            checks.update(("reference", "makers", "clearing"))
        elif path.startswith("crates/settlement-transport/"):
            checks.add("pages")
        elif path.startswith("programs/clearing/"):
            checks.add("clearing")
            if (path.startswith((SETTLEMENT + "resolution/", SETTLEMENT + "settlement/"))
                    or "/listed" in path or not path.startswith("programs/clearing/src/instructions/")):
                checks.add("indexed")
        elif path.startswith(("programs/maker-a/", "programs/maker-b/")):
            checks.add("makers")
        elif path.startswith(("scenarios/", "tests/financial/")) or path in {"ops/financial.sh", "ops/env.sh"}:
            checks.update(("reference", "indexed"))
        for directory, package in PROBES.items():
            if path.startswith(directory):
                probes.add(package)

    return {
        "client": client_scope(paths, tooling),
        "financial": sorted(checks),
        "probes": " ".join(sorted(probes)),
        "report": tooling or any(path.startswith(("tests/e2e/", "tests/load/")) or
                                 path.startswith("ops/") and path.endswith(".py") for path in paths),
        "shell": tooling or any(path.startswith("ops/") and path.endswith(".sh") for path in paths),
    }


def changed_paths(base, head):
    # A move between components affects consumers of the old and new paths.
    names = subprocess.check_output(["git", "diff", "--no-renames", "--name-only", "-z", base, head])
    return [os.fsdecode(name) for name in names.split(b"\0") if name]


if __name__ == "__main__":
    base = os.environ["BASE_SHA"]
    selected = scope(changed_paths(base, "HEAD"))
    print(json.dumps({"base": base, "checks": selected}, indent=2))
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        for name, value in selected.items():
            encoded = value if isinstance(value, str) else json.dumps(value)
            print(f"{name}={encoded}", file=output)
