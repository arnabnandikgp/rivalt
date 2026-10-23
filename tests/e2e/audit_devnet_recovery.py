"""Independent raw-account integer audit of the actual P14 recovery deposit."""
import base64
import hashlib
import json
from pathlib import Path
import struct
import sys
from audit_pyth_sponsored import b58


def audit(report):
    assert report['result'] == 'pass' and not report['sourceDirty']
    assert report['subscriptionAcknowledgedBefore'] and report['subscriptionAcknowledgedAfter']
    assert report['socketClosedBeforeBroadcast']
    signature = report['signature']
    assert report['actualAcknowledgementDiscarded'] == signature
    assert report['wire'] == report['fetchedWire']
    assert report['history']['transaction']['signatures'][0] == signature
    assert report['history']['meta']['err'] is None
    assert report['ambiguous']['signature'] == report['recoveredIntent']['signature'] == signature
    assert report['ambiguous']['status'] == 'unresolved'
    assert report['recoveredIntent']['status'] == 'finalized'
    assert report['recoveredIntent']['result']['slot'] == str(report['history']['slot'])
    assert report['sql'] == dict(intents='1', transactions='1', events='1', outbox='1', websocket='0', unresolved='0')
    amount = int(report['amount'])
    assert amount == 1000
    states = []
    for name in ('before', 'after'):
        raw = report[name]
        assert raw['context']['slot'] <= report['history']['slot'] if name == 'before' else raw['context']['slot'] >= report['history']['slot']
        accounts = raw['value']
        assert [a['owner'] for a in accounts] == [report['program']] * 2 + ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'] * 2
        m, p, vault, token = [base64.b64decode(a['data'][0]) for a in accounts]
        assert m[:8] == hashlib.sha256(b'account:MarketState').digest()[:8]
        assert p[:8] == hashlib.sha256(b'account:Participant').digest()[:8]
        assert p[10:42] == b58(report['market'])
        assert token[32:64] == p[42:74]
        assert vault[:32] == token[:32] == m[76:108]
        states.append((m, p, vault, token))
    before, after = states
    u64 = lambda data, offset: struct.unpack_from('<Q', data, offset)[0]
    # All participant fields except cash must remain byte-identical. The market
    # changes only sequence, total cash and allocated vault for this deposit.
    assert before[1][:76] == after[1][:76] and before[1][84:] == after[1][84:]
    assert u64(after[1], 76) - u64(before[1], 76) == amount
    assert u64(after[0], 156) == u64(before[0], 156) + 1
    assert u64(after[0], 190) - u64(before[0], 190) == amount
    assert u64(after[0], 222) - u64(before[0], 222) == amount
    for start, stop in ((0, 156), (164, 190), (198, 222), (230, len(before[0]))):
        assert before[0][start:stop] == after[0][start:stop]
    assert u64(after[2], 64) - u64(before[2], 64) == amount
    assert u64(before[3], 64) - u64(after[3], 64) == amount
    projected = report['projection']['participants'][report['participant']]
    assert int(projected['cash']) == u64(after[1], 76)
    assert int(report['projection']['sequence']) == u64(after[0], 156)
    return dict(result='pass', revision=report['revision'], signature=signature,
                depositAtoms=str(amount), onceOnly=True, walletProviderTest=False,
                scope='Actual RPC/WS/PostgreSQL recovery and exact raw-account deposit deltas; no source/lifecycle or external wallet claim')


if __name__ == '__main__':
    print(json.dumps(audit(json.loads(Path(sys.argv[1]).read_text())), indent=2))
