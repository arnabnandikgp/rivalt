"""Independent direct-corner audit of actual signed runtime snapshots.

Consumes retained RPC-decoded roots plus literal RVBACK01 bytes. Does not call the
Rust kernel, SDK backing preview or a production contribution implementation.
"""
from itertools import product
import json
from pathlib import Path
import sys

SCALE = 10**9


def check(frame):
    registry = frame['registry']
    roots = frame['roots']
    checked = 0
    for selected, ledger in enumerate(frame['ledgers']):
        backing = ledger['backing']
        epoch = int(backing['epoch'])
        if not epoch or int(backing['membershipEpoch']) != int(registry['membershipEpoch']):
            continue  # Inactive/stale membership is not payment evidence.
        processed = [root for root in roots if int(root['backingEpochs'][selected]) == epoch]
        total_q = positive = negative = bad = 0
        required = [0, 0]
        prices = [tuple(map(int, endpoints)) for endpoints in backing['region']['prices']]
        funding = [tuple(map(int, endpoints)) for endpoints in backing['region']['funding']]
        for root in processed:
            quantities = [int(position['lots']) for position in root['positions']]
            virtual = [int(position['virtualScaled']) for position in root['positions']]
            consumed = [int(position['fundingCheckpointScaled']) for position in root['positions']]
            corner_claims = [tuple(virtual[market] + quantities[market] *
                            (point[market]*SCALE - (index[market]-consumed[market])) for market in (0, 1))
                            for point in product(*prices) for index in product(*funding)]
            owes = any(claims[selected] < 0 for claims in corner_claims)
            gross = max(sum(max(0, -claim) for claim in claims) for claims in corner_claims)
            bad += int(owes and int(root['cash'])*SCALE < gross)
            for market in (0, 1):
                required[market] += int(quantities[market] != 0 and (market == selected or owes))
            total_q += quantities[selected]
            fixed = virtual[selected] + quantities[selected]*consumed[selected]
            positive += max(0, fixed)
            negative += max(0, -fixed)
        data = bytes.fromhex(backing['summary'])
        assert len(data) == 104 and data[:8] == b'RVBACK01'
        number = lambda offset, width, signed=False: int.from_bytes(data[offset:offset+width], 'little', signed=signed)
        actual = (number(8,8), number(16,8), number(24,16,True), number(40,24), number(64,24), number(88,8), number(96,8))
        expected = (len(processed), bad, total_q, positive, negative, *required)
        assert actual == expected, (frame['label'], selected, actual, expected)
        certificate = frame['certificates'][selected]
        if certificate and int(certificate['backingEpoch']) == epoch:
            assert int(certificate['next']) == len(processed), frame['label']
            if certificate['complete']:
                assert len(processed) == int(registry['financialCount']) and total_q == 0, frame['label']
                assert positive == negative + int(ledger['settlement'])*SCALE, frame['label']
        checked += 1
    return checked


if __name__ == '__main__':
    frames = json.loads(Path(sys.argv[1]).read_text())
    count = sum(check(frame) for frame in frames)
    assert count > 0
    print(json.dumps({'frames': len(frames), 'actualSummaryComparisons': count, 'cornerEnumeration': 16}))
