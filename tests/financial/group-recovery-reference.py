#!/usr/bin/env python3
"""Independent seven-root emergency recovery and cash exit, from actual raw bytes."""
import base64
import copy
import importlib.util
import json
import sys
from pathlib import Path

spec=importlib.util.spec_from_file_location('reference',Path(__file__).with_name('group-safety-reference.py'))
reference=importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)

def audit(summary,captures):
    keys=summary['keys']
    states={name:reference.snapshot(raw,keys,allow_cross=True) for name,raw in captures.items()}
    for state in states.values():reference.normal(state)
    assert captures['await-valuation']==captures['waiting-unchanged']
    waiting,_=reference.resolution(states['await-valuation']['accounts'][keys['resolution']])
    valued,_=reference.resolution(states['frozen-emergency']['accounts'][keys['resolution']])
    assert waiting['stage']==1 and waiting['prices']==[0,0]
    assert valued['funding']==waiting['funding'] and valued['epoch']==waiting['epoch']
    result=reference.default_audit(states,keys,'emergency',count=7,prices=(60_000,30_000))
    before,after=states['resumed-emergency'],states['emergency-exit']
    # 204 is market count; three u64 epochs/sequence follow before mode at 229.
    assert before['group'][229]==after['group'][229]==1
    for key in ['cash','vault']:assert after['pools'][key]==before['pools'][key]-2
    for key in ['pool','insurance','fees']:assert after['pools'][key]==before['pools'][key]
    assert reference.integer(after['accounts'][keys['token']],64)==reference.integer(before['accounts'][keys['token']],64)+2
    for key,old,new in zip(before['members'],before['roots'],after['roots']):
        assert new['cash']==old['cash']-int(key in [keys['cross'],keys['isolated']])
        assert new['positions']==old['positions'] and new['reserved']==old['reserved']==0
    return dict(**result,withdrawn='2',cashAfter=str(after['pools']['cash']))

if __name__=='__main__':
    directory=Path(sys.argv[1]);summary=json.loads((directory/'summary.json').read_text());captures=json.loads((directory/'captures.json').read_text())
    result=audit(summary,captures);keys=summary['keys']
    changes=[('waiting-unchanged',keys['cross'],113),('frozen-emergency',keys['resolution'],87),
      ('complete-emergency',keys['resolution'],478),('emergency-exit',keys['cross'],113),
      ('emergency-exit',keys['token'],64),('resumed-emergency',keys['group'],229)]
    for label,key,offset in changes:
        altered=copy.deepcopy(captures);raw=bytearray(base64.b64decode(altered[label][key]));raw[offset]^=1;altered[label][key]=base64.b64encode(raw).decode()
        try:audit(summary,altered)
        except (AssertionError,KeyError):pass
        else:raise AssertionError(f'Accepted corruption: {label} at {offset}')
    print(json.dumps(dict(independentRawAudit='pass',mutationsRejected=len(changes),**result)))
