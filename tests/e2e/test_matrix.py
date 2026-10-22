import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from matrix import STAGES, build_report, digest, populations, reconcile, source_identity, validate_report
from run import execute

REVISION = "a" * 40


def book():
    # Hand-calculated: q=(2,-2), checkpoints=(.1,.3), v=(-10,13.4).
    # Aggregate accrued claims = -10 + 13.4 + .2 - .6 = 3 atoms.
    return {"sequence": "8", "market": {"totalCash": "300", "settlement": "3", "insurance": "5",
            "fees": "7", "allocatedVault": "315", "grossLots": "4"}, "participants": {
        "alice": {"id": 0, "cash": "100", "lots": "2", "virtualScaled": "-10000000000", "fundingCheckpointScaled": "100000000", "reserved": "0"},
        "maker": {"id": 1, "cash": "200", "lots": "-2", "virtualScaled": "13400000000", "fundingCheckpointScaled": "300000000", "reserved": "0"}}}


class ConservationTests(unittest.TestCase):
    def test_nonzero_pool_and_different_lazy_checkpoints(self):
        result = reconcile(book(), "315", ["maker", "alice"])
        self.assertEqual(result["claimsScaled"], "3000000000")
        self.assertEqual(result["grossLots"], "4")

    def test_one_scaled_unit_drift_is_not_rounded_away(self):
        state = book()
        state["participants"]["maker"]["virtualScaled"] = "13400000001"
        with self.assertRaisesRegex(ValueError, "fully accrued"):
            reconcile(state, "315", ["alice", "maker"])

    def test_wrong_checkpoint_cannot_be_ignored(self):
        state = book()
        state["participants"]["maker"]["fundingCheckpointScaled"] = "0"
        with self.assertRaisesRegex(ValueError, "fully accrued"):
            reconcile(state, "315", ["alice", "maker"])

    def test_missing_or_aliased_cohort_member(self):
        for members in [["alice"], ["alice", "alice"]]:
            with self.assertRaisesRegex(ValueError, "cohort"):
                reconcile(book(), "315", members)

    def test_exact_vault_and_explicit_surplus(self):
        with self.assertRaisesRegex(ValueError, "vault"):
            reconcile(book(), "316", ["alice", "maker"])
        self.assertEqual(reconcile(book(), "316", ["alice", "maker"], "1")["unallocatedSurplusAtoms"], "1")

    def test_net_exposure_cash_and_gross_checks_are_separate(self):
        for target, field, value, reason in [("alice", "lots", "3", "net exposure"),
                                              ("alice", "cash", "101", "market cash")]:
            state = book()
            state["participants"][target][field] = value
            with self.assertRaisesRegex(ValueError, reason):
                reconcile(state, "315", ["alice", "maker"])
        state = book()
        state["market"]["grossLots"] = "0"
        with self.assertRaisesRegex(ValueError, "gross exposure"):
            reconcile(state, "315", ["alice", "maker"])

    def test_no_float_or_unsafe_json_number_settlement(self):
        for value in [100, 100.0, "100.0", "1e2", "NaN"]:
            state = book()
            state["participants"]["alice"]["cash"] = value
            with self.assertRaisesRegex(ValueError, "decimal integer"):
                reconcile(state, "315", ["alice", "maker"])


class EvidenceTests(unittest.TestCase):
    def test_failed_command_retains_exit_and_log(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "failure.log"
            code = execute([sys.executable, "-c", "print('injected stage failure'); raise SystemExit(7)"], log, os.environ.copy(), 5)
            self.assertEqual(code, 7)
            self.assertIn("injected stage failure", log.read_text())

    def test_timed_out_stage_is_stopped(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "timeout.log"
            with self.assertRaises(subprocess.TimeoutExpired):
                execute([sys.executable, "-c", "import os,time; print(os.getpid(),flush=True); time.sleep(30)"], log, os.environ.copy(), .5)
            with self.assertRaises(ProcessLookupError):
                os.kill(int(log.read_text().strip()), 0)

    def test_old_dirty_and_nested_source_are_rejected(self):
        for value in [{"revision": "b" * 40, "sourceDirty": False}, {"revision": REVISION, "sourceDirty": True},
                      {"revision": REVISION}, {"revision": REVISION, "sourceDirty": False, "subrun": {"revision": "b" * 40, "sourceDirty": False}}]:
            with self.assertRaises(ValueError):
                source_identity(value, REVISION)

    def test_wrong_binary_is_not_a_new_pass(self):
        value = {"revision": REVISION, "sourceDirty": False, "checks": ["capital binding"], "binaries": {"clearing": "old"}}
        with self.assertRaisesRegex(ValueError, "binary identity"):
            validate_report(value, "regression/maker-rpc.json", REVISION, {"clearing": "new"})

    def test_empty_source_stamped_reports_do_not_prove_a_scenario(self):
        with self.assertRaisesRegex(ValueError, "missing observations"):
            validate_report({"revision": REVISION, "sourceDirty": False}, "regression/maker-rpc.json", REVISION, {})

    def test_rpc_signature_is_required_but_compiled_cases_are_distinct(self):
        report = {"checks": [{"label": "reject alias", "status": "rejected"}]}
        self.assertEqual(populations(report, "oracle/oracle-svm.json")["signedCounts"], {"rejected": 1})
        with self.assertRaisesRegex(ValueError, "RPC scenario has no signature"):
            populations(report, "regression/maker-rpc.json")

    def test_failure_and_not_run_are_not_success(self):
        with tempfile.TemporaryDirectory() as directory:
            run = {"revision": REVISION, "binaries": {}, "stages": {s: {"status": "not-run", "files": {}} for s in STAGES}}
            result = build_report(directory, run)
            self.assertTrue(all(r["status"] == "not-run" for r in result["scenarios"]))
            run["stages"]["checks"]["status"] = "fail"
            result = build_report(directory, run)
            self.assertEqual(result["result"], "fail")
            self.assertEqual(result["scenarios"][0]["status"], "fail")
            self.assertEqual(result["scenarios"][1]["status"], "not-run")
            self.assertEqual(result["scenarios"][-1]["status"], "not-run")

    def test_missing_and_modified_report_hash_cannot_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "runs/regression/summary.json"
            path.parent.mkdir(parents=True)
            value = {"revision": REVISION, "sourceDirty": False, "result": "pass", "signatureVerification": True,
                     "blockhashVerification": True, "independentSignatureVerification": "pass", "legacyLiveDecode": "pass", "failedTransactionRollback": "pass"}
            path.write_text(json.dumps(value))
            run = {"revision": REVISION, "binaries": {}, "stages": {s: {"status": "not-run", "files": {}} for s in STAGES}}
            run["stages"]["checks"]["status"] = "pass"
            run["stages"]["regression"] = {"status": "pass", "files": {"summary.json": digest(path)}}
            self.assertEqual(build_report(root, run)["scenarios"][0]["status"], "pass")
            path.write_text(json.dumps({**value, "signatureVerification": False}))
            row = build_report(root, run)["scenarios"][0]
            self.assertEqual(row["status"], "fail")
            self.assertIn("changed report", row["reasons"][0])
            path.unlink()
            self.assertEqual(build_report(root, run)["scenarios"][0]["status"], "fail")

    def test_unresolved_unfilled_and_rejected_populations_survive(self):
        state = book()
        state["participants"]["alice"]["book"] = {"orders": [{"id": "7", "state": 1, "lots": "9", "filled": "0"}]}
        report = {"checks": [{"label": "nonce replay", "status": "rejected", "signature": "sig1"}],
                  "intents": [{"signature": "sig2", "status": "unresolved", "wireSha256": "hash"}], "state": state}
        result = populations(report, "lifecycle/lifecycle.json")
        self.assertEqual(result["signedCounts"], {"rejected": 1})
        self.assertEqual(result["intentCounts"], {"unresolved": 1})
        self.assertEqual(result["orders"][0]["filled"], "0")
        self.assertEqual(report["state"], state)


if __name__ == "__main__":
    unittest.main()
