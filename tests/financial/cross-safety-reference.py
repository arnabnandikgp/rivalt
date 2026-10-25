#!/usr/bin/env python3
"""P20 independent integer audit of actual raw cross-account captures."""
import base64
import copy
import importlib.util
import json
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location('group_reference', Path(__file__).with_name('group-safety-reference.py'))
reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)


def audit(summary, captures):
    result = reference.audit(summary, captures, allow_cross=True)
    keys = summary['keys']
    states = {name: reference.snapshot(raw, keys, allow_cross=True) for name, raw in captures.items()}
    target_id = keys['roots'].index(keys['liquidationTarget'])
    opened = states['cross-open-two-markets']
    target = opened['roots'][target_id]
    assert target['mode'] == 0
    assert target['cash'] == 999_908  # ceil(300111/5000) + ceil(150111/5000).
    assert [position['lots'] for position in target['positions']] == [5, 5]
    assert [position['virtual'] for position in target['positions']] == [-300_111*10**9, -150_111*10**9]
    assert opened['roots'][0]['cash'] == 0  # Actual explicit owner allocation.
    assert opened['pools'] == dict(cash=2_001_999_908, pool=0, insurance=0, fees=92, vault=2_002_000_000)
    for market in [0, 1]:
        assert opened['roots'][2+market]['positions'][market]['lots'] == -2
        assert opened['roots'][4+market]['positions'][market]['lots'] == -3

    gain_before, gain_after = states['cross-before-funded-gain'], states['cross-after-funded-gain']
    assert gain_before['pools']['pool'] == 1 and gain_after['pools']['pool'] == 0
    assert gain_after['roots'][target_id]['cash'] == gain_before['roots'][target_id]['cash'] + 1
    assert gain_after['roots'][target_id]['positions'][0]['virtual'] == gain_before['roots'][target_id]['positions'][0]['virtual'] - 10**9

    before, after = states['cross-before-netting'], states['cross-after-netting']
    initial, final = before['roots'][target_id], after['roots'][target_id]
    assert all(position['lots'] == 0 for position in initial['positions'])
    claims = [position['virtual'] for position in initial['positions']]
    assert claims[0] > 0 > claims[1]
    cancellation = min(claims[0], -claims[1])
    assert [position['virtual'] for position in final['positions']] == [claims[0]-cancellation, claims[1]+cancellation]
    assert initial['cash'] == final['cash'] and before['pools'] == after['pools']
    for index, (first, second) in enumerate(zip(before['roots'], after['roots'])):
        if index != target_id:
            assert first['raw'] == second['raw']

    initial = states['before-liquidation']['roots'][7]
    final = states['after-liquidation']['roots'][7]
    assert initial['mode'] == final['mode'] == 0
    assert initial['positions'][1]['lots'] == final['positions'][1]['lots'] == 1
    funding = states['after-liquidation']['markets'][1]['funding']
    assert final['positions'][1]['virtual'] == initial['positions'][1]['virtual'] - (funding-initial['positions'][1]['checkpoint'])
    assert final['positions'][1]['checkpoint'] == funding
    result['economicSignCase'] = summary.get('qualificationVersion', 1) >= 2
    if result['economicSignCase']:
        sign_case = states['cross-negative-risk-positive-net']
        account = sign_case['roots'][target_id]
        common_claims = reference.claims(account, [market['price'] for market in sign_case['markets']], [market['funding'] for market in sign_case['markets']])
        assert reference.equity(account, sign_case['markets']) < 0
        assert account['cash']*10**9 + sum(common_claims) > 0
    result['crossSplitFees'] = '92'
    result['closedNettedScaled'] = str(cancellation)
    return result


if __name__ == '__main__':
    directory = Path(sys.argv[1])
    summary = json.loads((directory/'summary.json').read_text())
    captures = json.loads((directory/'captures.json').read_text())
    result = audit(summary, captures)
    keys = summary['keys']
    corruptions = [
        ('cross-open-two-markets', keys['liquidationTarget'], 113),
        ('cross-after-netting', keys['liquidationTarget'], 177),
        ('after-liquidation', keys['roots'][7], 177),
        ('complete-default', keys['liquidationTarget'], 113),
        ('frozen-default', keys['resolution'], 87),
        ('complete-default', keys['resolution'], 478),
        ('complete-emergency', keys['group'], 255),
    ]
    for label, key, offset in corruptions:
        altered = copy.deepcopy(captures)
        data = bytearray(base64.b64decode(altered[label][key])); data[offset] ^= 1
        altered[label][key] = base64.b64encode(data).decode()
        try:
            audit(summary, altered)
        except (AssertionError, KeyError):
            pass
        else:
            raise AssertionError(f'accepted corruption {label} at {offset}')
    print(json.dumps(dict(independentRawAudit='pass', mutationsRejected=len(corruptions), **result)))
