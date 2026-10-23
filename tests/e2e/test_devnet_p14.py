import base64
from copy import deepcopy
import json
from pathlib import Path
import unittest
from audit_devnet_lifecycle import audit as lifecycle
from audit_devnet_recovery import audit as recovery

ROOT = Path(__file__).resolve().parents[2] / 'docs/evidence/p14'


class P14ActualEvidence(unittest.TestCase):
    def setUp(self):
        self.report = json.loads((ROOT/'lifecycle.json').read_text())
        self.predecessor = (ROOT/'lifecycle-attempt-2.json').read_bytes()

    def test_actual_composed_lifecycle_and_once_only_recovery(self):
        self.assertEqual(lifecycle(self.report,self.predecessor)['result'],'pass')
        self.assertEqual(recovery(json.loads((ROOT/'recovery.json').read_text()))['result'],'pass')

    def test_altered_original_intent_lineage_is_rejected(self):
        self.report['actions'][0]['intent']['signature'] = 'different-original-signature'
        with self.assertRaises(AssertionError): lifecycle(self.report,self.predecessor)

    def test_wrong_real_withdrawal_balance_is_rejected(self):
        account = self.report['actions'][-1]['after']['value'][6]
        raw = bytearray(base64.b64decode(account['data'][0]))
        raw[64:72] = (int.from_bytes(raw[64:72],'little')+1).to_bytes(8,'little')
        account['data'][0] = base64.b64encode(raw).decode()
        with self.assertRaises(AssertionError): lifecycle(self.report,self.predecessor)

    def test_unpaid_claim_cannot_disappear_from_final_accounts(self):
        account = self.report['final']['value'][2]
        raw = bytearray(base64.b64decode(account['data'][0])); raw[92:108] = (1).to_bytes(16,'little',signed=True)
        account['data'][0] = base64.b64encode(raw).decode()
        with self.assertRaises(AssertionError): lifecycle(self.report,self.predecessor)

    def test_duplicate_economic_event_is_not_recovery(self):
        report = json.loads((ROOT/'recovery.json').read_text()); report['sql']['events']='2'
        with self.assertRaises(AssertionError): recovery(report)
