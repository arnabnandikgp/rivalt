"""Audit captured, RPC-reconciled default-worker money and transport separately.

Expected payouts/insurance come from the independently derived Fraction/graph
reference captured before execution, never from the service's rate proposal.
"""
import base64
import json
from pathlib import Path
import sys


def audit(directory):
    root = Path(directory)
    result = json.loads((root / 'result.json').read_text())
    start = json.loads((root / 'sql-default-worker-start-snapshot.json').read_text())['state']
    frozen = json.loads((root / 'independent-default.json').read_text())
    final = result['sql']['state']
    expected = frozen['expected']
    initial = frozen['initial']
    rows = frozen['rows']
    exits = []
    for ordinal, row in enumerate(rows):
        actual = final['roots'][row['key']]
        difference = int(expected['plan']['cash'][ordinal]) - int(actual['cash'])
        assert difference in (0, 1), ('cash', ordinal, difference)
        if difference:
            exits.append(row['key'])
        assert int(actual['reserved']) == 0
        assert int(actual['delegateExpirySlot']) == 0
        assert all(int(position['lots']) == int(position['virtualScaled']) == 0 for position in actual['positions'])
        assert actual['book']['lastOrderId'] == row['root']['book']['lastOrderId']
        assert actual['book']['lastGroupId'] == row['root']['book']['lastGroupId']
    assert len(exits) == 1
    spent = list(map(int, expected['evaluations'][-1]['spent']))
    for key, ledger in final['ledgers'].items():
        market = ledger['marketIndex']
        assert int(ledger['insurance']) == int(initial['insuranceBefore'][market]) - spent[market]
        assert int(ledger['fees']) == int(initial['feesBefore'][market])
        assert ledger['insuranceFeeRemainder'] == start['ledgers'][key]['insuranceFeeRemainder']
        assert int(ledger['settlement']) == 0
    assert int(final['custody']['allocatedVault']) == int(initial['allocatedBefore']) - 1
    assert final['resolution']['stage'] == 12
    assert list(map(int, final['resolution']['insuranceSpent'])) == spent
    originals = result['originals']
    assert len({item['signature'] for item in originals}) == len(originals)
    fees = sum(item['transaction']['meta']['fee'] for item in originals)
    budget = result['budget'][0]
    assert int(budget['spent']) == fees and int(budget['committed']) == 0
    assert not result['endTrackedDirty']
    costs = {}
    for item in originals:
        assert item['transaction']['transaction'][0] == item['wire']
        assert item['transaction']['meta']['err'] is None
        measured = item['transaction']['meta']['computeUnitsConsumed']
        wire = len(base64.b64decode(item['wire'], validate=True))
        costs.setdefault(item['reason'], []).append((measured, wire))
    return {'members': len(rows), 'fundedTokenExitAtoms': 1, 'insuranceSpent': list(map(str, spent)),
            'workerOriginals': len(originals), 'actualWorkerFees': fees,
            'workerPeakCu': max(pair[0] for pairs in costs.values() for pair in pairs),
            'workerPeakWireBytes': max(pair[1] for pairs in costs.values() for pair in pairs),
            'resources': {reason: {'count': len(pairs), 'minCu': min(pair[0] for pair in pairs),
                'maxCu': max(pair[0] for pair in pairs), 'maxBytes': max(pair[1] for pair in pairs)}
                for reason, pairs in costs.items()}}


if __name__ == '__main__':
    print(json.dumps(audit(sys.argv[1]), indent=2))
