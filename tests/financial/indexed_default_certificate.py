"""Build rate witnesses and independently rank the feasible frozen claims."""
import copy
from hashlib import sha256
from fractions import Fraction
from itertools import product
import json
from math import lcm
import sys

from test_market_indexed_default import SCALE, candidate, expected, frozen, linked_book


def competing_certificate(book, positions, target, debtor, winners, venue):
    """Enumerate even partial recoveries. Send only splits capable of attaining the independently derived upper bound."""
    passes = []
    before = expected(book, rate_passes=passes)
    budget = int(Fraction(before['rows'][debtor]['writeoff'][target]))
    lots = abs(positions[debtor][target][0])
    weights, rates = [], []
    for member in winners:
        size, eligible, per_lot = positions[member][target]
        assert per_lot > 0
        rates.append(per_lot)
        weights.append(min(eligible, min(abs(size), lots) * per_lot))
    def priority(member):
        return sha256(b'Rivalt/frozen-member-order/v1\0' + bytes(venue) +
                      (1).to_bytes(8, 'little') + member.to_bytes(8, 'little')).digest(), member
    preferred = min(range(2), key=lambda i: priority(winners[i]))
    ranking = []
    physical = 0
    bound = min(budget, sum(weights))
    lower = max(0, bound - weights[1])
    for total in range(bound + 1):
        for left in range(max(0, total - weights[1]), min(total, weights[0]) + 1):
            split = [left, total-left]
            matched = [(charge + rate-1)//rate for charge,rate in zip(split,rates)]
            if sum(matched) > lots:
                continue
            physical += 1
            actions = [dict(market=book['market_roster'][target], charges=[
                dict(debtor=book['roster'][debtor], winner=book['roster'][member], charge=cost)
                for member,cost in zip(winners,split) if cost])] if total else []
            outcome = candidate(book, actions)
            if total == bound:
                changed = copy.deepcopy(book)
                for member,delta in [(debtor,total), *zip(winners,(-cost for cost in split))]:
                    claims = changed['rows'][member]['claims']
                    claims[target] = str(int(claims[target])+delta*SCALE)
                ordinary = expected(changed, frozen=book, rate_passes=passes)
            if outcome is None:
                continue
            recovery = sum(map(Fraction, outcome['recovery']))
            deviation = sum(Fraction(charge**2, weight) for charge,weight in zip(split,weights)) - Fraction(total**2,sum(weights))
            ranking.append(((-recovery,deviation,total,sum(matched),-split[preferred]), split, matched, outcome,
                            total == bound and ordinary['rows'] != outcome['settlement']['rows']))
    rank,split,matched,outcome,repaired = min(ranking, key=lambda item:item[0])
    assert -rank[0] == sum(split) == bound and bound > 0
    loss = [sum(Fraction(row['loss'][m]) for row in before['rows']) for m in range(len(book['markets']))]
    assert loss[target] >= bound
    totals = [0]*len(loss)
    totals[target] = bound
    return dict(denominator=0, selected=1+split[0]-lower, numerators=[word for step in passes for word in step],
                baselineLoss=list(map(str,loss)), cash=[int(row['cash']) for row in outcome['settlement']['rows']],
                charges=totals, spent=list(map(int,outcome['settlement']['spent'])), repaired=repaired,
                split=dict(market=book['market_roster'][target],members=winners,charges=split,lots=matched),
                totalPlans=physical,protectedPlans=len(ranking))


def certificate(book, positions, framed=False, venue=None):
    baseline = expected(book)
    options = []
    competition = None
    for market, cells in enumerate(zip(*positions)):
        pairs = []
        for debtor, (lots, *_) in enumerate(cells):
            debt = int(Fraction(baseline['rows'][debtor]['writeoff'][market]))
            for winner, (opposite, capacity, *_) in enumerate(cells):
                if debt and lots * opposite < 0 and capacity > 0:
                    pairs.append((debtor, winner, min(capacity, debt)))
        if len(pairs) > 1:
            assert competition is None and len(pairs) == 2 and pairs[0][0] == pairs[1][0]
            competition = (market, pairs[0][0], [pair[1] for pair in pairs])
        options.append(pairs[0] if pairs else (0, 0, 0))

    if competition:
        assert venue is not None and sum(limit > 0 for _, _, limit in options) == 1
        return competing_certificate(book, positions, *competition, venue)
    vectors, ranking, framed_words = [], [], []
    for index, reverse in enumerate(product(*(range(limit + 1) for _, _, limit in reversed(options)))):
        charges = list(reversed(reverse))
        changed = copy.deepcopy(book)
        actions = []
        for m, ((debtor, winner, _), charge) in enumerate(zip(options, charges)):
            if not charge:
                continue
            for member, delta in ((debtor, charge), (winner, -charge)):
                claims = changed['rows'][member]['claims']
                claims[m] = str(int(claims[m]) + delta * SCALE)
            actions.append(dict(market=book['market_roster'][m], charges=[dict(
                debtor=book['roster'][debtor], winner=book['roster'][winner], charge=charge)]))
        passes = []
        ordinary = expected(changed, frozen=book, rate_passes=passes)
        framed_words.extend(value for step in passes for value in step)
        vectors.extend(map(Fraction, ordinary['rates']))
        outcome = candidate(book, actions)
        if outcome:
            ranking.append((sum(map(Fraction, outcome['recovery'])), index, charges, outcome, ordinary))
    ranking.sort(reverse=True)
    best, selected, charges, outcome, ordinary = ranking[0]
    baseline_loss = [sum(Fraction(row['loss'][market]) for row in baseline['rows'])
                     for market in range(len(options))]
    total_plans = len(vectors) // len(book['markets'])
    if total_plans == 1:
        assert selected == best == 0
    else:
        assert selected > 0 and best > ranking[1][0]
    unit = lcm(*(rate.denominator for rate in vectors))
    return dict(denominator=0 if framed else unit, selected=selected,
                numerators=framed_words if framed else [int(rate*unit) for rate in vectors],
                baselineLoss=list(map(str, baseline_loss)),
                spent=list(map(int, outcome['settlement']['spent'])),
                repaired=ordinary['rows'] != outcome['settlement']['rows'],
                charges=charges, cash=[int(row['cash']) for row in outcome['settlement']['rows']],
                protectedPlans=len(ranking), totalPlans=total_plans)


def probe(width, padding, cycle):
    if width == 1:
        rows = [(4, [-6]), (0, [6])]
        positions = [[(-1, 0)], [(1, 6)]]
        return dict(rows=rows, positions=positions, proof=certificate(frozen(rows), positions))
    book = linked_book(width)
    rows = [[int(row['cash']), [int(claim)//SCALE for claim in row['claims']]] for row in book['rows']]
    rows.extend([[0, [0]*width] for _ in range(padding)])
    positions = [[(0, 0) for _ in range(width)] for _ in rows]
    for m, (debtor, winner) in enumerate([(0, 1), (2, 3)]):
        positions[debtor][m] = (-1, 0)
        positions[winner][m] = (1, 2)
    proof = certificate(frozen(rows), positions)
    if cycle:
        # This disconnected component has two offsetting 10-atom debts.
        # Both par and zero are fixed points. Par is the greatest, and neither
        # member has cash after the offset, for every candidate in the other component.
        for (_, claims), inventory in zip(rows, positions):
            claims.extend([0, 0])
            inventory.extend([(0, 0), (0, 0)])
        rows.extend([[0, [0]*width+[10, -10]], [0, [0]*width+[-10, 10]]])
        positions.extend([[(0, 0)]*(width+2) for _ in range(2)])
        rates = proof['numerators']
        proof['numerators'] = [rate for start in range(0, len(rates), width)
                               for rate in rates[start:start+width] + [proof['denominator']]*2]
        proof['cash'].extend([0, 0])
        proof['charges'].extend([0, 0])
        proof['spent'].extend([0, 0])
        proof['baselineLoss'].extend(['0', '0'])
    return dict(rows=rows, positions=positions, proof=proof)


if __name__ == '__main__':
    data = json.load(sys.stdin)
    if 'probe' in data:
        result = probe(*data['probe'])
    else:
        reserves = [f // 4 for f in data['fees']]
        book = frozen(data['rows'], reserves=reserves, fees=[f-r for f,r in zip(data['fees'], reserves)])
        # Positive limits use the opposite inventory and surviving entry from signed fills.
        result = certificate(book, data['positions'], framed=any(reserves) or data.get('framed', False), venue=data.get('venue'))
    json.dump(result, sys.stdout)
