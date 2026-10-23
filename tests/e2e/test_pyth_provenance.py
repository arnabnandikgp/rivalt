"""Adversarial checks of the independent source-proof auditor on retained RPC data."""
import base64
import copy
import json
from pathlib import Path
import unittest
from audit_pyth_sponsored import audit_update


class ProvenanceAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture = json.loads((Path(__file__).resolve().parents[1] / 'fixtures/pyth-provenance.json').read_text())
        cls.feed = fixture['feed']
        cls.account = fixture['account']
        cls.update = fixture['update']
        cls.verification = fixture['verification']

    def test_retained_proof_passes(self):
        self.assertEqual(audit_update(self.feed, self.account, self.update, self.verification)['publishTime'], '1792752688')

    def test_wrong_consumed_message_rejects(self):
        account = copy.deepcopy(self.account)
        raw = bytearray(base64.b64decode(account['data'][0]))
        raw[73] ^= 1  # Authenticated account price must match actual signed message.
        account['data'][0] = base64.b64encode(raw).decode()
        with self.assertRaises(AssertionError):
            audit_update(self.feed, account, self.update, self.verification)

    def test_reverted_verification_rejects(self):
        tx = copy.deepcopy(self.verification)
        tx['meta']['err'] = {'InstructionError': [3, 'InvalidAccountData']}
        with self.assertRaises(AssertionError):
            audit_update(self.feed, self.account, self.update, tx)

    def test_read_only_reference_without_receiver_cpi_rejects(self):
        tx = copy.deepcopy(self.update)
        for group in tx['meta']['innerInstructions']:
            group['instructions'] = []
        with self.assertRaises(AssertionError):
            audit_update(self.feed, self.account, tx, self.verification)


if __name__ == '__main__':
    unittest.main()
