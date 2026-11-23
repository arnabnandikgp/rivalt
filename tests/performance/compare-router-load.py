"""Compare two completed, reconciled wallet workloads on the same offered trace."""
import argparse
import collections
import json
from pathlib import Path


def read(directory, arm):
    data = json.loads((directory / 'router-load.json').read_text())
    data.setdefault('rotatingAsks', False)
    data.setdefault('followEth', False)
    assert data['arm'] == arm and data['events'] > 0
    counts = data['counts']
    assert counts['offered'] == len(data['trace']) == len(data['offers'])
    assert counts['signed'] + counts['previewRefused'] == counts['offered']
    assert sum(counts[key] for key in ('filled', 'refused', 'expired', 'unresolved')) == counts['signed']
    assert data['paidMs'] is None or 0 <= data['paidMs'] <= data['payoutObservationMs']
    def roots(checkpoint):
        snapshot = json.loads((directory / f'sql-{checkpoint}-snapshot.json').read_text())
        return {row['id']: row for row in snapshot['state']['roots'].values()}
    before, after = roots('ready'), roots('drained')
    claimants = [key for key, row in before.items()
                 if row['cash'] == '999974' and row['positions'][0]['lots'] == '0'
                 and row['positions'][0]['virtualScaled'] == '996000000000']
    assert len(claimants) == 1
    claimant = claimants[0]
    funded = int(after[claimant]['cash']) - int(before[claimant]['cash'])
    unpaid = int(after[claimant]['positions'][0]['virtualScaled'])
    assert 0 <= funded <= 996 and funded * 1_000_000_000 + unpaid == 996_000_000_000
    if data['paidMs'] is not None:
        assert funded == 996
    data['fundedAtomsAtDrain'] = funded
    data['unpaidScaledAtDrain'] = unpaid
    data['startingAccounts'] = {
        key: [row['cash'], [(leg['lots'], leg['virtualScaled']) for leg in row['positions']]]
        for key, row in before.items()
    }
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
                initialUnpaidAtoms=996, fundedAtomsAtDrain=data['fundedAtomsAtDrain'],
                unpaidScaledAtDrain=data['unpaidScaledAtDrain'], cashCreditObservedMs=data['paidMs'], payoutObservedThroughMs=data['payoutObservationMs'], settlementIntentsDuringOffers=data['during'],
                reasons=dict(reasons), packetBytes=sorted({row['bytes'] for row in wallets}),
                totalAndWritableKeys=locks, feesLamports=data['fees'], finalizedCU=data['cu'],
                observedWalletFinalityMs=data['finalizedMs'], generatorLagMs=data['generatorLagMs'],
                repeatedEconomicOffers=0, queueAttemptCounts=dict(collections.Counter(str(row['attempts']) for row in wallets)),
                sharedSettlementKeys=sorted({num for work in data['overlaps'] for num in work['conflicts']}),
                publisherFeeLamportsThroughDrain=sum(int(row['fee']) for row in data['operator']),
                ethPayment=data.get('ethPayment'), makerLegs=dict(collections.Counter(
                    str(instance) for row in successful for instance in row['legs'])), totalReplayEvents=data['events'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('offered_only', type=Path)
    parser.add_argument('active', type=Path)
    args = parser.parse_args()
    control, active = read(args.offered_only, 'offered-only'), read(args.active, 'active')
    for key in ('program', 'revision', 'transport', 'startingAccounts', 'trace', 'seed', 'traders', 'gap', 'refresh', 'thinDepth', 'maxLots', 'btcPercent', 'rotatingAsks', 'followEth'):
        assert control[key] == active[key], f'Unmatched {key}'
    assert control['during'] == 0
    assert active['during'] > 0, 'Worker never queued during measured offers'
    print(json.dumps({row['arm']: summarize(row) for row in [control, active]}, indent=2))
