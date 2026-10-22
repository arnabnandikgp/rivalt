"""Select cheap hosted CI jobs by the actual stacked PR delta."""
import json
import os
import subprocess


def scope(paths):
    tooling = any(p.startswith(".github/workflows/") or p == "ops/ci-scope.py" for p in paths)
    dependencies = any(p in {"package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json"} for p in paths)
    return {
        "client": tooling or dependencies or any(p.startswith(("apps/", "packages/")) or p.endswith((".ts", ".tsx", ".mjs", ".cjs")) for p in paths),
        "financial": tooling or any(p.startswith(("crates/financial-core/", "scenarios/")) or p in {"Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "ops/financial.sh"} or p.startswith("tests/financial/") for p in paths),
        "report": tooling or any(p.startswith(("tests/e2e/", "tests/load/")) or p.startswith("ops/") and p.endswith(".py") for p in paths),
        "shell": tooling or any(p.startswith("ops/") and p.endswith(".sh") for p in paths),
    }


if __name__ == "__main__":
    base = os.environ["BASE_SHA"]
    # No shell interpolation of branch names, filenames or PR text.
    paths = subprocess.check_output(["git", "diff", "--name-only", "-z", base, "HEAD"]).decode().split("\0")
    selected = scope([p for p in paths if p])
    print(json.dumps({"base": base, "jobs": selected}, indent=2))
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        for name, enabled in selected.items():
            output.write(f"{name}={str(enabled).lower()}\n")
