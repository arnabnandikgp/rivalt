#!/usr/bin/env python3
"""Independent raw-byte group ledger/default audit. No SDK or Rust imports."""
import base64
import copy
import hashlib
import json
import sys
from pathlib import Path

SCALE = 10**9
ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

def address_bytes(value):
    number = 0
    for character in value:
        number = number * 58 + ALPHABET.index(character)
    return number.to_bytes(32, 'big')

def integer(data, offset, width=8, signed=False):
    assert len(data[offset:offset+width]) == width
    return int.from_bytes(data[offset:offset+width], 'little', signed=signed)

def account(data, name, size):
    assert len(data) == size
    assert data[:8] == hashlib.sha256(f'account:{name}'.encode()).digest()[:8]
    assert integer(data, 8, 2) == 2

def root(data, allow_cross=False):
    account(data, 'MarginAccountV2', 970)
    positions = [dict(lots=integer(data, start, signed=True), virtual=integer(data, start+8,16,True),
                      checkpoint=integer(data,start+24,16,True), generation=integer(data,start+40)) for start in [121,169]]
    mode, market = data[110], data[111]
    assert mode in [0,1] and data[112] in [0,1,2]
    if mode == 1:
        assert market in [0,1]
        assert all(value == 0 for value in positions[1-market].values())
    else:
        assert market == 255 and data[112] != 1
        if not allow_cross:
            assert all(position['lots'] == position['virtual'] == 0 for position in positions)
    return dict(id=integer(data,108,2), cash=integer(data,113), positions=positions,
                mode=mode, market=market, reserved=integer(data,281), raw=data)

def claims(root, prices, funding):
    return [position['lots'] * price * SCALE + position['virtual'] - position['lots'] * (index-position['checkpoint'])
            for position,price,index in zip(root['positions'],prices,funding)]

def equity(root, markets):
    value = root['cash'] * SCALE
    for position,market in zip(root['positions'],markets):
        price = market['upper'] if position['lots'] < 0 else market['lower']
        claim = position['lots'] * price * SCALE + position['virtual'] - position['lots'] * (market['funding']-position['checkpoint'])
        value += min(claim,0)
    return value

def deficit(root, markets):
    required = sum((abs(position['lots'])*market['upper']*500+9999)//10000 for position,market in zip(root['positions'],markets))
    return max(required*SCALE-equity(root,markets),0)

class Reader:
    def __init__(self,data,offset=0): self.data,self.offset = data,offset
    def number(self,width=8,signed=False):
        result=integer(self.data,self.offset,width,signed);self.offset+=width;return result
    def array(self,count,width=8,signed=False): return [self.number(width,signed) for _ in range(count)]

def resolution(data):
    account(data,'GroupResolutionV2',9127)
    reader=Reader(data,42)
    header=dict(epoch=reader.number(),stage=reader.number(1),cursor=reader.number(2),count=reader.number(2))
    header['registry_hash']=data[reader.offset:reader.offset+32];reader.offset+=32
    header['prices']=reader.array(2);header['funding']=reader.array(2,16,True);header['frozen_at']=reader.number(8,True)
    for name in ['initial_cash','initial_pool','initial_insurance','initial_fees','initial_vault','scanned_cash']: header[name]=reader.number()
    header['scanned_lots']=reader.array(2,16,True);header['scanned_gross']=reader.array(2)
    header['claim_sum']=reader.number(16,True);header['remaining_lots']=reader.array(2,16,True);header['remaining_gross']=reader.array(2)
    for name in ['debt','positive']: header[name]=reader.number(16)
    for name in ['insured_atoms','plan_pool']: header[name]=reader.number()
    header['assigned']=reader.number(16);header['extra']=reader.number(2);header['rounding_sum']=reader.number(16,True)
    for name in ['collected_total','paid_applied']: header[name]=reader.number()
    header['insurance_moved']=reader.number(1)
    header['recovery_since']=reader.number(8,True);header['recovery_last']=reader.number(8,True)
    assert reader.offset == 418
    length=reader.number(4);assert length<=64
    rows=[]
    for _ in range(length):
        row=dict(cash_before=reader.number(),lots=reader.array(2,8,True),generations=reader.array(2))
        row['claim_scaled']=reader.number(16,True);row['collected']=reader.number()
        row['insured_scaled']=reader.number(16);row['impaired_scaled']=reader.number(16);row['paid']=reader.number()
        row['rounding_scaled']=reader.number(16,True);row['remainder']=reader.number(16);rows.append(row)
    return header,rows

def snapshot(raw,keys,allow_cross=False):
    accounts={key:base64.b64decode(value,validate=True) for key,value in raw.items() if value is not None}
    group=accounts[keys['group']];account(group,'ClearingGroupV2',273)
    assert group[204]==2 and integer(group,10,2)==2
    pools=dict(zip(['cash','pool','insurance','fees','vault'],[integer(group,offset) for offset in [231,239,247,255,263]]))
    assert pools['cash']+pools['pool']+pools['insurance']+pools['fees']==pools['vault']
    vault=accounts[keys['vault']];assert len(vault)==165 and integer(vault,64)>=pools['vault']
    assert vault[:32]==group[76:108] and vault[32:64]==address_bytes(keys['group'])
    registry=accounts[keys['registry']];account(registry,'GroupRegistryV2',2097)
    count=integer(registry,42,2);assert integer(registry,44,4)==count and 0<count<=64
    by_address={address_bytes(key):key for key in keys['roots']}
    members=[by_address[registry[48+32*index:80+32*index]] for index in range(count)]
    assert len(set(members))==count
    roots=[root(accounts[key],allow_cross) for key in members]
    for index,entry in enumerate(roots):
        assert entry['id']==index and entry['raw'][10:42]==address_bytes(keys['group'])
    assert sum(root['cash'] for root in roots)==pools['cash']
    markets=[]
    for index,key in enumerate(keys['markets']):
        data=accounts[key];account(data,'GroupMarketV2',446)
        assert data[42]==index and data[10:42]==address_bytes(keys['group'])
        markets.append(dict(funding=integer(data,75,16,True),gross=integer(data,99),price=integer(data,115),lower=integer(data,123),upper=integer(data,131)))
    return dict(accounts=accounts,group=group,pools=pools,members=members,roots=roots,markets=markets,registry=registry)

def normal(snapshot):
    roots,markets,pools=snapshot['roots'],snapshot['markets'],snapshot['pools']
    for index,market in enumerate(markets):
        assert sum(root['positions'][index]['lots'] for root in roots)==0
        assert sum(abs(root['positions'][index]['lots']) for root in roots)==market['gross']
    total=sum(sum(claims(root,[market['price'] for market in markets],[market['funding'] for market in markets])) for root in roots)
    assert total==pools['pool']*SCALE

def allocate(total,weights):
    denominator=sum(weights)
    if denominator==0:
        assert total==0
        return [0]*len(weights)
    assert 0<=total<=denominator
    divided=[divmod(total*weight,denominator) for weight in weights]
    floors=[part[0] for part in divided]
    order=sorted(range(len(weights)),key=lambda index:(-divided[index][1],index))
    for index in order[:total-sum(floors)]:floors[index]+=1
    assert sum(floors)==total
    return floors

def audit(summary,captures,allow_cross=False):
    keys=summary['keys']
    states={name:snapshot(raw,keys,allow_cross) for name,raw in captures.items()}
    for name,state in states.items():
        if not name.startswith('frozen-'):normal(state)
    before,after=states['before-liquidation'],states['after-liquidation']
    target_id=keys['roots'].index(keys.get('liquidationTarget',keys['roots'][0]))
    target_before,target_after=before['roots'][target_id],after['roots'][target_id]
    receiver_before,receiver_after=before['roots'][7],after['roots'][7]
    assert target_before['positions'][0]['lots']==100 and target_after['positions'][0]['lots']==50
    assert receiver_before['positions'][0]['lots']==0 and receiver_after['positions'][0]['lots']==50
    fee=min((50*52_000+1999)//2000,10_000,target_before['cash'])
    assert fee==1300 and target_after['cash']==target_before['cash']-fee and receiver_after['cash']==receiver_before['cash']+fee
    assert before['pools']==after['pools']
    assert deficit(target_after,after['markets'])<deficit(target_before,after['markets'])
    for previous,current,side in [(target_before,target_after,1),(receiver_before,receiver_after,-1)]:
        position=previous['positions'][0];funding=after['markets'][0]['funding']
        expected=position['virtual']-position['lots']*(funding-position['checkpoint'])+side*50*52_000*SCALE
        assert current['positions'][0]['virtual']==expected and current['positions'][0]['checkpoint']==funding
    result=default_audit(states,keys,'default')
    if 'frozen-emergency' in states:
        result['emergency']=default_audit(states,keys,'emergency')
        waiting,_=resolution(states['await-valuation']['accounts'][keys['resolution']])
        valued,_=resolution(states['frozen-emergency']['accounts'][keys['resolution']])
        assert waiting['stage']==1 and waiting['prices']==[0,0]
        assert waiting['funding']==valued['funding'] and waiting['epoch']==valued['epoch']
    for check in summary['checks']:
        assert check['bytes']<=1232
        if check['status']=='pass':assert int(check['computeUnits'])*5<=check['declaredComputeUnits']*4
    return result

def default_audit(states,keys,label):
    frozen,complete=states[f'frozen-{label}'],states[f'complete-{label}']
    header,_=resolution(frozen['accounts'][keys['resolution']]);finished,rows=resolution(complete['accounts'][keys['resolution']])
    assert header['stage']==2 and finished['stage']==12 and header['count']==finished['count']==64
    assert header['prices']==[10_000,40_000] and header['funding']==[market['funding'] for market in frozen['markets']]
    assert header['registry_hash']==hashlib.sha256(frozen['registry'][48:48+64*32]).digest()
    assert complete['members']==frozen['members']
    cash=[entry['cash'] for entry in frozen['roots']]
    initial_claims=[sum(claims(entry,header['prices'],header['funding'])) for entry in frozen['roots']]
    assert sum(initial_claims)==header['initial_pool']*SCALE
    target_id=keys['roots'].index(keys.get('liquidationTarget',keys['roots'][0]))
    if label=='default':assert cash[target_id]*SCALE+initial_claims[target_id]<0
    collected=[min(balance,max(-claim,0)//SCALE) for balance,claim in zip(cash,initial_claims)]
    residual=[claim+amount*SCALE for claim,amount in zip(initial_claims,collected)]
    debt=[max(-claim,0) for claim in residual];positive=[max(claim,0) for claim in residual]
    insurance=min(sum(debt)//SCALE,header['initial_insurance'])
    insured=allocate(insurance*SCALE,debt)
    impaired=allocate(sum(debt)-insurance*SCALE,positive)
    entitlement=[claim-loss for claim,loss in zip(positive,impaired)]
    pool=header['initial_pool']+sum(collected)+insurance
    assert sum(entitlement)==pool*SCALE
    paid=[claim//SCALE for claim in entitlement]
    order=sorted(range(64),key=lambda index:(-(entitlement[index]%SCALE),index))
    for index in order[:pool-sum(paid)]:paid[index]+=1
    rounding=[amount*SCALE-claim for amount,claim in zip(paid,entitlement)]
    assert sum(rounding)==0 and all(abs(value)<SCALE for value in rounding)
    for index,(row,initial,final) in enumerate(zip(rows,frozen['roots'],complete['roots'])):
        assert row['cash_before']==cash[index] and row['lots']==[position['lots'] for position in initial['positions']]
        assert row['generations']==[position['generation'] for position in initial['positions']]
        assert [row[name] for name in ['claim_scaled','collected','insured_scaled','impaired_scaled','paid','rounding_scaled']]==[
            residual[index],collected[index],insured[index],impaired[index],paid[index],rounding[index]]
        assert final['cash']==cash[index]-collected[index]+paid[index]
        assert final['reserved']==0 and all(position['lots']==position['virtual']==0 for position in final['positions'])
        for old,new in zip(initial['positions'],final['positions']):assert new['generation']==old['generation']+int(old['lots']!=0)
    assert finished['collected_total']==sum(collected) and finished['paid_applied']==pool
    assert complete['pools']['fees']==frozen['pools']['fees'] and complete['pools']['vault']==frozen['pools']['vault']
    assert complete['pools']['pool']==0 and complete['pools']['insurance']==header['initial_insurance']-insurance
    assert states[f'resumed-{label}']['pools']==complete['pools']
    return dict(members=64,collected=str(sum(collected)),insurance=str(insurance),paid=str(pool),impairedScaled=str(sum(impaired)),roundingSum=str(sum(rounding)))

def ordinary_audit(summary,captures):
    states={name:snapshot(raw,summary['keys']) for name,raw in captures.items()}
    for state in states.values():normal(state)
    assert states['activated-empty']['pools']==dict(cash=2_002_000_000,pool=0,insurance=0,fees=0,vault=2_002_000_000)
    # Literal independent maker-curve sums: A buy 20 at reference+10+[0..19],
    # then sell at reference-10-[0..19] (separate side consumption counters);
    # B buys/sells 30 at reference +/-30. A earns 780, B earns 1,800 per market.
    for market,price,fee in [(0,60_000,601),(1,30_000,301)]:
        opened=states[f'opened-{market}'];position=opened['roots'][market]['positions'][market]
        assert position['lots']==50 and position['virtual']==-(50*price+1_290)*SCALE
        assert opened['roots'][market]['cash']==1_000_000-fee
        assert opened['roots'][2+market]['positions'][market]['lots']==-20
        assert opened['roots'][4+market]['positions'][market]['lots']==-30
    final=states['ordinary-lifecycle']
    assert integer(final['accounts'][summary['keys']['vault']],64)==final['pools']['vault']
    assert [entry['cash'] for entry in final['roots']]==[996_209,996_729,500_000_780,500_000_780,500_001_800,500_001_800,0]
    assert final['pools']==dict(cash=2_001_998_098,pool=0,insurance=0,fees=1_802,vault=2_001_999_900)
    assert all(position['lots']==position['virtual']==0 for entry in final['roots'] for position in entry['positions'])
    for check in summary['checks']:
        assert check['bytes']<=1232
        if check['status']=='pass':assert int(check['computeUnits'])*5<=check['declaredComputeUnits']*4
    return dict(markets=2,roots=7,fees='1802',withdrawn='100',fundedCash='2001998098')

if __name__=='__main__':
    directory=Path(sys.argv[1]);summary=json.loads((directory/'summary.json').read_text());captures=json.loads((directory/'captures.json').read_text())
    ordinary='--ordinary' in sys.argv
    check_audit=ordinary_audit if ordinary else audit
    result=check_audit(summary,captures)
    if ordinary:
        changes=[('ordinary-lifecycle',summary['keys']['roots'][0],113),('ordinary-lifecycle',summary['keys']['group'],255),
                 ('opened-1',summary['keys']['roots'][1],169),('ordinary-lifecycle',summary['keys']['vault'],64)]
    else:
        changes=[('complete-default',summary['keys']['roots'][0],113),('complete-default',summary['keys']['group'],255),
                 ('frozen-default',summary['keys']['resolution'],87),('complete-default',summary['keys']['resolution'],478),
                 ('complete-default',summary['keys']['roots'][1],129),('after-liquidation',summary['keys']['roots'][7],113)]
    for label,key,offset in changes:
        altered=copy.deepcopy(captures);data=bytearray(base64.b64decode(altered[label][key]));data[offset]^=1;altered[label][key]=base64.b64encode(data).decode()
        try:check_audit(summary,altered)
        except (AssertionError,KeyError):pass
        else:raise AssertionError(f'audit accepted corrupted {label} at {offset}')
    print(json.dumps({'independentRawAudit':'pass','mutationsRejected':len(changes),**result}))
