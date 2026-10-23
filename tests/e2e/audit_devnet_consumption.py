"""Independent P13 upstream-to-clearing byte and integer audit; entirely offline."""
import base64
import hashlib
import json
from pathlib import Path
import struct
import sys
from audit_pyth_sponsored import audit_update, b58


def audit(root, source_only=False):
    load = lambda path: json.loads((root / path).read_text())
    report = load('report.json')
    manifest = load('provenance/manifest.json')
    assert not report['sourceDirty']
    if not source_only:
        assert report['result'] == 'pass' and report['a18RuntimeChecks']
    assert manifest['usedSource'] == report['usedSource']
    proofs = []
    normalized = []
    for index, update in enumerate(manifest['updates']):
        feed, account = update['feed'], update['account']
        assert account == report['usedSource']['raw']['value'][index]
        proofs.append(audit_update(feed, account, load(f"provenance/{feed['feed']}-update.json"),
                                   load(f"provenance/{feed['feed']}-vaa-verification.json")))
        raw = base64.b64decode(account['data'][0])
        price, confidence, exponent = struct.unpack_from('<qQi', raw, 73)
        shift = exponent + 6
        normalized.append(price * 10 ** shift if shift >= 0 else price // 10 ** -shift)
    assert len(proofs) == 2 and [x['feed'] for x in proofs] == ['btc', 'collateral']
    reference = normalized[0] // normalized[1]
    expected = load('route-expected.json')
    observation_sequence = int(expected['observation']['observationSequence'])
    selected = []
    for file in (root / 'journal').glob('*.json'):
        entry = json.loads(file.read_text())
        assert entry['finalized']
        tx = entry['history']
        if tx['meta']['err'] is not None:
            assert entry['events'] == []
            if 'error' in entry:
                assert entry['before'] == entry['after']
            else:
                # Retain unexpected, finalized harness failures as failures;
                # never retroactively classify them as successful negative tests.
                known_failures = {'refresh-maker-0-2': [0, {'Custom': 6002}], 'open-one-lot': [1, {'Custom': 6124}]}
                assert entry['label'] in known_failures
                assert tx['meta']['err'] == {'InstructionError': known_failures[entry['label']]}
            continue
        keys = tx['transaction']['message']['accountKeys'] + tx['meta'].get('loadedAddresses', {}).get('writable', []) + tx['meta'].get('loadedAddresses', {}).get('readonly', [])
        for group in tx['meta']['innerInstructions']:
            for ix in group['instructions']:
                if keys[ix['programIdIndex']] != report['program']:
                    continue
                data = b58(ix['data'])
                if data[:8] != bytes.fromhex('e445a52e51cb9a1d'):
                    continue
                b = data[8:]
                if b[:8] != hashlib.sha256(b'event:OracleObserved').digest()[:8]:
                    continue
                assert len(b) == 468 and struct.unpack_from('<H', b, 8)[0] == 1
                if struct.unpack_from('<Q', b, 106)[0] != observation_sequence:
                    continue
                assert struct.unpack_from('<Q', b, 82)[0] == tx['slot']
                assert struct.unpack_from('<Q', b, 114)[0] == reference
                assert b[178:210] == b58(manifest['updates'][0]['feed']['account'])
                assert b[210:242] == b58(manifest['updates'][1]['feed']['account'])
                assert list(struct.unpack_from('<QQ', b, 306)) == [int(p['publishTime']) for p in proofs]
                sampled, deadline = struct.unpack_from('<qq', b, 338)
                assert all(-2 <= sampled - int(p['publishTime']) <= 20 for p in proofs)
                assert b[354] == 2 and sampled <= deadline
                selected.append({'signature': entry['signature'], 'slot': str(tx['slot']), 'sampledAt': str(sampled), 'sourceDeadline': str(deadline)})
    assert len(selected) == 1
    if source_only:
        return {'result': 'pass', 'a18Complete': False, 'revision': report['revision'], 'upstream': proofs,
                'consumedObservation': selected[0], 'referenceAtomsPerLot': str(reference),
                'scope': 'Exact upstream verification and actual Normal clearing observation only; priced action acceptance remains incomplete.'}
    gross = reference + 10
    fee = (gross + 4999) // 5000
    actual = report['independentRoute']
    assert int(actual['gross']) == gross and int(actual['fee']) == fee
    before, after = actual['before'], actual['after']
    assert int(after['trader']['cash']) == int(before['trader']['cash']) - fee
    assert int(after['maker']['cash']) == int(before['maker']['cash'])
    assert int(after['trader']['lots']) == 1 and int(after['maker']['lots']) == -1
    assert int(after['trader']['virtualScaled']) == -gross * 10**9
    assert int(after['maker']['virtualScaled']) == gross * 10**9
    assert int(after['market']['fees']) == int(before['market']['fees']) + fee
    assert after['market']['allocatedVault'] == before['market']['allocatedVault'] == '1100000000'
    return {'result': 'pass', 'revision': report['revision'], 'upstream': proofs, 'consumedObservation': selected[0],
            'referenceAtomsPerLot': str(reference), 'grossAtoms': str(gross), 'feeAtoms': str(fee),
            'scope': 'Exact sponsored update verification, actual clearing event bytes and independent one-lot integer deltas; no independent-guard or wallet/service claim.'}


if __name__ == '__main__':
    args = [x for x in sys.argv[1:] if x != '--source-only']
    print(json.dumps(audit(Path(args[0] if args else '.local/devnet/acceptance'), '--source-only' in sys.argv), indent=2))
