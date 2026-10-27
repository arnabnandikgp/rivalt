#!/usr/bin/env python3
"""Independent wire/transaction audit of P25. No SDK or production math imports."""
import base64
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

# Reuse only the preceding independent wire reader and trade-fee audit.
spec = importlib.util.spec_from_file_location('trading_reference', Path(__file__).with_name('account-trading-reference.py'))
trading = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trading)
integer, root, SCALE = trading.integer, trading.root, trading.SCALE


def decode(report, raw):
    data = {key: base64.b64decode(value) for key, value in raw.items()}
    roots = {key: root(data[key]) | {'mode': data[key][110], 'isolated': data[key][111]} for key in report['roots'] if key in data}
    markets = [{'funding': integer(data[key], 76, 16, True), 'gross': integer(data[key], 100),
                'price': integer(data[key], 116)} for key in report['markets']]
    ledgers = []
    for index, key in enumerate(report['ledgers']):
        ledger = data[key]
        assert len(ledger) == 109 and integer(ledger, 8, 2) == 3 and ledger[74] == index
        ledgers.append({name: integer(ledger, offset) for name, offset in [('pool', 75), ('insurance', 83), ('fees', 91)]}
                       | {'carry': ledger[99]})
        assert ledger[99] < 4
    custody = data[report['custody']]
    cash = sum(account['cash'] for account in roots.values())
    assert cash == integer(custody, 42), 'root cash versus custody'
    allocated = cash + sum(ledger['pool'] + ledger['insurance'] + ledger['fees'] for ledger in ledgers)
    vault = integer(data[report['vault']], 64)
    assert allocated == integer(custody, 50) <= vault, 'allocated custody versus actual vault'
    tokens = {key: integer(data[key], 64) for key in report['userTokens']}
    assert sum(tokens.values()) + vault == integer(data[report['mint']], 36), 'all actual tokens versus mint supply'
    for index, market in enumerate(markets):
        assert sum(account['positions'][index][0] for account in roots.values()) == 0, 'paired quantities'
        assert sum(abs(account['positions'][index][0]) for account in roots.values()) == market['gross'], 'gross exposure'
        claims = sum(virtual - lots * (market['funding'] - checkpoint)
                     for account in roots.values() for lots, virtual, checkpoint in [account['positions'][index]])
        assert claims == ledgers[index]['pool'] * SCALE, 'exact market fractional ownership'
    return roots, markets, ledgers, cash, vault, tokens


def audit(report):
    names = ['deposit_account_v3', 'withdraw_funded_account_v3', 'transfer_funded_account_v3',
             'collect_account_loss_v3', 'pay_account_gain_v3', 'net_account_claims_v3',
             'allocate_market_fees_v3', 'withdraw_market_fees_v3', 'execute_account_route_v3',
             'manage_account_order_v3', 'set_account_delegate_v3', 'seed_market_insurance_v3', 'classify_market_surplus_v3']
    tags = {hashlib.sha256(f'global:{name}'.encode()).digest()[:8]: name for name in names}
    counts = {}
    for step in report['financialSteps']:
        before, old_markets, old_ledgers, old_cash, old_vault, old_tokens = decode(report, step['before'])
        after, markets, ledgers, cash, vault, tokens = decode(report, step['after'])
        assert before.keys() == after.keys()
        assert len(step['instructions']) == 1
        instruction = step['instructions'][0]
        wire = base64.b64decode(instruction['data'])
        name = tags.get(wire[:8], 'spl_transfer' if wire[0] == 12 and len(wire) == 10 else None)
        assert name is not None, 'unclassified financial instruction'
        counts[name] = counts.get(name, 0) + 1
        expected = copy.deepcopy(before)
        expected_ledgers = copy.deepcopy(old_ledgers)
        expected_tokens = dict(old_tokens)
        expected_vault = old_vault
        touched = [key for key in instruction['accounts'] if key in before]
        amount = integer(wire, 1) if name == 'spl_transfer' else integer(wire, len(wire)-8)
        if name == 'execute_account_route_v3':
            # Previously independent trade equations, supplied only this actual
            # transition and the roots that existed at that point in the run.
            trading.audit(report | {'roots': list(before), 'financialSteps': [step], 'rawAccounts': step['after']})
            continue
        if name in ['withdraw_funded_account_v3', 'transfer_funded_account_v3', 'collect_account_loss_v3',
                    'pay_account_gain_v3', 'net_account_claims_v3']:
            for key in touched:
                expected[key]['positions'] = [((lots, virtual-lots*(markets[index]['funding']-checkpoint), markets[index]['funding'])
                    if before[key]['mode']==0 or before[key]['isolated']==index else (lots,virtual,checkpoint))
                    for index, (lots, virtual, checkpoint) in enumerate(before[key]['positions'])]
        if name in ['deposit_account_v3', 'withdraw_funded_account_v3']:
            assert len(touched) == 1
            direction = 1 if name == 'deposit_account_v3' else -1
            expected[touched[0]]['cash'] += direction*amount
            expected_vault += direction*amount
            destination = next(key for key in instruction['accounts'] if key in old_tokens)
            expected_tokens[destination] -= direction*amount
        elif name == 'transfer_funded_account_v3':
            assert len(touched) == 2
            expected[touched[0]]['cash'] -= amount
            expected[touched[1]]['cash'] += amount
        elif name in ['collect_account_loss_v3', 'pay_account_gain_v3']:
            assert len(touched) == 1
            market = wire[8]
            debtor = expected[touched[0]]
            claims = [virtual+lots*markets[index]['price']*SCALE for index,(lots,virtual,_) in enumerate(debtor['positions'])]
            if name == 'collect_account_loss_v3':
                assert debtor['cash']*SCALE >= sum(max(0,-claim) for claim in claims), 'gross debt individually backed'
                assert -claims[market] >= amount*SCALE
                direction = -1
            else:
                assert claims[market] >= amount*SCALE and old_ledgers[market]['pool'] >= amount
                direction = 1
            debtor['cash'] += direction*amount
            lots, virtual, checkpoint = debtor['positions'][market]
            debtor['positions'][market] = lots, virtual-direction*amount*SCALE, checkpoint
            expected_ledgers[market]['pool'] -= direction*amount
        elif name == 'net_account_claims_v3':
            assert len(touched) == 1
            source = wire[40]
            debtor = expected[touched[0]]
            assert all(position[0] == 0 for position in debtor['positions'])
            assert debtor['positions'][source][1] >= amount*SCALE
            assert -debtor['positions'][1-source][1] >= amount*SCALE
            assert old_ledgers[source]['pool'] >= amount, 'netting uses actual funded P'
            for index, direction in [(source,-1),(1-source,1)]:
                lots, virtual, checkpoint = debtor['positions'][index]
                debtor['positions'][index] = lots, virtual+direction*amount*SCALE, checkpoint
                expected_ledgers[index]['pool'] += direction*amount
        elif name in ['allocate_market_fees_v3','withdraw_market_fees_v3']:
            market = wire[8]
            expected_ledgers[market]['fees'] -= amount
            assert expected_ledgers[market]['fees'] >= 0
            if name == 'allocate_market_fees_v3':
                expected_ledgers[market]['insurance'] += amount
            else:
                expected_vault -= amount
                destination = next(key for key in instruction['accounts'] if key in old_tokens)
                expected_tokens[destination] += amount
        elif name in ['seed_market_insurance_v3', 'classify_market_surplus_v3']:
            market = wire[8]
            expected_ledgers[market]['insurance'] += amount
            if name == 'seed_market_insurance_v3':
                expected_vault += amount
                donor = next(key for key in instruction['accounts'] if key in old_tokens)
                expected_tokens[donor] -= amount
            else:
                assert old_vault-old_cash-sum(sum(ledger[field] for field in ['pool','insurance','fees']) for ledger in old_ledgers) >= amount
        elif name == 'spl_transfer':
            expected_vault += amount
            expected_tokens[instruction['accounts'][0]] -= amount
        elif name == 'manage_account_order_v3' and wire[41] < 3:
            for key in touched:
                expected[key]['positions'] = [((lots, virtual-lots*(markets[index]['funding']-checkpoint), markets[index]['funding'])
                    if before[key]['mode']==0 or before[key]['isolated']==index else (lots,virtual,checkpoint))
                    for index,(lots,virtual,checkpoint) in enumerate(before[key]['positions'])]
        for key in before:
            assert expected[key]['cash'] == after[key]['cash'], (step['label'], 'exact root cash', key)
            assert expected[key]['positions'] == after[key]['positions'], (step['label'], 'exact accrued claims/fractions',key)
        assert ledgers == expected_ledgers, (step['label'], 'exact market P/I/T/carry')
        assert tokens == expected_tokens and vault == expected_vault, (step['label'], 'actual SPL movement')
    decode(report, report['rawAccounts'])
    return counts


def mutations(report):
    targets = [(report['roots'][0],113), (report['roots'][0],129), (report['roots'][0],121),
               (report['ledgers'][0],75), (report['ledgers'][0],83), (report['ledgers'][0],91),
               (report['custody'],50), (report['vault'],64), (report['userTokens'][0],64)]
    for key,offset in targets:
        broken=copy.deepcopy(report)
        data=bytearray(base64.b64decode(broken['rawAccounts'][key]));data[offset]^=1
        broken['rawAccounts'][key]=base64.b64encode(data).decode()
        try:audit(broken)
        except AssertionError:pass
        else:raise AssertionError(('accepted mutation',key,offset))
    # This mutation preserves every aggregate financial invariant. The exact
    # transition equations must still reject swapping actual I and T ownership.
    broken=copy.deepcopy(report)
    step=next(step for step in broken['financialSteps'] if step['label']=='fee authority explicitly allocates T to market I')
    key=report['ledgers'][0];data=bytearray(base64.b64decode(step['after'][key]))
    data[83:91]=(integer(data,83)-1).to_bytes(8,'little');data[91:99]=(integer(data,91)+1).to_bytes(8,'little')
    step['after'][key]=base64.b64encode(data).decode()
    try:audit(broken)
    except AssertionError:pass
    else:raise AssertionError('accepted conserving but misattributed reserve mutation')
    return len(targets)+1


if __name__ == '__main__':
    report=json.load(open(sys.argv[1]))
    counts=audit(report)
    print(f'P25 independent wire audit: {len(report["financialSteps"])} transitions, {counts}, {mutations(report)} mutations rejected')
