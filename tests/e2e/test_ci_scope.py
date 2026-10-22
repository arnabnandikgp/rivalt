import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("ci_scope", Path(__file__).resolve().parents[2] / "ops/ci-scope.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ScopeTests(unittest.TestCase):
    def test_docs_do_not_trigger_financial_or_client_checks(self):
        self.assertFalse(any(module.scope(["docs/WORKLOG.md", "README.md"]).values()))

    def test_ui_changes_do_not_trigger_unrelated_economics(self):
        result = module.scope(["apps/trader/src/App.tsx"])
        self.assertTrue(result["client"])
        self.assertFalse(result["financial"])

    def test_report_and_financial_domains_stay_separate(self):
        self.assertEqual(module.scope(["tests/e2e/matrix.py"]), {"client": False, "financial": False, "report": True, "shell": False})
        self.assertTrue(module.scope(["crates/financial-core/src/lib.rs"])["financial"])

    def test_workflow_definition_exercises_its_own_jobs(self):
        self.assertTrue(all(module.scope([".github/workflows/pr-checks.yml"]).values()))
