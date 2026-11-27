"""Independent certificate writer for the signed single-pair, whole-atom workload."""
import copy
from fractions import Fraction
from itertools import product
import json
from math import lcm
import sys

from test_market_indexed_default import SCALE, candidate, expected, frozen, linked_book


def certificate(book, positions):
    baseline = expected(book)
    options = []
    for market, cells in enumerate(zip(*positions)):
        pairs = []
        for debtor, (lots, _) in enumerate(cells):
            debt = int(Fraction(baseline['rows'][debtor]['writeoff'][market]))
            for winner, (opposite, capacity) in enumerate(cells):
                if debt and lots * opposite < 0 and capacity > 0:
                    pairs.append((debtor, winner, min(capacity, debt)))
        assert len(pairs) <= 1
        options.append(pairs[0] if pairs else (0, 0, 0))

    vectors, ranking = [], []
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
        vectors.extend(map(Fraction, expected(changed, frozen=book)['rates']))
        outcome = candidate(book, actions)
        if outcome:
            ranking.append((sum(map(Fraction, outcome['recovery'])), index, charges, outcome))
    ranking.sort(reverse=True)
    best, selected, charges, outcome = ranking[0]
    assert best > ranking[1][0]
    unit = lcm(*(rate.denominator for rate in vectors))
    return dict(denominator=unit, selected=selected, numerators=[int(rate*unit) for rate in vectors],
                charges=charges, cash=[int(row['cash']) for row in outcome['settlement']['rows']],
                protectedPlans=len(ranking), totalPlans=len(vectors)//len(book['markets']))


def probe(width, padding, cycle):
    book = linked_book(width)
    rows = [[int(row['cash']), [int(claim)//SCALE for claim in row['claims']]] for row in book['rows']]
    if cycle:
        for _, claims in rows:
            claims.extend([0, 0])
        rows.extend([[0, [0]*width+[10, -10]], [0, [0]*width+[-10, 10]]])
        width += 2
    rows.extend([[0, [0]*width] for _ in range(padding)])
    positions = [[(0, 0) for _ in range(width)] for _ in rows]
    for m, (debtor, winner) in enumerate([(0, 1), (2, 3)]):
        positions[debtor][m] = (-1, 0)
        positions[winner][m] = (1, 2)
    return dict(rows=rows, positions=positions, proof=certificate(frozen(rows), positions))


if __name__ == '__main__':
    data = json.load(sys.stdin)
    if 'probe' in data:
        result = probe(*data['probe'])
    else:
        book = frozen(data['rows'], fees=data['fees'])
        # Positive limits use the opposite inventory and surviving entry from signed fills.
        result = certificate(book, data['positions'])
    json.dump(result, sys.stdout)
