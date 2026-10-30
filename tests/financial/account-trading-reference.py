#!/usr/bin/env python3
"""Independent schema-5 wire audit. No SDK, program, or production math imports."""
import base64
import copy
import json
import hashlib
import sys

SCALE = 10**9

def integer(data, offset, width=8, signed=False):
    return int.from_bytes(data[offset:offset+width], 'little', signed=signed)

def checked(data, name, size):
    assert len(data) == size and data[:8] == hashlib.sha256(f'account:{name}'.encode()).digest()[:8]
    assert integer(data,8,2) == 5 and integer(data,10) > 0
    return data

def root(data):
    checked(data, 'MarginAccount', 978)
    positions=[]
    for index in range(2):
        offset=129+48*index
        positions.append((integer(data,offset,signed=True),integer(data,offset+8,16,True),integer(data,offset+24,16,True)))
    orders=[]
    for index in range(4):
        offset=329+141*index+9
        orders.append({'id':integer(data,offset),'filled':integer(data,offset+34),'notional':integer(data,offset+42),'fee':integer(data,offset+50)})
    return {'cash':integer(data,121),'role':data[120],'positions':positions,'orders':orders}

def decode(report, raw):
    data={key:base64.b64decode(value) for key,value in raw.items()}
    roots={key:root(data[key]) for key in report['roots']}
    markets=[{'funding':integer(checked(data[key], 'Market', 455),84,16,True),'gross':integer(data[key],108)} for key in report['markets']]
    ledgers=[]
    for index,key in enumerate(report['ledgers']):
        ledger=checked(data[key], 'MarketLedger', 117)
        assert ledger[82]==index
        ledgers.append({'pool':integer(ledger,83),'insurance':integer(ledger,91),'fees':integer(ledger,99),'carry':ledger[107]})
        assert ledger[107]<4
    custody=checked(data[report['custody']], 'Custody', 83)
    cash=sum(account['cash'] for account in roots.values())
    assert cash==integer(custody,50), 'root cash versus custody'
    allocated=cash+sum(ledger['pool']+ledger['insurance']+ledger['fees'] for ledger in ledgers)
    assert allocated==integer(custody,58)==integer(data[report['vault']],64), 'exact allocated vault'
    for index,market in enumerate(markets):
        assert sum(account['positions'][index][0] for account in roots.values())==0, 'paired quantity'
        assert sum(abs(account['positions'][index][0]) for account in roots.values())==market['gross'], 'gross exposure'
        # At a common funding endpoint, zero aggregate q removes common-price
        # valuation. All funding fractions remain owned in the scaled v balance.
        claims=sum(virtual-lots*(market['funding']-checkpoint)
            for account in roots.values() for lots,virtual,checkpoint in [account['positions'][index]])
        assert claims==ledgers[index]['pool']*SCALE, 'per-market scaled claim conservation'
    return roots,markets,ledgers,cash

def audit(report):
    fills=0
    for step in report['financialSteps']:
        before,old_markets,old_ledgers,old_cash=decode(report,step['before'])
        after,markets,ledgers,cash=decode(report,step['after'])
        changed=[(key,index) for key,account in before.items() for index in range(2)
            if account['positions'][index][0]!=after[key]['positions'][index][0]]
        if not changed:
            assert cash==old_cash, 'non-fill consumed account cash'
            assert old_ledgers==ledgers, 'non-fill mutated market fee/carry'
            continue
        fills+=1
        indices={index for _,index in changed};assert len(indices)==1
        index=indices.pop()
        traders=[key for key,_ in changed if before[key]['role']!=1];assert len(traders)==1
        trader=traders[0]
        lots,virtual,checkpoint=before[trader]['positions'][index]
        expected_accrued=virtual-lots*(markets[index]['funding']-checkpoint)
        notional_delta=after[trader]['positions'][index][1]-expected_accrued
        assert notional_delta%SCALE==0
        gross=abs(notional_delta)//SCALE
        prefix=0
        for old_order,new_order in zip(before[trader]['orders'],after[trader]['orders']):
            if old_order['id']==new_order['id'] and new_order['filled']>old_order['filled']:
                prefix=old_order['notional'];assert new_order['notional']-prefix==gross
                assert new_order['fee']==(prefix+gross+4999)//5000
        fee=(prefix+gross+4999)//5000-(prefix+4999)//5000
        assert old_cash-cash==fee==before[trader]['cash']-after[trader]['cash'], 'once-only cumulative taker fee'
        for key,account in before.items():
            if key!=trader:assert after[key]['cash']==account['cash'], 'provider fee or sibling cash charge'
        old,new=old_ledgers[index],ledgers[index]
        insurance=(old['carry']+fee)//4
        assert new['insurance']-old['insurance']==insurance, 'insurance attribution'
        assert new['fees']-old['fees']==fee-insurance, 'retained fee'
        assert new['carry']==(old['carry']+fee)%4, 'per-market cumulative carry'
        assert new['pool']==old['pool']
        assert ledgers[1-index]==old_ledgers[1-index], 'unrelated market fee/reserve mutation'
        for key,_ in changed:
            assert after[key]['positions'][index][2]==markets[index]['funding'], 'consumed funding checkpoint'
    decode(report,report['rawAccounts'])
    return fills

def mutations(report):
    rejected=0
    targets=[(report['roots'][0],121),(report['roots'][0],137),(report['roots'][0],129),
        (report['ledgers'][0],83),(report['ledgers'][0],91),(report['ledgers'][0],99),(report['custody'],58)]
    for key,offset in targets:
        broken=copy.deepcopy(report);data=bytearray(base64.b64decode(broken['rawAccounts'][key]));data[offset]^=1
        broken['rawAccounts'][key]=base64.b64encode(data).decode()
        try:audit(broken)
        except AssertionError:rejected+=1
        else:raise AssertionError(('audit accepted financial mutation',key,offset))
    broken=copy.deepcopy(report)
    step=next(step for step in broken['financialSteps'] if 'fill' in step['label'])
    key=report['ledgers'][0];data=bytearray(base64.b64decode(step['after'][key]));data[107]=(data[107]+1)%4
    step['after'][key]=base64.b64encode(data).decode()
    try:audit(broken)
    except AssertionError:rejected+=1
    else:raise AssertionError('audit accepted a changed carry with unchanged cash totals')
    return rejected

if __name__=='__main__':
    report=json.load(open(sys.argv[1]));fills=audit(report);count=mutations(report)
    print(f'P24 independent wire audit: {len(report["financialSteps"])} transitions, {fills} fills, {count} mutations rejected')
