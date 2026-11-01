#!/usr/bin/env python3
"""Independent P26 raw-byte audit against the exact Fraction clearing model.

No SDK, generated IDL, decoded TS claims or Rust helpers supply expected payouts.
The earlier independent wire reader is reused only for scalar account decoding.
"""
import base64
import copy
from fractions import Fraction
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

from account_contract_reference import Account
from clearing_network_reference import clear_atom_cohort

spec = importlib.util.spec_from_file_location('wire', Path(__file__).with_name('account-trading-reference.py'))
wire = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wire)
integer, root, SCALE = wire.integer, wire.root, wire.SCALE


def account(raw, key, name, size):
    # Schema 5 deliberately adopts canonical discriminators and a revision header.
    assert name in {'Resolution','ResolutionPage','ResolutionWork','MarginAccount','Market','MarketLedger','Custody','VenueSafety'}
    data = base64.b64decode(raw[key])
    assert len(data) == size and data[:8] == hashlib.sha256(f'account:{name}'.encode()).digest()[:8]
    assert integer(data, 8, 2) == 7 and integer(data, 10) > 0
    return data


def header(raw, key):
    data = account(raw, key, 'Resolution', 3652)
    # Ordered contract fields, independent of generated IDL/SDK offsets.
    offset = 8 + 2 + 8 + 32
    result = {}
    def read(name, width=8, count=1, signed=False):
        nonlocal offset
        values = tuple(integer(data, offset + index * width, width, signed) for index in range(count))
        offset += width * count
        result[name] = values[0] if count == 1 else values
    read('epoch'); read('stage',1); read('cursor',2); read('count',2)
    offset += 32 + 8 + 8 + 16 + 16 + 16 + 32 + 2
    read('prices',count=2); read('funding',16,2,True); read('frozen_at',signed=True)
    read('cash'); read('pools',count=2); read('insurance',count=2); read('fees',count=2); read('allocated')
    offset += 8 + 32 + 16 + 32 + 32
    read('budgets',count=2); read('spent',count=2); read('evaluation',1); read('clipped',1)
    read('common',768); read('rates',768,2); read('factor',24); read('denominator',768)
    read('cash_applied'); read('remaining_lots',16,2,True); read('remaining_gross',8,2); read('remaining_claims',16,2,True)
    assert offset + 1 == len(data)
    return result


def balanced(report, raw):
    raw = {key:value for key,value in raw.items() if value is not None}
    wire.decode(report, raw)
    for key in report['roots']:
        account(raw, key, 'MarginAccount', 978)
    for key in report['markets']:
        account(raw, key, 'Market', 455)
    for key in report['ledgers']:
        account(raw, key, 'MarketLedger', 125)
    custody = account(raw, report['custody'], 'Custody', 59)
    token_total = integer(base64.b64decode(raw[report['vault']]),64)
    for key in report['userTokens'] + [report['reserveDestination']]:
        token_total += integer(base64.b64decode(raw[key]),64)
    assert token_total == integer(base64.b64decode(raw[report['mint']]),36), 'actual tokens versus mint supply'
    return sum(root(base64.b64decode(raw[key]))['cash'] for key in report['roots'])


def audit(report):
    for step in report.get('liquidationSteps',[]):
        audit_liquidation(report,step)
    frozen = report['frozenAccounts']
    completed = report['completedAccounts']
    original = header(frozen,report['resolution'])
    finished = header(completed,report['resolution'])
    assert original['stage'] == 2 and finished['stage'] == 11
    assert original['epoch'] == finished['epoch'] and finished['cursor'] == finished['count'] == len(report['roots'])
    assert original['cash'] == balanced(report,frozen)
    accounts = []
    for key in report['roots']:
        value = root(base64.b64decode(frozen[key]))
        claims = tuple(Fraction(lots * original['prices'][index] * SCALE + virtual
            - lots * (original['funding'][index] - checkpoint), SCALE)
            for index,(lots,virtual,checkpoint) in enumerate(value['positions']))
        accounts.append(Account(value['cash'],claims))
    expected = clear_atom_cohort(tuple(accounts),original['pools'],original['insurance'],original['fees'])
    assert finished['spent'] == expected.insurance_spent
    assert finished['budgets'] == expected.effective_insurance_budgets
    assert finished['evaluation'] + 1 == expected.insurance_passes
    for index in range(2):
        assert Fraction(finished['rates'][index],finished['common']*finished['factor']) == expected.benchmark.rates[index]
    for index,key in enumerate(report['roots']):
        before = account(frozen,key,'MarginAccount',978)
        after = account(completed,key,'MarginAccount',978)
        assert integer(after,121) == expected.cash[index], 'exact atom owner'
        assert all(lots == virtual == 0 for lots,virtual,_ in root(after)['positions'])
        assert after[241:281] == bytes(40) and integer(after,289) == 0, 'delegate/reserve cleanup'
        assert after[305:977] == bytes(672), 'live order/protection cleanup'
        assert integer(after,297) == integer(before,297), 'monotonic order identity'
        for position in range(2):
            offset = 129 + position * 48
            if after[118] == 0 or after[119] == position:
                assert integer(after,offset+24,16,True) == original['funding'][position]
                assert integer(after,offset+40) == integer(before,offset+40)+1
            else: assert after[offset:offset+48] == bytes(48), 'isolated forbidden slot'
        page = account(completed,report['pages'][index//2],'ResolutionPage',3408)
        offset = 61 + (index%2)*1673
        assert integer(page,50) == original['epoch'] and integer(page,58,2) == index//2
        assert integer(page,offset+32) == accounts[index].cash
        for market in range(2):
            claim = integer(page,offset+72+market*16,16,True)
            assert Fraction(claim,SCALE) == accounts[index].claims[market]
            actual = integer(page,offset+1648+market*8)
            assert actual == abs(expected.claim_cash_movements[index][market]), 'unsigned flow magnitude'
            actual *= -1 if claim < 0 else 1 if claim > 0 else 0
            assert actual == expected.claim_cash_movements[index][market], 'per-market rounded flow'
        assert integer(page,offset+1664) == expected.cash[index] and page[offset+1672] == 1
    assert balanced(report,completed) == sum(expected.cash) == finished['cash_applied']
    for index,key in enumerate(report['ledgers']):
        before = account(frozen,key,'MarketLedger',125)
        after = account(completed,key,'MarketLedger',125)
        assert integer(after,83) == 0
        assert integer(after,91) == original['insurance'][index]-expected.insurance_spent[index]
        assert integer(after,99) == original['fees'][index] and after[107] == before[107]
    assert all(value == 0 for name in ['remaining_lots','remaining_gross','remaining_claims'] for value in finished[name])
    for name,mode in [('completedAccounts',3),('resolvedAccounts',3),('reactivatedAccounts',1),('rawAccounts',4)]:
        if name == 'reactivatedAccounts' and report.get('scenario') in ['resolved-retirement','two-market-resolved']:
            assert name not in report
            continue
        if name == 'rawAccounts' and report.get('scenario') == 'two-market-resolved':mode=3
        raw = report[name]
        balanced(report,raw)
        assert account(raw,report['safety'],'VenueSafety',85)[50:52] == bytes([mode,0])
        for index,key in enumerate(report['markets']):
            assert integer(account(raw,key,'Market',455),84,16,True) == original['funding'][index]
    # The signed scenario withdraws 100 terminal owner atoms, performs a matched
    # 10-atom recovery deposit/exit, then matched 1-atom active deposit/retired exit.
    final = report['rawAccounts']
    withdrawn_reserve=0 if report.get('scenario') == 'two-market-resolved' else 10
    for index,key in enumerate(report['roots']):
        assert integer(base64.b64decode(final[key]),121) == expected.cash[index]-(100 if index == 0 else 0)
    for index,key in enumerate(report['ledgers']):
        ledger = base64.b64decode(final[key])
        assert integer(ledger,91) == original['insurance'][index]-expected.insurance_spent[index]-(withdrawn_reserve if index == 1 else 0)
        assert integer(ledger,99) == original['fees'][index]
    assert integer(base64.b64decode(final[report['reserveDestination']]),64) == withdrawn_reserve
    return len(accounts),expected.augmentations


def audit_liquidation(report,step):
    before,after=step['before'],step['after']
    assert balanced(report,before) == balanced(report,after), 'liquidation cash is transferred, not minted'
    previous={key:root(base64.b64decode(before[key])) for key in report['roots']}
    actual={key:root(base64.b64decode(after[key])) for key in report['roots']}
    target,receiver=step['target'],step['receiver']
    markets=[base64.b64decode(after[key]) for key in report['markets']]
    funding=[integer(data,84,16,True) for data in markets]
    lower=[integer(data,132) for data in markets];upper=[integer(data,140) for data in markets]
    lots,price=int(step['lots']),int(step['price'])
    assert 0 < lots <= 4608 and previous[target]['positions'][0][0] > lots
    fee=min((lots*price+1999)//2000,10_000,previous[target]['cash'])
    expected=copy.deepcopy(previous)
    for key,direction in [(target,-1),(receiver,1)]:
        expected[key]['cash']+=direction*fee
        positions=[]
        raw=base64.b64decode(before[key])
        for index,(quantity,virtual,checkpoint) in enumerate(previous[key]['positions']):
            if raw[118] != 0 and raw[119] != index:
                positions.append((quantity,virtual,checkpoint));continue
            virtual-=quantity*(funding[index]-checkpoint)
            if index == 0:
                quantity+=direction*lots;virtual-=direction*lots*price*SCALE
            positions.append((quantity,virtual,funding[index]))
        expected[key]['positions']=positions
    for key in report['roots']:
        assert actual[key]['cash'] == expected[key]['cash']
        assert actual[key]['positions'] == expected[key]['positions'], 'exact liquidation funding and paired fill'
    def health(value,bps):
        equity=value['cash']*SCALE;requirement=0
        for index,(quantity,virtual,checkpoint) in enumerate(value['positions']):
            claim=quantity*(lower[index] if quantity>=0 else upper[index])*SCALE+virtual-quantity*(funding[index]-checkpoint)
            equity+=min(0,claim)
            requirement+=(abs(quantity)*upper[index]*bps+9999)//10_000
        return equity-requirement*SCALE
    assert health(previous[target],500)<0
    assert min(health(actual[target],500),0)>health(previous[target],500), 'strict whole-account post-fee progress'
    receiver_reserved=integer(base64.b64decode(after[receiver]),289)
    assert health(actual[receiver],1000)>=receiver_reserved*SCALE, 'receiver covers conservative IM and live reservations'
    for key in report['ledgers']:
        old = account(before,key,'MarketLedger',125)
        new = account(after,key,'MarketLedger',125)
        # Revision/liability stamps can advance; protocol fees/reserves cannot.
        assert old[:10] == new[:10] and old[18:116] == new[18:116] and old[124:] == new[124:], 'liquidation protocol fee/reserve mutation'
    for key in [report['vault']]+report['userTokens']:
        assert before[key]==after[key], 'liquidation must not move SPL cash'


def mutations(report):
    cases=[('completedAccounts',report['roots'][0],121),('completedAccounts',report['roots'][0],137),
        ('completedAccounts',report['roots'][0],169),('completedAccounts',report['roots'][0],241),
        ('completedAccounts',report['pages'][0],61+1648),('completedAccounts',report['pages'][0],61+1664),
        ('completedAccounts',report['ledgers'][0],91),('rawAccounts',report['vault'],64),
        ('rawAccounts',report['reserveDestination'],64)]
    for snapshot,key,offset in cases:
        bad=copy.deepcopy(report); data=bytearray(base64.b64decode(bad[snapshot][key]));data[offset]^=1
        bad[snapshot][key]=base64.b64encode(data).decode()
        try: audit(bad)
        except AssertionError: pass
        else: raise AssertionError(f'accepted mutation {snapshot}/{key}/{offset}')
    # Preserve total cash/vault while changing the atom recipient.
    bad=copy.deepcopy(report)
    for index,delta in [(0,-1),(1,1)]:
        key=report['roots'][index];data=bytearray(base64.b64decode(bad['completedAccounts'][key]))
        data[121:129]=(integer(data,121)+delta).to_bytes(8,'little');bad['completedAccounts'][key]=base64.b64encode(data).decode()
    try: audit(bad)
    except AssertionError: pass
    else: raise AssertionError('accepted conserving wrong atom owner')
    return len(cases)+1


if __name__ == '__main__':
    report=json.load(open(sys.argv[1]))
    count,augmentations=audit(report)
    print(f'P26 independent raw audit: {count} exact Fraction payouts, {augmentations} augmentations, recovery/retirement/token invariants; {mutations(report)} corruptions rejected')
