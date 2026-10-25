#!/usr/bin/env python3
"""Independent raw-byte P21A service liquidation/default audit. No SDK/Rust imports."""
import base64
import copy
import importlib.util
import json
import sys
from pathlib import Path

spec=importlib.util.spec_from_file_location('group_reference',Path(__file__).with_name('group-safety-reference.py'))
reference=importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)
SCALE=10**9

def audit(summary,captures):
    keys=summary['keys']
    states={name:reference.snapshot(raw,keys,allow_cross=True) for name,raw in captures.items()}
    for name,state in states.items():
        if not name.startswith('frozen-'):reference.normal(state)
    before,after=states['before-liquidation'],states['after-liquidation']
    target=keys['roots'].index(keys['liquidationTarget']);receiver=keys['roots'].index(keys['receiver'])
    initial,final=before['roots'][target],after['roots'][target]
    initial_receiver,final_receiver=before['roots'][receiver],after['roots'][receiver]
    assert [position['lots'] for position in initial['positions']]==[100,5]
    assert [position['lots'] for position in final['positions']]==[36,5]
    assert [position['lots'] for position in initial_receiver['positions']]==[0,1]
    assert [position['lots'] for position in final_receiver['positions']]==[64,1]
    fee=min((64*52_000+1999)//2000,10_000,initial['cash'])
    assert fee==1664 and final['cash']==initial['cash']-fee and final_receiver['cash']==initial_receiver['cash']+fee
    assert before['pools']==after['pools']
    assert reference.deficit(initial,after['markets'])>reference.deficit(final,after['markets'])
    for old,new,side in [(initial,final,1),(initial_receiver,final_receiver,-1)]:
        for market in [0,1]:
            position=old['positions'][market];following=new['positions'][market];funding=after['markets'][market]['funding']
            expected=position['virtual']-position['lots']*(funding-position['checkpoint'])+(side*64*52_000*SCALE if market==0 else 0)
            assert following['virtual']==expected and following['checkpoint']==funding
    required=sum((abs(position['lots'])*market['upper']+9)//10 for position,market in zip(final_receiver['positions'],after['markets']))
    assert reference.equity(final_receiver,after['markets'])>=(required+final_receiver['reserved'])*SCALE
    for index,(old,new) in enumerate(zip(before['roots'],after['roots'])):
        if index not in [target,receiver]:assert old['raw']==new['raw']
    result=reference.default_audit(states,keys,'default')
    assert states['frozen-default']['pools']['insurance']==1007
    assert len(states['complete-default']['roots'])==64
    return dict(liquidationLots='64',fundedReceiverFee=str(fee),**result)

if __name__=='__main__':
    directory=Path(sys.argv[1]);summary=json.loads((directory/'summary.json').read_text());captures=json.loads((directory/'captures.json').read_text())
    result=audit(summary,captures);keys=summary['keys']
    corruptions=[('after-liquidation',keys['liquidationTarget'],113),('after-liquidation',keys['receiver'],177),
        ('frozen-default',keys['resolution'],87),('complete-default',keys['liquidationTarget'],113),
        ('complete-default',keys['resolution'],478),('resumed-default',keys['group'],255)]
    for label,key,offset in corruptions:
        altered=copy.deepcopy(captures);raw=bytearray(base64.b64decode(altered[label][key]));raw[offset]^=1;altered[label][key]=base64.b64encode(raw).decode()
        try:audit(summary,altered)
        except (AssertionError,KeyError):pass
        else:raise AssertionError(f'Accepted corruption: {label} at {offset}')
    print(json.dumps(dict(independentRawAudit='pass',mutationsRejected=len(corruptions),**result)))
