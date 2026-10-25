#!/usr/bin/env python3
"""P19 independent raw-byte authority, literal fills and complete-group accounting."""
import base64
import copy
import importlib.util
import json
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location('raw_group', Path(__file__).with_name('group-safety-reference.py'))
raw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(raw)
S = 10**9

def audit(summary, captures):
    states = {name: raw.snapshot(capture, summary['keys']) for name, capture in captures.items()}
    for state in states.values(): raw.normal(state)
    initial, granted, opened, revoked, closed, final = [states[name] for name in [
        'activated-empty', 'delegate-granted', 'delegated-open', 'delegate-revoked', 'delegated-close', 'margin-core-final']]
    assert initial['pools'] == dict(cash=2_002_000_000, pool=0, insurance=0, fees=0, vault=2_002_000_000)
    for state, epoch, nonce in [(granted,2,1),(revoked,3,3),(final,7,8)]:
        root = state['roots'][0]
        assert raw.integer(root['raw'],273) == epoch and raw.integer(root['raw'],217) == nonce
    assert granted['roots'][0]['raw'][113:217] == initial['roots'][0]['raw'][113:217]
    assert revoked['roots'][0]['raw'][113:217] == opened['roots'][0]['raw'][113:217]
    assert revoked['roots'][0]['reserved'] == final['roots'][0]['reserved'] == 0
    assert all(byte == 0 for byte in final['roots'][0]['raw'][233:273])
    # Independently summed curve prices: A buys 2 at 60,010/60,011; B buys
    # 3 at 60,030. Separate sell counters yield 59,990/59,989 and 59,970.
    # Aggregate prefix fees are ceil(300,111/5,000)=61 and ceil(299,889/5,000)=60.
    assert opened['roots'][0]['cash'] == 999_939
    assert opened['roots'][0]['positions'][0]['lots'] == 5
    assert opened['roots'][0]['positions'][0]['virtual'] == -300_111*S
    assert closed['roots'][0]['cash'] == 999_879
    assert final['roots'][0]['cash'] == 999_869  # Explicit ten-atom allocation.
    funding = closed['roots'][0]['positions'][0]['checkpoint'] - opened['roots'][0]['positions'][0]['checkpoint']
    assert final['roots'][0]['positions'][0]['virtual'] == -222*S - 5*funding
    for member, gain, lots in [(2,42,2),(4,180,3)]:
        assert final['roots'][member]['cash'] == 500_000_000
        assert final['roots'][member]['positions'][0]['virtual'] == gain*S + lots*funding
    assert all(position['lots'] == 0 for root in final['roots'] for position in root['positions'])
    assert final['roots'][6]['cash'] == 0 and raw.integer(final['roots'][6]['raw'],273) == 2
    # ETH A's one-lot 30,010/29,990 round trip charges 7+6 and leaves -20 unpaid.
    assert final['roots'][1]['cash'] == 999_997
    assert final['roots'][1]['positions'][1]['virtual'] == -20*S
    assert final['roots'][3]['positions'][1]['virtual'] == 20*S
    assert final['roots'][3]['cash'] == 500_000_000
    assert final['pools'] == dict(cash=2_001_999_866,pool=0,insurance=0,fees=134,vault=2_002_000_000)
    assert raw.integer(final['accounts'][summary['keys']['vault']],64) == 2_002_000_000
    for check in summary['checks']:
        assert check['bytes'] <= 1232
        if check['status'] == 'pass': assert int(check['computeUnits'])*5 <= check['declaredComputeUnits']*4
    return dict(roots=7,markets=2,fees='134',fundingScaled=str(funding),fundedCash='2001999866',crossEnabled=False)

if __name__ == '__main__':
    directory=Path(sys.argv[1])
    summary=json.loads((directory/'summary.json').read_text())
    captures=json.loads((directory/'captures.json').read_text())
    result=audit(summary,captures)
    changes=[('margin-core-final',summary['keys']['roots'][0],113),
        ('margin-core-final',summary['keys']['roots'][0],273),
        ('margin-core-final',summary['keys']['roots'][2],129),
        ('margin-core-final',summary['keys']['vault'],64),
        ('delegate-revoked',summary['keys']['roots'][0],217)]
    for label,key,offset in changes:
        altered=copy.deepcopy(captures)
        data=bytearray(base64.b64decode(altered[label][key]));data[offset]^=1
        altered[label][key]=base64.b64encode(data).decode()
        try: audit(summary,altered)
        except (AssertionError,KeyError): pass
        else: raise AssertionError(f'accepted corruption at {label}:{offset}')
    print(json.dumps({'independentRawAudit':'pass','mutationsRejected':len(changes),**result}))
