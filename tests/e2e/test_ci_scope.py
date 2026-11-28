import json
import os
from pathlib import Path
from runpy import run_path
import subprocess
import sys
import tempfile
import tomllib
import unittest

SELECTOR = Path(__file__).resolve().parents[2] / "ops/ci-scope.py"
scope = run_path(str(SELECTOR))["scope"]


class ScopeTests(unittest.TestCase):
    def test_documentation_only_uses_repository_guards(self):
        self.assertEqual(scope(["docs/STATUS.md", "README.md"]), {
            "client": "none", "financial": [], "probes": "", "report": False, "shell": False,
        })

    def test_ui_and_indexer_scope_and_shared_events(self):
        trader = "apps/trader/src/amount.ts"
        indexer = "packages/indexer/src/membership-reconcile.ts"
        for paths, expected in [
            ([trader], "trader"), ([indexer], "indexer"), ([trader, indexer], "full"),
            (["packages/indexer/src/scoped-events.ts"], "full"),
            (["packages/sdk/idl/clearing.json"], "full"), (["vitest.config.ts"], "full"),
            (["tests/anchor-conformance/pnpm-lock.yaml"], "full"), ([".npmrc"], "full"),
        ]:
            with self.subTest(paths=paths):
                selected = scope(paths)
                self.assertEqual(selected["client"], expected)
                self.assertFalse(selected["financial"])

    def test_indexed_settlement_uses_focused_rust_and_python_checks(self):
        for path in [
            "tests/financial/test_indexed_default_wire.py",
            "tests/financial/test_indexed_market_priority.py",
            "crates/default-plan-selection/src/market_indexed/mod.rs",
            "crates/default-plan-selection/tests/funded_listed_episode.rs",
        ]:
            with self.subTest(path=path):
                self.assertEqual(scope([path])["financial"], ["indexed"])
        handler = "programs/clearing/src/instructions/account_safety/resolution/listed/settlement.rs"
        self.assertEqual(scope([handler])["financial"], ["clearing", "indexed"])

    def test_shared_economics_preserves_broad_coverage(self):
        for path in ("crates/clearing-accounting/src/lib.rs", "crates/risk-engine/src/lib.rs",
                     "crates/financial-core/src/settlement.rs", "Cargo.lock"):
            self.assertEqual(scope([path])["financial"], ["clearing", "indexed", "makers", "pages", "reference"])
        self.assertEqual(scope(["crates/settlement-transport/src/lib.rs"])["financial"], ["pages"])
        self.assertEqual(scope(["programs/maker-a/src/lib.rs"])["financial"], ["makers"])
        self.assertEqual(scope(["crates/clearing-accounting/src/price_policy.rs"])["client"], "full")

    def test_probe_only_changes_select_the_changed_native_packages(self):
        selected = scope(["tests/fixtures/hostile-maker/src/lib.rs", "tests/programs/frozen-plan/src/lib.rs"])
        self.assertEqual(selected["probes"], "frozen-plan-probe hostile-maker")
        self.assertEqual(selected["financial"], [])
        self.assertEqual(selected["client"], "none")

    def test_every_workspace_crate_selects_a_native_check(self):
        workspace = tomllib.loads((SELECTOR.parents[1] / "Cargo.toml").read_text())["workspace"]
        for member in workspace["members"]:
            with self.subTest(member=member):
                selected = scope([f"{member}/Cargo.toml"])
                self.assertTrue(selected["financial"] or selected["probes"])

    def test_workflow_and_root_configuration(self):
        for path in (".github/workflows/pr-checks.yml", "ops/ci-scope.py"):
            selected = scope([path])
            self.assertEqual(selected["client"], "full")
            self.assertTrue(selected["report"] and selected["shell"])
            self.assertEqual(selected["financial"], scope(["Anchor.toml"])["financial"])
            self.assertEqual(len(selected["probes"].split()), 5)
        self.assertTrue(scope(["tests/load/reference.py"])["report"])
        self.assertTrue(scope(["ops/scalable-settlement-smoke.sh"])["shell"])

    def test_rename_selects_both_domains_through_actions_output(self):
        with tempfile.TemporaryDirectory() as directory:
            def git(*args):
                subprocess.run(["git", "-c", "user.name=CI", "-c", "user.email=ci@example.invalid",
                                "-c", "commit.gpgsign=false", *args], cwd=directory, check=True, capture_output=True)
            root = Path(directory)
            old = root / "apps/trader/old file.ts"
            new = root / "tests/programs/frozen-plan/src/new file.rs"
            git("init")
            old.parent.mkdir(parents=True)
            old.write_text("unchanged bytes")
            git("add", ".")
            git("commit", "-m", "parent")
            new.parent.mkdir(parents=True)
            old.rename(new)
            git("add", "-A")
            git("commit", "-m", "move")
            output = root / "outputs"
            subprocess.run([sys.executable, str(SELECTOR)], cwd=directory, check=True, capture_output=True,
                           env=dict(os.environ, BASE_SHA="HEAD^", GITHUB_OUTPUT=str(output)))
            values = dict(line.split("=", 1) for line in output.read_text().splitlines())
            self.assertEqual(values["client"], "trader")
            self.assertEqual(values["probes"], "frozen-plan-probe")
            self.assertEqual(json.loads(values["financial"]), [])
