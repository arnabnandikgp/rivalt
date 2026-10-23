"""Independent integer/account audit. Does not import Rivalt SDK or math."""
import base64
import hashlib
import json
from pathlib import Path
import struct
import sys

SCALE = 10**9


def number(b, offset, size=8, signed=False):
    return int.from_bytes(b[offset:offset+size], 'little', signed=signed)


def state(raw):
    b = [base64.b64decode(a['data'][0]) for a in raw['value']]
    m, r = b[:2]
    assert m[:8] == hashlib.sha256(b'account:MarketState').digest()[:8]
    assert r[:8] == hashlib.sha256(b'account:TestRouteState').digest()[:8]
    market = dict(sequence=number(m,156), config=number(m,148), funding=number(m,166,16,True), time=number(m,182,8,True),
                  cash=number(m,190), pool=number(m,198), insurance=number(m,206), fees=number(m,214), vault=number(m,222))
    participants = []
    for p in b[2:5]:
        assert p[:8] == hashlib.sha256(b'account:Participant').digest()[:8]
        participants.append(dict(cash=number(p,76), lots=number(p,84,8,True), virtual=number(p,92,16,True),
                                 checkpoint=number(p,108,16,True), nonce=number(p,132)))
    assert sum(p['lots'] for p in participants) == 0
    assert sum(p['cash'] for p in participants) == market['cash']
    assert sum(p['virtual']+p['lots']*p['checkpoint'] for p in participants) == market['pool']*SCALE
    assert market['cash']+market['pool']+market['insurance']+market['fees'] == market['vault'] == number(b[5],64)
    # OracleState starts after the route's fixed fields and bump.
    o = r[105:]
    oracle = dict(sample=number(o,160,8,True), deadline=number(o,168,8,True), status=o[176], outcome=o[177],
                  heldUntil=number(o,194,8,True), heldSlot=number(o,202), heldEpoch=number(o,210),
                  base=number(o,218,16,True), premium=number(o,234,16,True), quantity=number(o,250),
                  bid=number(o,258), ask=number(o,266), covered=number(o,274), skipped=number(o,282))
    return dict(m=market, p=participants, oracle=oracle, reference=number(r,48), token=number(b[6],64))


def trunc(n, d):
    return (abs(n)//d) * (-1 if n < 0 else 1)


def audit(report):
    assert report['result'] == 'pass' and not report['sourceDirty'] and not report.get('finalizationFailure')
    initial, final = state(report['initial']), state(report['final'])
    assert [p['lots'] for p in initial['p']] == [1,-1,0]
    assert [p['lots'] for p in final['p']] == [0,0,0]
    found = set()
    fees = 0
    for action in report['actions']:
        tx = action['history']
        assert tx['transaction']['signatures'][0] == action['intent']['signature']
        assert tx['meta']['err'] is None and action['intent']['status'] == 'finalized'
        fees += tx['meta']['fee']
        before, after = state(action['before']), state(action['after'])
        for event in action['events']:
            e, kind = event['data'], event['type']
            assert event['signature'] == action['intent']['signature']
            if kind == 'order':
                assert before['p'] == after['p'] and before['m']['fees'] == after['m']['fees']
                found.add('place' if e['kind'] == 0 else 'cancel')
            if kind == 'route':
                assert e['side'] == 1 and len(e['legs']) == 1 and e['legs'][0]['makerId'] == 0
                gross = before['reference'] - 10
                fee = (gross+4999)//5000
                assert int(e['grossQuote']) == gross and int(e['fee']) == fee
                o, m = before['oracle'], after['m']
                assert o['sample'] <= m['time'] <= o['heldUntil']
                expected_funding = o['base'] + trunc(o['premium']*(m['time']-o['sample']),3600)
                assert m['funding'] == expected_funding
                for i, delta in ((0,gross*SCALE),(1,-gross*SCALE)):
                    p, q = before['p'][i], after['p'][i]
                    assert q['lots'] == 0
                    assert q['virtual'] == p['virtual']-p['lots']*(expected_funding-p['checkpoint'])+delta
                    assert q['cash'] == p['cash']-(fee if i == 0 else 0)
                assert after['m']['fees'] == before['m']['fees']+fee
                assert before['m']['vault'] == after['m']['vault']
                found.add('close')
            if kind == 'settlement':
                assert all(p['lots'] == 0 for p in before['p'])
                assert before['oracle']['status'] == 0
                i = [report['trader'],*report['makers']].index(e['participant'])
                p, q = before['p'][i], after['p'][i]
                amount = int(e['amount'])
                if e['kind'] == 0:
                    assert amount == min(p['cash'], -p['virtual']//SCALE) and amount > 0
                    assert q['cash'] == p['cash']-amount and q['virtual'] == p['virtual']+amount*SCALE
                    assert after['m']['pool'] == before['m']['pool']+amount
                    found.add('collect')
                elif e['kind'] == 1:
                    assert amount == min(p['virtual']//SCALE,before['m']['pool']) and amount > 0
                    assert q['cash'] == p['cash']+amount and q['virtual'] == p['virtual']-amount*SCALE
                    assert after['m']['pool'] == before['m']['pool']-amount
                    found.add('settle')
                else:
                    assert e['kind'] == 2 and i == 0
                    assert amount == p['cash']-(1 if p['virtual']<0 else 0)
                    assert q['cash'] == p['cash']-amount and q['virtual'] == p['virtual']
                    assert after['token']-before['token'] == amount == before['m']['vault']-after['m']['vault']
                    found.add('withdraw')
    assert found == {'place','cancel','close','collect','settle','withdraw'}
    expiry_before, expiry_after = state(report['expiry']['before']), state(report['expiry']['after'])
    assert expiry_after['oracle']['status'] == 0
    assert expiry_after['m']['funding'] == expiry_before['m']['funding']
    assert expiry_after['oracle']['skipped'] > expiry_before['oracle']['skipped']
    assert report['sql'] == dict(unresolved='0',jobs='0')
    assert final['m']['pool'] <= 1 and all(abs(p['virtual']) < SCALE for p in final['p'])
    assert all(int(row['committed']) == 0 and int(row['spent']) <= int(row['cap']) for row in report['budgets'])
    return dict(result='pass', revision=report['revision'], lifecycle=sorted(found), networkFeesLamports=str(fees),
                finalVaultAtoms=str(final['m']['vault']), finalSettlementAtoms=str(final['m']['pool']),
                retainedFractionalClaims=[str(p['virtual']) for p in final['p']], externalWalletVerified=False)


if __name__ == '__main__':
    print(json.dumps(audit(json.loads(Path(sys.argv[1]).read_text())), indent=2))
