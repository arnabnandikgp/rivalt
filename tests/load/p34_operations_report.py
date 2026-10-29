"""Independent operational receipt/resource audit, after raw financial replay."""
import base64
import collections
import json
from pathlib import Path
import subprocess
import sys
from p32_comparison import quantile
from p34_report import decode_base58, writable_keys


def encode_base58(raw):
    alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    value=int.from_bytes(raw,'big');digits=''
    while value:
        value,remainder=divmod(value,58);digits=alphabet[remainder]+digits
    return '1'*(len(raw)-len(raw.lstrip(b'\0')))+digits


def audit(path):
    path=Path(path);run=json.loads(path.read_text());directory=path.parent
    assert run['trackedDirty'] is False and run['allFundedAccountsExited'] is True
    assert run['defaultDevnetActivation'] is False and run['externalGateClosed'] is False
    assert len(run['restarts'])==1 and run['restarts'][0]['uploaded']>0
    financial=subprocess.check_output([sys.executable,'tests/financial/account-workers-reference.py',str(directory/'financial-capture.json')],text=True).strip()
    service=run['serviceReport'];assert service['freshReplayIdentical']
    assert service['counts']['unresolved']=='0' and service['counts']['events']==service['counts']['outbox']
    assert len(service['state']['roots'])==10
    for root in service['state']['roots'].values():
        assert root['cash']=='0'
        assert all(p['lots']=='0' and p['virtualScaled']=='0' for p in root['positions'])
    assert service['reconciliation']['unallocatedSurplus']=='0'
    remaining=sum(int(ledger['fees'])+int(ledger['insurance']) for ledger in service['state']['ledgers'].values())
    assert remaining==int(run['remainingVaultAtoms'])==int(service['reconciliation']['actualVault'])
    transactions={row['requestId']:row['payload'] for row in json.loads((directory/'service-transactions.json').read_text())}
    resources=collections.defaultdict(list);errors=collections.Counter()
    for intent in service['intents']:
        assert intent['status'] in ('finalized','failed')
        transaction=transactions[intent['request_id']];wire=base64.b64decode(intent['wire'],validate=True)
        version=1 if wire[0]==129 else 0
        count=wire[1] if version==1 else wire[0]
        assert 0<count<5 and count==len(transaction['transaction']['signatures'])
        offset=len(wire)-64*count if version==1 else 1
        assert encode_base58(wire[offset:offset+64])==intent['signature']==transaction['transaction']['signatures'][0]
        if version==0:assert wire[1+64*count]==128
        assert version in (0,1) and len(wire)<=(1232 if version==0 else 4096)
        message=transaction['transaction']['message'];keys=message['accountKeys']
        assert not transaction['meta'].get('loadedAddresses',{}).get('writable')
        limits=[]
        if version==1:
            limits=[message['transactionConfig']['computeUnitLimit']]
            assert message['transactionConfig']['priorityFee']==0
        else:
            for instruction in message['instructions']:
                if keys[instruction['programIdIndex']]=='ComputeBudget111111111111111111111111111111':
                    data=decode_base58(instruction['data'])
                    if data[0]==2:limits.append(int.from_bytes(data[1:],'little'))
                    if data[0]==3:assert int.from_bytes(data[1:],'little')==0
        assert len(limits)==1
        units=transaction['meta']['computeUnitsConsumed'];assert units*5<=limits[0]*4
        publisher=intent['budget'].startswith('liquidity-funding-')
        assert limits[0]<=(200000 if publisher else 1200000) and len(set(keys))<=(20 if publisher else 32)
        assert transaction['meta']['err']==intent['result']['error']
        assert int(transaction['meta']['fee'])==int(intent['result']['fee'])<=20000
        resources[intent['budget']].append(dict(units=units,limit=limits[0],bytes=len(wire),keys=len(set(keys)),
            fee=int(transaction['meta']['fee']),writable=sorted(writable_keys(transaction))))
        if transaction['meta']['err']:errors[json.dumps(transaction['meta']['err'],sort_keys=True)]+=1
    for check in run['checks']:
        assert check['computeUnits']*5<=check['computeUnitLimit']*4
        assert check['bytes']<=(1232 if check['version']==0 else 4096) and check['loadedAccounts']<=32
    timings=service['publisherTimings'];assert len(timings)>=4
    measurements={field:{f'p{p}':quantile([row[field] for row in timings],p) for p in (50,95,99)}
                  for field in ('readAndCalculateMs','buildToPersistMs','buildToObservedConfirmationMs')}
    result=dict(result='pass',revision=run['revision'],financial_audit=financial,roots_exited=10,
                remaining_vault_atoms=str(remaining),remaining_vault_scope='market insurance plus protocol fees only',
                resolved_originals=len(service['intents']),failed_originals=dict(errors),publisher_timing_count=len(timings),
                publisher_timings=measurements,publisher_timing_scope=timings[0]['observationScope'],
                resources={budget:dict(count=len(rows),max_cu=max(row['units'] for row in rows),max_bytes=max(row['bytes'] for row in rows),
                    max_keys=max(row['keys'] for row in rows),network_fee_lamports=str(sum(row['fee'] for row in rows)),
                    writable_union=sorted(set().union(*(set(row['writable']) for row in rows)))) for budget,rows in resources.items()},
                independent_maker_validation=False,endurance_24h=False)
    (directory/'independent-operations-audit.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))


if __name__=='__main__':audit(sys.argv[1])
