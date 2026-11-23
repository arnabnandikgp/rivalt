"""Compare two completed, reconciled wallet workloads on the same offered trace."""
import argparse
import collections
import json
from pathlib import Path


def read(directory, arm):
    data = json.loads((directory / 'router-load.json').read_text())
    assert data['arm'] == arm and data['events'] > 0
    counts = data['counts']
    assert counts['offered'] == len(data['trace']) == len(data['offers'])
    assert counts['signed'] + counts['previewRefused'] == counts['offered']
    assert sum(counts[key] for key in ('filled', 'refused', 'expired', 'unresolved')) == counts['signed']
    assert data['paidMs'] >= 0
    return data


def summarize(data):
    receipts = data['receipts']
    wallets = [row for row in receipts if row['role'] == 'trader']
    successful = [row for row in wallets if row['error'] is None]
    assert sum(int(row['lots']) for row in successful) == int(data['counts']['fillLots'])
    assert len({row['signature'] for row in receipts}) == len(receipts)
    reasons = collections.Counter(json.dumps(row['error'], sort_keys=True) for row in wallets if row['error'])
    reasons.update(row['previewRefusal'] for row in data['offers'] if row['previewRefusal'])
    volume = sum(int(row['lots']) for row in data['trace'])
    locks = sorted({(len(row['locks']['read']) + len(row['locks']['write']), len(row['locks']['write'])) for row in wallets})
    return dict(counts=data['counts'], offeredLots=volume, bestPriceCheckedFills=len(successful),
                fundedClaimAtoms=996, cashCreditObservedMs=data['paidMs'], settlementIntentsDuringOffers=data['during'],
                reasons=dict(reasons), packetBytes=sorted({row['bytes'] for row in wallets}),
                totalAndWritableKeys=locks, feesLamports=data['fees'], finalizedCU=data['cu'],
                observedWalletFinalityMs=data['finalizedMs'], generatorLagMs=data['generatorLagMs'],
                repeatedEconomicOffers=0, queueAttemptCounts=dict(collections.Counter(str(row['attempts']) for row in wallets)),
                sharedSettlementKeys=sorted({num for work in data['overlaps'] for num in work['conflicts']}),
                totalReplayEvents=data['events'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('offered_only', type=Path)
    parser.add_argument('active', type=Path)
    args = parser.parse_args()
    control, active = read(args.offered_only, 'offered-only'), read(args.active, 'active')
    for key in ('program', 'revision', 'trace', 'seed', 'traders', 'gap', 'refresh', 'thinDepth', 'maxLots', 'btcPercent'):
        assert control[key] == active[key], f'Unmatched {key}'
    assert control['during'] == 0
    assert active['during'] > 0, 'Worker never queued during measured offers'
    print(json.dumps({row['arm']: summarize(row) for row in [control, active]}, indent=2))
