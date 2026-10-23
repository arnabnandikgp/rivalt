"""Offline independent decoding of retained P13 RPC bytes; no network or signatures sent."""
import base64
import hashlib
import json
from pathlib import Path
import struct
import sys


def b58(text):
    alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    n = 0
    for c in text:
        n = n * 58 + alphabet.index(c)
    return bytes(len(text) - len(text.lstrip('1'))) + n.to_bytes((n.bit_length() + 7) // 8, 'big')


def disc(name):
    return hashlib.sha256(('global:' + name).encode()).digest()[:8]


def audit(root):
    load = lambda name: json.loads((root / (name + '.json')).read_text())
    report, samples, vaa_tx = load('report'), load('samples'), load('vaa-verification')
    assert report['sourceDirty'] is False and report['result'] == 'observed'
    assert len(samples) == 74 and int(report['elapsedMilliseconds']) >= 180_000
    assert vaa_tx['meta']['err'] is None
    verification_program = 'HDw2E7P8X1SkCyjvoGsfBGAVUutKcj874bXjHrpVYrVL'
    vaa_keys = vaa_tx['transaction']['message']['accountKeys']
    verified = []
    for ix in vaa_tx['transaction']['message']['instructions']:
        if vaa_keys[ix['programIdIndex']] == verification_program and b58(ix['data'])[:8] == disc('verify_encoded_vaa_v1'):
            verified.extend(vaa_keys[i] for i in ix['accounts'])
    assert verified and f'Program {verification_program} success' in vaa_tx['meta']['logMessages']
    updates = []
    for index in [2, 3]:
        feed = report['feeds'][index]
        account = samples[-1]['raw']['value'][index]
        b = base64.b64decode(account['data'][0])
        assert b == bytes.fromhex((root / (feed['feed'] + '-account.hex')).read_text().strip())
        assert account['owner'] == feed['receiver'] and not account['executable']
        assert len(b) == 134 and b[:8] == hashlib.sha256(b'account:PriceUpdateV2').digest()[:8] and b[40] == 1
        assert b[8:40] == b58(feed['account']) and b[41:73].hex() == feed['feedId']
        fields = struct.unpack_from('<qQiqqqQ', b, 73)
        posted = struct.unpack_from('<Q', b, 125)[0]
        tx = load(feed['feed'] + '-update')
        assert tx['meta']['err'] is None and tx['slot'] == posted
        keys = tx['transaction']['message']['accountKeys'] + tx['meta']['loadedAddresses']['writable'] + tx['meta']['loadedAddresses']['readonly']
        matches = []
        for outer_index, ix in enumerate(tx['transaction']['message']['instructions']):
            if keys[ix['programIdIndex']] != feed['push']:
                continue
            accounts = [keys[i] for i in ix['accounts']]
            if accounts[5] != feed['account']:
                continue
            data = b58(ix['data']); assert data[:8] == disc('update_price_feed')
            size = struct.unpack_from('<I', data, 8)[0]; assert size == 85
            message = data[12:12 + size]
            assert message[0] == 0 and message[1:33].hex() == feed['feedId']
            assert struct.unpack_from('>qQiqqqQ', message, 33) == fields
            count = struct.unpack_from('<I', data, 97)[0]
            end = 101 + count * 20 + 1
            assert len(data) == end + 34 and data[end:end + 2] == b'\0\0' and data[end + 2:].hex() == feed['feedId']
            assert accounts[1] == feed['receiver'] and accounts[2] in verified
            assert vaa_tx['slot'] <= tx['slot']
            inner = next(x['instructions'] for x in tx['meta']['innerInstructions'] if x['index'] == outer_index)
            calls = [x for x in inner if keys[x['programIdIndex']] == feed['receiver']]
            assert len(calls) == 1
            call = calls[0]; body = b58(call['data'])
            assert body[:8] == disc('post_update') and body[8:] == data[8:end]
            cpi_accounts = [keys[i] for i in call['accounts']]
            assert cpi_accounts[1] == accounts[2] and cpi_accounts[4] == feed['account'] and cpi_accounts[6] == feed['account']
            matches.append({'feed': feed['feed'], 'signature': tx['transaction']['signatures'][0], 'slot': str(tx['slot']),
                            'publishTime': str(fields[3]), 'encodedVaa': accounts[2], 'receiver': feed['receiver'], 'proofNodes': str(count)})
        assert len(matches) == 1
        updates.extend(matches)
    availability = {}
    for commitment in ['confirmed', 'finalized']:
        rows = [x for x in samples if x['commitment'] == commitment]
        for name in ['core', 'compatible']:
            qualified = [x for x in rows if all(p['eligible'] for p in x['prices'] if p['feed'].startswith(name + '/'))]
            availability[commitment + '/' + name] = {'pairEligibleSamples': str(len(qualified)), 'samples': str(len(rows)),
                                                      'note': 'Source checks only; not continuous availability, recovery completion or executable trading.'}
    return {'result': 'pass', 'a18Complete': False, 'verificationSignature': vaa_tx['transaction']['signatures'][0],
            'verificationSlot': str(vaa_tx['slot']), 'updates': updates, 'availability': availability}


if __name__ == '__main__':
    print(json.dumps(audit(Path(sys.argv[1] if len(sys.argv) > 1 else 'docs/evidence/p13/sponsored')), indent=2))
