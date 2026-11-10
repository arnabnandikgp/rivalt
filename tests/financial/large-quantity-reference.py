#!/usr/bin/env python3
"""Audit actual large fills using literal flat prices and independent wire readers.

Expected quantity/cash/virtual balances come from signed-scenario inputs, never a
production quote or the observed virtual delta. Funding accrues every allowed
market, including the untouched sibling. The general audit checks fees/carry.
"""
import base64
import copy
import importlib.util
import json
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location('wire', Path(__file__).with_name('account-trading-reference.py'))
wire = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wire)

def audit(report):
    fills = wire.audit(report)
    for step in report['financialSteps']:
        previous, _, _, _ = wire.decode(report, step['before'])
        actual, markets, _, _ = wire.decode(report, step['after'])
        expected = copy.deepcopy(previous)
        trader, index, side = step['trader'], step['marketIndex'], step['side']
        price = int(step['anchor']) + (3 if side == 0 else -2)
        total = sum(int(leg['lots']) for leg in step['legs'])
        assert 0 < total <= 100_000_000
        prefix = next((old['notional'] for old, new in zip(previous[trader]['orders'], actual[trader]['orders'])
                       if old['id'] == new['id'] and new['filled'] > old['filled']), 0)
        fee = (prefix + total * price + 4999)//5000 - (prefix + 4999)//5000
        expected[trader]['cash'] -= fee
        quantities = {trader: total if side == 0 else -total}
        for leg in step['legs']:
            quantities[leg['capital']] = -int(leg['lots']) if side == 0 else int(leg['lots'])
        for key, delta in quantities.items():
            raw = base64.b64decode(step['before'][key])
            positions = []
            for market, (lots, virtual, checkpoint) in enumerate(previous[key]['positions']):
                if raw[118] != 0 and raw[119] != market:
                    positions.append((lots, virtual, checkpoint));continue
                virtual -= lots * (markets[market]['funding'] - checkpoint)
                if market == index:
                    lots += delta;virtual -= delta * price * wire.SCALE
                positions.append((lots, virtual, markets[market]['funding']))
            expected[key]['positions'] = positions
        for key in report['roots']:
            assert actual[key]['cash'] == expected[key]['cash']
            assert actual[key]['positions'] == expected[key]['positions'], 'independent price / whole-account funding'
    return fills

if __name__ == '__main__':
    report = json.load(open(sys.argv[1]))
    count = audit(report)
    rejected = wire.mutations(report)
    print(f'Large-quantity independent wire audit: {count} fills, {rejected} mutations rejected')
