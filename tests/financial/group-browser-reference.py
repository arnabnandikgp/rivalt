#!/usr/bin/env python3
"""Independent literal browser cash/fee/token ledger, with raw account invariants."""
import base64
import copy
import importlib.util
import json
import sys
from pathlib import Path

spec=importlib.util.spec_from_file_location('reference',Path('tests/financial/group-safety-reference.py'))
reference=importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)

def audit(summary,raw):
    keys=summary['keys'];state=reference.snapshot(raw,keys,allow_cross=True);reference.normal(state)
    assert len(state['roots'])==9 and state['group'][229]==2
    cross=state['roots'][state['members'].index(keys['cross'])]
    isolated=state['roots'][state['members'].index(keys['isolated'])]
    assert cross['mode']==0 and isolated['mode']==1 and isolated['market']==1
    # Five-lot buys/sells select A: 10..14 atoms spread at first consumption,
    # 15..19 for the next ETH round, both strictly below B's 30-atom spread.
    # Epoch renewal can reset consumption; both ranges have the same fee ceilings.
    # Fees ceil(notional/5000): BTC 61+60; ETH cross 31+30; ETH isolated 31+30.
    fees=(300_060+4999)//5000+(299_940+4999)//5000
    fees+=(150_060+4999)//5000+(149_940+4999)//5000
    isolated_fees=(150_085+4999)//5000+(149_915+4999)//5000
    assert fees==182 and isolated_fees==61
    assert cross['cash']==1_000_000-fees-7-1
    assert isolated['cash']==1_000_000-isolated_fees+7-1
    assert [root['cash'] for root in state['roots'][:7]]==[1_000_000,1_000_000,500_000_000,500_000_000,500_000_000,500_000_000,0]
    assert state['pools']==dict(cash=2_003_999_755,pool=0,insurance=0,fees=243,vault=2_003_999_998)
    assert reference.integer(state['accounts'][keys['token']],64)==8_000_002
    assert reference.integer(state['accounts'][keys['vault']],64)==2_003_999_998
    assert all(position['lots']==0 for root in state['roots'] for position in root['positions'])
    assert cross['reserved']==isolated['reserved']==0
    assert all(outcome['fee']==5000 and outcome['bytes']<=1232 for outcome in summary['outcomes'])
    assert len({outcome['signature'] for outcome in summary['outcomes']})==len(summary['outcomes'])
    return dict(crossCash=str(cross['cash']),isolatedCash=str(isolated['cash']),venueFees='243',withdrawn='2',walletTokenAmount='8000002',
      networkFees=str(sum(outcome['fee'] for outcome in summary['outcomes'])))

if __name__=='__main__':
    directory=Path(sys.argv[1]);summary=json.loads((directory/'summary.json').read_text());raw=json.loads((directory/'final-accounts.json').read_text())
    result=audit(summary,raw);keys=summary['keys']
    for key,offset in [(keys['cross'],113),(keys['isolated'],113),(keys['group'],255),(keys['vault'],64),(keys['token'],64),(keys['cross'],137)]:
        corrupted=copy.deepcopy(raw);data=bytearray(base64.b64decode(corrupted[key]));data[offset]^=1;corrupted[key]=base64.b64encode(data).decode()
        try:audit(summary,corrupted)
        except (AssertionError,KeyError):pass
        else:raise AssertionError(f'Accepted corruption at {offset}')
    print(json.dumps(dict(independentRawAudit='pass',mutationsRejected=6,**result)))
