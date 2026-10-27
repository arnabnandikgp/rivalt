#!/usr/bin/env python3
"""P28 independent raw-byte accounting and literal internal-maker strategy audit."""
import base64
import copy
import importlib.util
import json
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location('account_wire', Path(__file__).with_name('account-trading-reference.py'))
wire = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wire)
SCALE = 10**9

def trunc_div(value, divisor):
    return abs(value) // divisor * (-1 if value < 0 else 1)

def audit(report):
    fills = exits = 0
    def decode(raw):
        result = wire.decode(report, raw)
        tokens = sum(wire.integer(base64.b64decode(raw[key]),64) for key in report['userTokens']+[report['vault']])
        assert tokens == wire.integer(base64.b64decode(raw[report['mint']]),36), 'minted token conservation'
        return result
    for step in report['financialSteps']:
        before,_,old_ledgers,old_cash = decode(step['before'])
        after,_,ledgers,cash = decode(step['after'])
        if step['status'] != 'finalized':
            assert before == after and ledgers == old_ledgers, 'failed transaction changed finances'
            continue
        if step['kind'] == 'exit':
            exits += 1
            assert old_cash-cash == int(step['amount']) and ledgers == old_ledgers
            for key, root in before.items():
                assert root['cash']-after[key]['cash'] == (int(step['amount']) if key == step['margin'] else 0)
                for index,(lots,virtual,checkpoint) in enumerate(root['positions']):
                    quantity,next_virtual,next_checkpoint = after[key]['positions'][index]
                    assert quantity == lots and next_virtual == virtual-lots*(next_checkpoint-checkpoint), 'exit funding ownership'
            continue
        fills += 1
        trader, market, side, lots = step['trader'], step['marketIndex'], step['side'], int(step['lots'])
        direction = 1 if side == 0 else -1
        reference = wire.integer(base64.b64decode(step['after'][report['markets'][market]]),116)
        gross = quantity = 0
        for maker_id, maker in enumerate(report['makers'][market]):
            key = maker['capital']
            old_quantity = before[key]['positions'][market][0]
            amount = abs(after[key]['positions'][market][0]-old_quantity)
            if amount == 0:
                continue
            old_registration = base64.b64decode(step['before'][maker['registration']])
            registration = base64.b64decode(step['after'][maker['registration']])
            # Owner renewal resets curve consumption. Quotes retain unchanged
            # prices/strategy; explicit epochs are separate from account funding.
            consumed = wire.integer(old_registration,308+side*8) if wire.integer(old_registration,276)==wire.integer(registration,276) else 0
            spread,flat,skew_step,skew_tick = (10,0,64,4) if maker_id == 0 else (30,256,256,1)
            center = reference-trunc_div(old_quantity,skew_step)*skew_tick
            # Direct marginal summation is independent of production's triangular
            # integral and optimizer, and works for the bounded drain routes too.
            leg = sum(center+direction*(spread+max(0,offset-flat)) for offset in range(consumed,consumed+amount))
            gross += leg
            quantity += amount
            assert after[key]['positions'][market][0] == old_quantity-direction*amount
            for index,(held,virtual,checkpoint) in enumerate(before[key]['positions']):
                _,next_virtual,next_checkpoint = after[key]['positions'][index]
                assert next_virtual == virtual-held*(next_checkpoint-checkpoint)+(direction*leg*SCALE if index==market else 0), 'provider quote/funding'
            assert after[key]['cash'] == before[key]['cash'], 'zero provider fee'
        assert quantity == lots
        assert after[trader]['positions'][market][0]-before[trader]['positions'][market][0] == direction*lots
        for index,(held,virtual,checkpoint) in enumerate(before[trader]['positions']):
            _,next_virtual,next_checkpoint = after[trader]['positions'][index]
            assert next_virtual == virtual-held*(next_checkpoint-checkpoint)-(direction*gross*SCALE if index==market else 0), 'trader quote/funding'
        fee = (gross+4999)//5000
        assert old_cash-cash == before[trader]['cash']-after[trader]['cash'] == fee, '2 bps once-only fee'
        for key in before:
            if key != trader:
                assert before[key]['cash'] == after[key]['cash'], 'sibling cash isolation'
        insurance = (old_ledgers[market]['carry']+fee)//4
        assert ledgers[market]['insurance']-old_ledgers[market]['insurance'] == insurance
        assert ledgers[market]['fees']-old_ledgers[market]['fees'] == fee-insurance
        assert ledgers[market]['carry'] == (old_ledgers[market]['carry']+fee)%4
        assert ledgers[market]['pool'] == old_ledgers[market]['pool']
        assert ledgers[1-market] == old_ledgers[1-market], 'market reserve attribution'
    decode(report['rawAccounts'])
    return fills,exits

if __name__ == '__main__':
    report=json.loads(Path(sys.argv[1]).read_text())
    fills,exits=audit(report)
    rejected=0
    for key,offset in [(report['roots'][-1],113),(report['roots'][-1],129),(report['ledgers'][0],83),(report['ledgers'][1],99),(report['vault'],64)]:
        broken=copy.deepcopy(report);data=bytearray(base64.b64decode(broken['rawAccounts'][key]));data[offset]^=1
        broken['rawAccounts'][key]=base64.b64encode(data).decode()
        try:audit(broken)
        except AssertionError:rejected+=1
        else:raise AssertionError('corrupted finances accepted')
    print(f'P28 independent audit: {fills} actual fills, {exits} busy exits, literal maker pricing and funding/fees/carry/token ownership; {rejected} corruptions rejected')
