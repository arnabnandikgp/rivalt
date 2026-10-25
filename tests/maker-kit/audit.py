"""Independent aggregate cash/position/funding identities for actual kit captures.

Consumes finalized events and endpoints, never imports the TypeScript reporter or
its pricing/settlement implementation. All arithmetic is integer arithmetic.
"""
import copy
import json
import sys
from pathlib import Path

SCALE = 1_000_000_000


def audit(capture):
    data, report = capture['input'], capture['report']
    opening, closing = data['opening'], data['closing']
    capital = data['capital']
    position = int(opening['participant']['lots'])
    funding_index = int(opening['fundingIndexScaled'])
    funding_pnl = trade_virtual = volume = notional = deposits = withdrawals = gains = losses = venue_fee = 0
    fills = []
    for event in data['events']:
        payload = event['payload']
        current_index = int(payload.get('fundingIndexScaled', funding_index))
        funding_pnl += position * (funding_index - current_index)
        funding_index = current_index
        if event['kind'] == 'route':
            legs = [dict(leg, role='provider', side=1-payload['side']) for leg in payload['legs'] if leg['capital'] == capital]
            if payload['trader'] == capital:
                legs.append(dict(payload, role='taker'))
                venue_fee += int(payload['fee'])
            for leg in legs:
                quantity, gross = int(leg['lots']), int(leg['grossQuote'])
                direction = 1 if leg['side'] == 0 else -1
                position += direction * quantity
                trade_virtual -= direction * gross * SCALE
                volume += quantity
                notional += gross
                fills.append(dict(signature=event['signature'], sequence=payload['sequence'], role=leg['role'],
                                  side='buy' if direction == 1 else 'sell', lots=str(quantity), grossQuoteAtoms=str(gross)))
        elif payload.get('participant') == capital:
            amount = int(payload.get('amount', 0))
            if event['kind'] == 'custody':
                if payload['kind'] == 2: deposits += amount
                if payload['kind'] == 3: withdrawals += amount
            elif event['kind'] == 'settlement':
                if payload['kind'] == 0: losses += amount
                if payload['kind'] == 1: gains += amount
                if payload['kind'] == 2: withdrawals += amount
    funding_pnl += position * (funding_index - int(closing['fundingIndexScaled']))

    def virtual(endpoint):
        participant = endpoint['participant']
        return int(participant['virtualScaled']) - int(participant['lots']) * (
            int(endpoint['fundingIndexScaled']) - int(participant['fundingCheckpointScaled']))

    def unpaid(endpoint):
        return virtual(endpoint) + int(endpoint['participant']['lots']) * int(endpoint['referenceAtomsPerLot']) * SCALE

    assert int(closing['participant']['lots']) == position
    assert virtual(closing) - virtual(opening) == trade_virtual + funding_pnl + (losses-gains) * SCALE
    cash_change = int(closing['participant']['cash']) - int(opening['participant']['cash'])
    assert cash_change == deposits - withdrawals + gains - losses - venue_fee
    assert report['fills'] == fills
    expected = dict(inventoryLots=position, cashAtoms=int(closing['participant']['cash']), filledLots=volume,
                    grossNotionalAtoms=notional, depositedAtoms=deposits, withdrawnAtoms=withdrawals,
                    settledGainAtoms=gains, collectedLossAtoms=losses, fundedPnlAtoms=gains-losses,
                    unpaidPnlScaled=unpaid(closing), fundingPnlScaled=funding_pnl, venueFeesAtoms=venue_fee,
                    totalPnlBeforeNetworkAndHedgesScaled=(cash_change-deposits+withdrawals)*SCALE+unpaid(closing)-unpaid(opening),
                    networkFeesLamports=sum(int(tx['feeLamports']) for tx in data['transactions'] if tx['feePayer'] == data['owner']))
    for field, value in expected.items():
        assert report[field] == str(value), field
    assert report['makerFills'] == sum(fill['role'] == 'provider' for fill in fills)
    assert report['takerFills'] == sum(fill['role'] == 'taker' for fill in fills)
    assert report['independentMakerValidation'] is False
    assert report['hedge']['observedHedges'] is False
    assert report['hedge']['deductedFromReportedPnl'] is False
    assert report['hedge']['costAssumptionScaled'] == str(notional * int(data['hedge']['assumedBps']) * SCALE // 10000)
    return expected


if __name__ == '__main__':
    capture = json.loads(Path(sys.argv[1]).read_text())
    audit(capture)
    # Each deliberately wrong result must be rejected by this separate auditor.
    fields = ['cashAtoms', 'unpaidPnlScaled', 'fundedPnlAtoms', 'fundingPnlScaled', 'networkFeesLamports']
    for field in fields:
        changed = copy.deepcopy(capture)
        changed['report'][field] = str(int(changed['report'][field]) + 1)
        try:
            audit(changed)
        except AssertionError:
            continue
        raise AssertionError('Accepted altered ' + field)
    print(json.dumps(dict(status='pass', identities='cash, position, claim, funding, costs', adverseMutations=len(fields))))
