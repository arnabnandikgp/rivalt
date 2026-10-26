#!/usr/bin/env python3
"""Independent conservation and full-book checks for the P20 budget capture."""
import importlib.util
import json
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location('reference', Path(__file__).with_name('group-safety-reference.py'))
reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)
directory = Path(sys.argv[1])
summary = json.loads((directory/'summary.json').read_text())
captures = json.loads((directory/'captures.json').read_text())
states = {name: reference.snapshot(raw, summary['keys'], allow_cross=True) for name, raw in captures.items()}
for state in states.values():
    reference.normal(state)
before, after = states['max-book-before'], states['max-book-after']
target_id = summary['keys']['roots'].index(summary['keys']['liquidationTarget'])
initial, final = before['roots'][target_id], after['roots'][target_id]
assert initial['reserved'] > 0 and final['reserved'] > 0
assert [position['lots'] for position in initial['positions']] == [5, 5]
assert [position['lots'] for position in final['positions']] == [7, 5]
fee = after['pools']['fees']-before['pools']['fees']
assert fee > 0 and final['cash'] == initial['cash']+1-fee
assert after['roots'][0]['cash'] == before['roots'][0]['cash']-1
assert after['pools']['cash'] == before['pools']['cash']-fee
before, after = states['max-receiver-before'], states['max-receiver-after']
assert after['roots'][target_id]['cash'] == before['roots'][target_id]['cash']-5
assert after['roots'][7]['cash'] == before['roots'][7]['cash']+5
assert [position['lots'] for position in after['roots'][7]['positions']] == [1, 2]
assert reference.deficit(after['roots'][target_id],after['markets']) < reference.deficit(before['roots'][target_id],after['markets'])
assert before['pools'] == after['pools']
for check in summary['checks']:
    assert check['bytes'] <= 1232
    if check['status'] == 'pass':
        assert int(check['computeUnits'])*5 <= check['declaredComputeUnits']*4
print(json.dumps(dict(independentBudgetConservation='pass', fullOrderSlots=4, markets=2, atomicFee=str(fee))))
