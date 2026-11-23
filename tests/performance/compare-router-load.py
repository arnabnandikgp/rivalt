"""Compare two completed, reconciled wallet workloads on the same offered trace."""
import argparse
import collections
import json
from math import ceil
from pathlib import Path


def read(directory, arm):
    data = json.loads((directory / 'router-load.json').read_text())
    data.setdefault('rotatingAsks', False)
    data.setdefault('followEth', False)
    data.setdefault('walletOrder', 'independent')
    data['hasSponsoredMaker'] = data.get('makerStorage') is not None
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
    if 'payout' in data:
        observed = data['payout']
        paid = int(observed['fundedAtoms'])
        assert 0 <= paid <= funded <= 996
        assert int(observed['outstanding']) + paid * 1_000_000_000 == 996_000_000_000
        assert observed['status'] == ('full' if paid == 996 else 'partial' if paid else 'unpaid')
        if data['rotatingAsks']:
            assert paid > 0 and (paid == 996 or int(observed['pool']) == 0)
        else:
            assert paid == 996
        final_service = json.loads((directory / 'service-drain.json').read_text())
        assert all(row['status'] in ('finalized', 'failed', 'expired-unexecuted') for row in final_service)
        landed = {r['signature']: r for r in data['receipts'] if r['role'] == 'settlement'}
        expected = {r['signature'] for r in final_service if r['status'] != 'expired-unexecuted'}
        assert expected == set(landed)
        for row in final_service:
            if row['signature'] in landed:
                assert (row['status'] == 'failed') == (landed[row['signature']]['error'] is not None)
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
    return dict(counts=data['counts'], scheduledGapMs=data['gap'], offeredLots=volume, bestPriceCheckedFills=len(successful),
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


def compare_wallet_order(directories, sponsored_directory=None):
    """Compare every scheduled arrival, including unsigned refusals, in two active runs."""
    paired = [read(directory, 'active') for directory in directories]
    independent, confirmed = paired
    assert independent['revision'] == confirmed['revision']
    assert not independent['hasSponsoredMaker'] and not confirmed['hasSponsoredMaker']
    modes = ['independent', 'confirmed']
    if sponsored_directory:
        sponsored = read(sponsored_directory, 'active')
        assert sponsored['makerStorage']['width'] == 256 and int(sponsored['makerStorage']['rent']) > 0
        modes.append('confirmedSponsored')
        paired.append(sponsored)
    for other in paired[1:]:
        for key in ('program', 'transport', 'startingAccounts', 'trace', 'seed', 'traders', 'gap',
                    'refresh', 'thinDepth', 'maxLots', 'btcPercent', 'rotatingAsks', 'followEth'):
            assert independent[key] == other[key], f'Unmatched wallet-order {key}'

    def distribution(values):
        ordered = sorted(values)
        if not ordered:
            return None
        return dict(n=len(ordered), p50=ordered[ceil(len(ordered) * .50) - 1],
                    p95=ordered[ceil(len(ordered) * .95) - 1], maximum=ordered[-1])

    report = {}
    for mode, data in zip(modes, paired, strict=True):
        ordered = mode != 'independent'
        assert data['walletOrder'] == ('confirmed' if ordered else 'independent')
        assert data['during'] > 0, f'{mode}: worker queued no original before the trader drain'
        original = {row['offer']: row for row in data['receipts'] if row['role'] == 'trader'}
        first_slot = min(row['slot'] for row in original.values())
        last_slot = max(row['slot'] for row in original.values())
        concurrent_settlements = sum(row['role'] == 'settlement' and row['error'] is None
                                     and first_slot <= row['slot'] <= last_slot for row in data['receipts'])
        assert concurrent_settlements, f'{mode}: no finalized settlement inside the trader slot range'
        last_by_wallet = {}
        waits, outcomes, fills = [], [], []
        for index, (scheduled, offer) in enumerate(zip(data['trace'], data['offers'], strict=True)):
            assert all(scheduled[key] == offer[key] for key in scheduled)
            assert index == offer['id'] and offer['prepareMs'] >= offer['entered']
            previous = last_by_wallet.get(offer['trader']) if ordered else None
            assert offer['previousId'] == previous
            if previous is None:
                assert offer['previousSlot'] is None
            else:
                prior = original[previous]
                assert offer['previousSlot'] == prior['slot'] <= int(offer['snapshotSlot'])
                if prior['error'] is None:
                    assert int(offer['nonce']) > int(data['offers'][previous]['nonce'])
            waits.append(offer['prepareMs'] - offer['entered'])
            if offer['previewRefusal']:
                assert index not in original
                end = offer['previewRefusedMs']
            else:
                receipt = original[index]
                assert offer['previewRefusedMs'] is None
                end = receipt['observedFinalMs']
                last_by_wallet[offer['trader']] = index
                if receipt['error'] is None:
                    fills.append(end - offer['dueMs'])
            assert end >= offer['prepareMs']
            outcomes.append(end - offer['dueMs'])
        report[mode] = dict(revision=data['revision'], makerStorage=data.get('makerStorage'), counts=data['counts'],
                            settlementsInTraderSlotRange=concurrent_settlements, waitBeforePreparationMs=distribution(waits),
                            scheduledToAnyOutcomeMs=distribution(outcomes), scheduledToFillMs=distribution(fills),
                            signedToFillMs=data['finalizedMs'], generatorLagMs=data['generatorLagMs'],
                            reasons=summarize(data)['reasons'], paid=data['fundedAtomsAtDrain'], events=data['events'])
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('first', type=Path, help='Offered-only arm, or active independent arm with --wallet-order')
    parser.add_argument('active', type=Path)
    parser.add_argument('--active-rate-step', type=Path, help='Same active trace and starting economics at a different gap')
    parser.add_argument('--wallet-order', action='store_true', help='Compare two active arms with independent and confirmed wallet preparation')
    parser.add_argument('--sponsored', type=Path, help='Optional confirmed repeat with only BTC maker 1 storage enlarged')
    args = parser.parse_args()
    if args.sponsored and not args.wallet_order:
        parser.error('--sponsored requires --wallet-order')
    if args.wallet_order:
        if args.active_rate_step:
            parser.error('--wallet-order cannot be combined with --active-rate-step')
        print(json.dumps(compare_wallet_order([args.first, args.active], args.sponsored), indent=2))
        raise SystemExit(0)
    control, active = read(args.first, 'offered-only'), read(args.active, 'active')
    for key in ('program', 'revision', 'transport', 'startingAccounts', 'trace', 'seed', 'traders', 'gap', 'refresh', 'thinDepth', 'maxLots', 'btcPercent', 'rotatingAsks', 'followEth', 'walletOrder', 'hasSponsoredMaker'):
        assert control[key] == active[key], f'Unmatched {key}'
    assert control['during'] == 0
    assert active['during'] > 0, 'Worker never queued during measured offers'
    report = {row['arm']: summarize(row) for row in [control, active]}
    if args.active_rate_step:
        faster = read(args.active_rate_step, 'active')
        for key in ('program', 'revision', 'transport', 'startingAccounts', 'seed', 'traders', 'refresh', 'thinDepth', 'maxLots', 'btcPercent', 'rotatingAsks', 'followEth', 'walletOrder', 'hasSponsoredMaker'):
            assert faster[key] == active[key], f'Unmatched rate-step {key}'
        assert 0 < faster['gap'] < active['gap'] and faster['during'] > 0
        def scheduled_orders(run):
            assert all(row['dueMs'] == index * run['gap'] for index, row in enumerate(run['trace']))
            return [{key: value for key, value in row.items() if key != 'dueMs'} for row in run['trace']]
        assert scheduled_orders(faster) == scheduled_orders(active), 'Different economic orders at higher rate'
        report['activeRateStep'] = summarize(faster)
    print(json.dumps(report, indent=2))
