#!/usr/bin/env python3
"""Fresh P27 worker audit: raw bytes and independent Fraction economics only."""
import base64
import copy
from fractions import Fraction
import importlib.util
import json
from pathlib import Path
import sys
from account_contract_reference import Account
from clearing_network_reference import clear_atom_cohort

spec=importlib.util.spec_from_file_location('safety_wire',Path(__file__).with_name('account-safety-reference.py'))
wire=importlib.util.module_from_spec(spec)
spec.loader.exec_module(wire)
SCALE=10**9

def audit(report):
    frozen,completed=report['frozenAccounts'],report['completedAccounts']
    initial=wire.header(frozen,report['resolution']);finished=wire.header(completed,report['resolution'])
    assert initial['stage']==2 and finished['stage']==11 and initial['epoch']==finished['epoch']
    assert finished['count']==finished['cursor']==len(report['roots'])
    def balanced(raw):
        roots,markets,ledgers,cash=wire.wire.decode(report,raw)
        tokens=sum(wire.integer(base64.b64decode(raw[key]),64) for key in report['userTokens']+[report['vault']])
        assert tokens==wire.integer(base64.b64decode(raw[report['mint']]),36),'actual minted token conservation'
        return roots,markets,ledgers,cash
    previous,_,initial_ledgers,cash=balanced(frozen);assert cash==initial['cash']
    accounts=[]
    for key in report['roots']:
        root=previous[key]
        claims=tuple(Fraction(lots*initial['prices'][index]*SCALE+virtual-lots*(initial['funding'][index]-checkpoint),SCALE)
            for index,(lots,virtual,checkpoint) in enumerate(root['positions']))
        accounts.append(Account(root['cash'],claims))
    expected=clear_atom_cohort(tuple(accounts),initial['pools'],initial['insurance'],initial['fees'])
    actual,_,ledgers,cash=balanced(completed)
    assert finished['spent']==expected.insurance_spent
    assert finished['budgets']==expected.effective_insurance_budgets
    assert finished['evaluation']+1==expected.insurance_passes
    assert tuple(actual[key]['cash'] for key in report['roots'])==expected.cash,'independent exact atom ownership'
    assert cash==sum(expected.cash)==finished['cash_applied']
    for market in range(2):
        assert Fraction(finished['rates'][market],finished['common']*finished['factor'])==expected.benchmark.rates[market]
        assert ledgers[market]['pool']==0 and ledgers[market]['insurance']==initial['insurance'][market]-expected.insurance_spent[market]
        assert ledgers[market]['fees']==initial['fees'][market]
        assert ledgers[market]['carry']==initial_ledgers[market]['carry'],'default preserves market fee carry'
    for index,key in enumerate(report['roots']):
        root=actual[key];assert all(lots==virtual==0 for lots,virtual,_ in root['positions'])
        data=base64.b64decode(completed[key]);assert data[233:273]==bytes(40) and wire.integer(data,281)==0 and data[297:969]==bytes(672)
        page=wire.account(completed,report['pages'][index//2],'ResolutionPageV3',3400);offset=53+(index%2)*1673
        assert wire.integer(page,offset+1664)==expected.cash[index] and page[offset+1672]==1
        for market in range(2):
            claim=wire.integer(page,offset+72+market*16,16,True)
            assert Fraction(claim,SCALE)==accounts[index].claims[market]
            movement=wire.integer(page,offset+1648+market*8)*(-1 if claim<0 else 1 if claim>0 else 0)
            assert movement==expected.claim_cash_movements[index][market]
    recovered,markets,recovered_ledgers,_=balanced(report['recoveredAccounts'])
    assert recovered==actual and recovered_ledgers==ledgers
    assert tuple(market['funding'] for market in markets)==initial['funding'],'frozen interval never charged'
    final,_,final_ledgers,_=balanced(report['finalAccounts'])
    for index,key in enumerate(report['roots']):assert final[key]['cash']==expected.cash[index]-(100 if index==0 else 0)
    assert final_ledgers==ledgers
    step=report['liquidation'];before,_,_,before_cash=balanced(step['before']);after,_,_,after_cash=balanced(step['after'])
    assert before_cash==after_cash
    target,receiver=step['target'],step['receiver']
    assert abs(after[target]['positions'][0][0])<abs(before[target]['positions'][0][0]),'liquidation progress'
    # Account risk uses adverse bounds, no positive credit. Price offsets are
    # independent raw-layout constants, not generated SDK/production arithmetic.
    def deficit(raw,root):
        equity=root['cash']*SCALE;requirement=0
        for index,(lots,virtual,checkpoint) in enumerate(root['positions']):
            market=base64.b64decode(raw[report['markets'][index]])
            funding=wire.integer(market,76,16,True)
            lower=wire.integer(market,124);upper=wire.integer(market,132)
            claim=virtual-lots*(funding-checkpoint)+lots*(upper if lots<0 else lower)*SCALE
            equity+=min(claim,0);requirement+=(abs(lots)*upper+19)//20
        return max(requirement*SCALE-equity,0)
    assert deficit(step['after'],after[target])<deficit(step['before'],before[target]),'strict post-fee whole-account progress'
    assert before[target]['cash']+before[receiver]['cash']==after[target]['cash']+after[receiver]['cash']
    lots=before[target]['positions'][0][0]-after[target]['positions'][0][0]
    price=wire.integer(base64.b64decode(step['after'][report['markets'][0]]),116)
    fee=min((lots*price+1999)//2000,10_000,before[target]['cash'])
    assert after[target]['cash']==before[target]['cash']-fee and after[receiver]['cash']==before[receiver]['cash']+fee
    for key,direction in [(target,-1),(receiver,1)]:
        for index,(quantity,virtual,checkpoint) in enumerate(before[key]['positions']):
            next_quantity,next_virtual,next_checkpoint=after[key]['positions'][index]
            assert next_quantity==quantity+(direction*lots if index==0 else 0)
            assert next_virtual==virtual-quantity*(next_checkpoint-checkpoint)-(direction*lots*price*SCALE if index==0 else 0)
    return len(accounts),expected.augmentations

if __name__=='__main__':
    report=json.loads(Path(sys.argv[1]).read_text());count,augmentations=audit(report)
    rejected=0
    for key,offset in [(report['roots'][0],113),(report['ledgers'][0],91),(report['ledgers'][0],99),(report['ledgers'][1],83),(report['vault'],64)]:
        corrupt=copy.deepcopy(report);data=bytearray(base64.b64decode(corrupt['completedAccounts'][key]));data[offset]^=1
        corrupt['completedAccounts'][key]=base64.b64encode(data).decode()
        try:audit(corrupt)
        except AssertionError:rejected+=1
        else:raise AssertionError('mutated financial state accepted')
    print(f'P27 worker audit: {count} exact Fraction payouts, {augmentations} augmentations, actual liquidation/recovery/exit; {rejected} corruptions rejected')
