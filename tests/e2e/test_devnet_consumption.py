import copy
import json
from pathlib import Path
import tempfile
import unittest

from audit_devnet_consumption import audit


class DevnetConsumptionAudit(unittest.TestCase):
    bundle = json.loads(Path('docs/evidence/p13/acceptance/final-bundle.json').read_text())

    def check(self, change=None):
        bundle = copy.deepcopy(self.bundle)
        if change:
            change(bundle['files'])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'bundle.json'
            path.write_text(json.dumps(bundle))
            return audit(path, recovered_ws=True)

    def test_actual_trade_and_original_signature_recovery(self):
        self.assertEqual(self.check()['feeAtoms'], '17')

    def test_wrong_recovery_slot_cannot_pass(self):
        def change(files):
            files['ws-diagnostic.json']['messages'][1]['message']['params']['result']['context']['slot'] += 1
        with self.assertRaises(AssertionError):
            self.check(change)

    def test_other_runtime_failure_cannot_be_waived(self):
        with self.assertRaises(AssertionError):
            self.check(lambda files: files['report.json'].update(failure='Financial reconciliation failed'))

    def test_wrong_cash_delta_cannot_pass(self):
        def change(files):
            files['report.json']['independentRoute']['after']['trader']['cash'] = '100000000'
        with self.assertRaises(AssertionError):
            self.check(change)


if __name__ == '__main__':
    unittest.main()
