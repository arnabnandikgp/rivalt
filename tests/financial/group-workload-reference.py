#!/usr/bin/env python3
"""Independent integer replay: enumerate maker ticks, fees, funding and cash.

Event fields are authenticated decoded transaction inputs, not expected values.
Every economic output is recalculated and tied to independently decoded final
account/token bytes. No SDK allocation/risk/settlement arithmetic is imported.
"""
import base64
import copy
import importlib.util
import json
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location('reference', Path('tests/financial/group-safety-reference.py'))
reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)
SCALE = 10**9


def compare(root, actual):
    assert root['cash'] == int(actual['cash'])
    assert root['reserved'] == int(actual['reserved']) == 0
    for expected, position in zip(root['positions'], actual['positions']):
        assert expected == dict(lots=int(position['lots']), virtual=int(position['virtualScaled']),
                                checkpoint=int(position['fundingCheckpointScaled']), generation=int(position['generation']))


def accrue(root, markets):
    for index, position in enumerate(root['positions']):
        if root['mode'] == 1 and root['market'] != index:
            continue
        endpoint = int(markets[index]['fundingIndexScaled'])
        position['virtual'] -= position['lots'] * (endpoint-position['checkpoint'])
        position['checkpoint'] = endpoint


def fill(root, index, lots, quote):
    position = root['positions'][index]
    before = position['lots']
    after = before + lots
    if before != after and (before == 0 or after == 0 or (before < 0) != (after < 0)):
        position['generation'] += 1
    position['lots'] = after
    position['virtual'] -= quote*SCALE


def audit(summary, initial_raw, final_raw, events):
    keys = summary['keys']
    initial = reference.snapshot(initial_raw, keys, allow_cross=True)
    final = reference.snapshot(final_raw, keys, allow_cross=True)
    reference.normal(initial)
    reference.normal(final)
    assert len(initial['roots']) == len(final['roots']) == 7
    roots = copy.deepcopy(initial['roots'])
    pools = copy.deepcopy(initial['pools'])
    markets = [None, None]
    sequence = int(summary['initialSequence'])
    total_fees = 0
    total_withdrawn = 0
    fills = 0
    route_signatures = set()
    for row in events:
        event = row['payload']
        sequence += 1
        assert int(row['sequence']) == int(event['sequence']) == sequence
        kind = row['kind']
        if kind == 'group-oracle':
            markets[event['state']['index']] = event['state']
        elif kind == 'group-maker':
            pass  # Approval/epoch state has no custody or participant cash effect.
        elif kind == 'margin-route':
            assert int(event['orderId']) == 0  # Workload uses direct exact-size FOK.
            market = event['marketState']['index']
            markets[market] = event['marketState']
            markets[1-market] = event['otherMarketState']
            trader = roots[event['rootStates'][0]['id']]
            sign = 1 if event['side'] == 0 else -1
            gross = 0
            lots = 0
            for actual, registration in zip(event['rootStates'][1:], event['makerStates']):
                maker = roots[actual['id']]
                quantity = sign*(maker['positions'][market]['lots']-int(actual['positions'][market]['lots']))
                assert quantity > 0
                index = registration['makerId']
                assert index in [0, 1]
                consumed = int(registration['buyConsumed' if sign == 1 else 'sellConsumed']) - quantity
                assert consumed >= 0
                inventory = maker['positions'][market]['lots']
                spread, flat, skew_step, skew_tick = [(10, 0, 64, 4), (30, 256, 256, 1)][index]
                # Rust integer division truncates toward zero, unlike Python //.
                skew = (abs(inventory)//skew_step) * (-1 if inventory < 0 else 1) * skew_tick
                center = int(markets[market]['referencePrice'])-skew
                notional = sum(center+sign*(spread+max(0, tick-flat)) for tick in range(consumed, consumed+quantity))
                accrue(maker, markets)
                fill(maker, market, -sign*quantity, -sign*notional)
                compare(maker, actual)
                gross += notional
                lots += quantity
            assert gross == int(event['grossQuote']) and lots == int(event['lots'])
            fee = (gross+4999)//5000
            assert int(event['fee']) == fee
            accrue(trader, markets)
            fill(trader, market, sign*lots, sign*gross)
            trader['cash'] -= fee
            compare(trader, event['rootStates'][0])
            pools['cash'] -= fee
            pools['fees'] += fee
            assert pools['cash'] == int(event['totalCash']) and pools['fees'] == int(event['fees'])
            total_fees += fee
            fills += 1
            route_signatures.add(row['signature'])
        elif kind == 'group-safety':
            assert event['kind'] == 4 and int(event['amount']) == 1, 'Only declared one-atom withdrawals follow the opening checkpoint'
            assert len(event['roots']) == 1
            markets = event['markets']
            actual = event['roots'][0]
            root = roots[actual['id']]
            assert all(position['lots'] == 0 for position in root['positions'])
            accrue(root, markets)
            root['cash'] -= 1
            compare(root, actual)
            pools['cash'] -= 1
            pools['vault'] -= 1
            total_withdrawn += 1
            for field, wire in [('cash','totalCash'),('pool','settlement'),('insurance','insurance'),('fees','fees'),('vault','allocatedVault')]:
                assert pools[field] == int(event[wire])
        else:
            raise AssertionError(f'Unmodelled financial event {kind}')
    assert total_withdrawn == 3
    assert pools == final['pools']
    for expected, actual in zip(roots, final['roots']):
        for field in ['cash', 'positions', 'reserved', 'mode', 'market', 'id']:
            assert expected[field] == actual[field], (field, expected['id'])
        assert all(position['lots'] == 0 for position in actual['positions'])
    successful = {offer['signature'] for offer in summary['offers'] if offer['status'] == 'finalized'}
    assert successful == route_signatures
    assert fills == len(successful) > 0
    assert not any(offer['status'] == 'unresolved' for offer in summary['offers'])
    for index, token in enumerate(keys['tokens']):
        before = reference.integer(initial['accounts'][token],64)
        after = reference.integer(final['accounts'][token],64)
        assert after-before == (3 if index == 0 else 0)
    assert len([offer for offer in summary['offers'] if offer['population'] == 'scheduled']) == 150
    assert summary['durationMs'] == 300000 and summary['offeredIntervalMs'] == 2000
    assert summary['originalAcknowledgementFault']['persistedBeforeBroadcast'] and summary['originalAcknowledgementFault']['dropped']
    return dict(reconciledFills=fills,venueFees=str(total_fees),withdrawnAtoms='3',retainedUnpaidClaims=True,
                finalFundedCash=str(pools['cash']),actualVault=str(pools['vault']))


if __name__ == '__main__':
    directory = Path(sys.argv[1])
    summary = json.loads((directory/'summary.json').read_text())
    initial = json.loads((directory/'initial-accounts.json').read_text())
    final = json.loads((directory/'final-accounts.json').read_text())
    events = json.loads((directory/'financial-events.json').read_text())
    result = audit(summary, initial, final, events)
    corrupted_cases = []
    for key, offset in [(summary['keys']['roots'][6],113),(summary['keys']['group'],255),(summary['keys']['vault'],64),(summary['keys']['tokens'][0],64)]:
        corrupted = copy.deepcopy(final)
        data = bytearray(base64.b64decode(corrupted[key]));data[offset] ^= 1
        corrupted[key] = base64.b64encode(data).decode()
        corrupted_cases.append((corrupted,events))
    for field in ['fee','grossQuote']:
        modified = copy.deepcopy(events)
        payload = next(row['payload'] for row in modified if row['kind']=='margin-route')
        payload[field] = str(int(payload[field])+1)
        corrupted_cases.append((final,modified))
    for corrupted, modified in corrupted_cases:
        try:
            audit(summary, initial, corrupted, modified)
        except AssertionError:
            pass
        else:
            raise AssertionError('Accepted adversarial financial mutation')
    print(json.dumps(dict(independentReplay='pass',mutationsRejected=len(corrupted_cases),**result)))
