"""Offline raw-account/fee audit of the actual external-wallet registration.

The read-only TS capture verifies Ed25519 and the complete canonical message.
This audit independently checks instruction bytes, rent and indexed state.
"""
import base64
import hashlib
import json
from pathlib import Path
import sys
from audit_pyth_sponsored import b58


def audit(r):
    assert r['result'] == 'pass' and not r['sourceDirty'] and not r['signedByVerifier']
    t = r['transaction']; h = t['history']; msg = h['transaction']['message']; meta = h['meta']
    assert meta['err'] is None and t['status']['confirmationStatus'] == 'finalized'
    assert t['status']['slot'] == h['slot'] and t['status']['err'] is None
    assert h['transaction']['signatures'] == [t['signature']]
    keys = msg['accountKeys']; ix = msg['instructions']
    assert keys[0] == r['owner'] and len(ix) == 3
    for i, encoded in enumerate(('02801a0600', '030000000000000000')):
        assert keys[ix[i]['programIdIndex']] == 'ComputeBudget111111111111111111111111111111'
        assert ix[i]['accounts'] == [] and b58(ix[i]['data']) == bytes.fromhex(encoded)
    assert keys[ix[2]['programIdIndex']] == r['program']
    assert b58(ix[2]['data']) == hashlib.sha256(b'global:register_participant').digest()[:8]
    participant_index = keys.index(r['participant'])
    assert meta['preBalances'][participant_index] == 0
    rent = meta['postBalances'][participant_index]
    assert meta['fee'] == 5000 and meta['preBalances'][0] - meta['postBalances'][0] == rent + 5000
    assert all(a == b for i, (a, b) in enumerate(zip(meta['preBalances'], meta['postBalances'])) if i not in (0, participant_index))
    accounts = r['accounts']; assert accounts['context']['slot'] >= h['slot']
    assert [a['owner'] for a in accounts['value']] == [r['program']] * 3 + ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA']
    m, _, p, vault = [base64.b64decode(a['data'][0]) for a in accounts['value']]
    assert p[:8] == hashlib.sha256(b'account:Participant').digest()[:8]
    assert p[10:42] == b58(r['market']) and p[42:74] == b58(r['owner'])
    assert int.from_bytes(p[76:108], 'little') == 0  # cash, lots, virtual quote
    assert int.from_bytes(m[222:230], 'little') == int.from_bytes(vault[64:72], 'little') == 1_000_000_470
    indexed = r['indexed']
    assert indexed['owner'] == r['owner'] and indexed['participant'] == r['participant']
    assert [indexed[k] for k in ('cash', 'lots', 'virtualScaled')] == ['0'] * 3
    assert indexed['asOf'] == dict(commitment='finalized', sequence='58', signature=t['signature'], slot=str(h['slot']))
    return dict(result='pass', revision=r['revision'], signature=t['signature'], slot=h['slot'],
                networkFeeLamports='5000', participantRentLamports=str(rent), indexedSequence='58',
                scope='Actual registration instructions, raw zero-cash participant, unchanged vault, exact rent/fees and finalized PostgreSQL projection; wallet provider identity is user-reported')


if __name__ == '__main__':
    print(json.dumps(audit(json.loads(Path(sys.argv[1]).read_text())), indent=2))
