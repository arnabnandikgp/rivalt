"""Build rate witnesses and independently rank the feasible frozen claims."""
import copy
from hashlib import sha256
from fractions import Fraction
from itertools import product
import json
from math import lcm
import sys

from test_market_indexed_default import SCALE, candidate, expected, frozen, linked_book


def competing_certificate(book, positions, groups, venue, episode=1, member_ids=None):
    """Brute-force every physical allocation, including zero, using exact fractions."""
    passes = []
    before = expected(book, rate_passes=passes)
    loss = [sum(Fraction(row['loss'][m]) for row in before['rows']) for m in range(len(book['markets']))]
    if member_ids is None:
        member_ids = list(range(len(positions)))
    def priority(i):
        return sha256(b'Rivalt/frozen-member-order/v1\0' + bytes(venue) +
                      episode.to_bytes(8, 'little') + member_ids[i].to_bytes(8, 'little')).digest(), member_ids[i]
    stable = sorted(range(len(positions)), key=priority)
    domains = []
    for market, debtor, winners in groups:
        budget = int(Fraction(before['rows'][debtor]['writeoff'][market]))
        available = abs(positions[debtor][market][0])
        terms = [positions[w][market] for w in winners]
        weights = [min(eligible, min(abs(size), available)*rate) for size, eligible, rate in terms]
        bound = min(budget, sum(weights))
        assert bound > 0 and all(weights)
        options = []
        for total in range(bound+1):
            start = max(0,total-weights[1]) if len(weights)==2 else total
            for first in range(start,min(total,weights[0])+1):
                split = [first,total-first] if len(weights)==2 else [first]
                lots = [(q+rate-1)//rate for q,(_,_,rate) in zip(split,terms)]
                cost = sum(lots)
                deviation = sum(Fraction(q*q,w) for q,w in zip(split,weights)) - Fraction(total*total,sum(weights))
                options.append((total,split,lots,deviation,cost,cost <= available))
        domains.append((market,debtor,winners,bound,options))
    full = [[choice for choice in options if choice[0]==bound] for _,_,_,bound,options in domains]
    upper_indices = {tuple(tuple(x[1]) for x in reversed(combo)):i+1 for i,combo in enumerate(product(*reversed(full)))}
    # Independent financial ranking first. Witness ordering is a separate serialization step.
    outcomes, witnesses, physical = [], {}, 0
    for choices in product(*(d[4] for d in domains)):
        if not all(choice[5] for choice in choices):
            continue
        physical += 1
        actions = []
        changed = copy.deepcopy(book)
        amounts = {}
        for (m,debtor,winners,_,_), (total, split, _, _, _, _) in zip(domains,choices):
            charges = []
            for w,q in zip(winners,split):
                if q:
                    charges.append(dict(debtor=book['roster'][debtor],winner=book['roster'][w],charge=q))
                    amounts[w,m]=q
                    original = changed['rows'][w]['claims']
                    original[m]=str(int(original[m])-q*SCALE)
            if charges:
                actions.append(dict(market=book['market_roster'][m],charges=charges))
                original=changed['rows'][debtor]['claims']
                original[m]=str(int(original[m])+total*SCALE)
        key=tuple(tuple(choice[1]) for choice in choices)
        index=upper_indices.get(key)
        ordinary=None
        if index:
            rate_steps=[]
            ordinary=expected(changed,frozen=book,rate_passes=rate_steps)
            witnesses[index]=rate_steps
        outcome=candidate(book,actions)
        if outcome is None:
            continue
        recovery=list(map(Fraction,outcome['recovery']))
        score=(sum(recovery),tuple(sorted(r/v for r,v in zip(recovery,loss) if v)))
        tie=tuple(amounts.get((w,m),0) for w in stable for m,_,_,_,_ in domains)
        outcomes.append((score,tuple(x[3] for x in choices),tuple((x[0],x[4]) for x in choices),
                         tie,index,choices,outcome,ordinary))
    best_score=max(row[0] for row in outcomes)
    assert best_score[0]==sum(d[3] for d in domains)
    best=[row for row in outcomes if row[0]==best_score]
    def dominates(a,b):
        if a[1]!=b[1]:
            return all(x<=y for x,y in zip(a[1],b[1]))
        return a[2]!=b[2] and all(x<=y for x,y in zip(a[2],b[2]))
    finalists=[row for row in best if not any(dominates(other,row) for other in best)]
    if len({(row[1],row[2]) for row in finalists}) > 1:
        assert len(book['market_roster']) >= 3
        assert len({tuple(row[6]['recovery']) for row in finalists}) == 1
        assert len({tuple(row[6]['settlement']['spent']) for row in finalists}) == 1
        targets = {d[0] for d in domains}
        def original_market(m):
            return (book['markets'][m]['insurance'], book['markets'][m]['pool'],
                    sorted((r['cash'], r['claims'][m], positions[i][m][:2],
                            tuple((r['claims'][n],positions[i][n][0]) for n in range(len(loss)) if n not in targets))
                           for i,r in enumerate(book['rows'])))
        profiles = [original_market(m) for m in targets]
        assert all(x != y for i,x in enumerate(profiles) for y in profiles[i+1:])
        def market_priority(index):
            market_id = int(book['market_roster'][domains[index][0]])
            payload = bytes(venue) + episode.to_bytes(8,'little') + market_id.to_bytes(2,'little')
            return sha256(b'Rivalt/frozen-market-order/v1\0' + payload).digest(), market_id
        priority_order = sorted(range(len(domains)), key=market_priority)
        def costs(plan):
            return tuple(lots for _, lots in plan[2])
        def fewer(left, right):
            a, b = costs(left), costs(right)
            return a != b and all(x <= y for x,y in zip(a,b))
        finalists = [plan for plan in finalists if not any(fewer(other,plan) for other in finalists)]
        def frozen_rank(plan):
            return (tuple(plan[1][i] for i in priority_order),tuple(costs(plan)[i] for i in priority_order))
        best_rank = min(map(frozen_rank, finalists))
        finalists = [row for row in finalists if frozen_rank(row) == best_rank]
    assert len({(row[1],row[2]) for row in finalists})==1
    _,_,_,_,index,choices,outcome,ordinary=max(finalists,key=lambda row:row[3])
    for key in sorted(witnesses):
        passes.extend(witnesses[key])
    totals=[0]*len(loss)
    splits=[]
    for (m,_,winners,_,_), (total,split,lots,_,_,_) in zip(domains,choices):
        totals[m]=total
        if len(winners)==2:
            splits.append(dict(market=book['market_roster'][m],members=winners,charges=split,lots=lots))
    return dict(denominator=0,selected=index,numerators=[word for step in passes for word in step],
                baselineLoss=list(map(str,loss)),cash=[int(r['cash']) for r in outcome['settlement']['rows']],
                charges=totals,spent=list(map(int,outcome['settlement']['spent'])),
                repaired=ordinary['rows']!=outcome['settlement']['rows'],splits=splits,
                totalPlans=physical,protectedPlans=len(outcomes))


def certificate(book, positions, framed=False, venue=None):
    baseline = expected(book)
    options = []
    groups = []
    for market, cells in enumerate(zip(*positions)):
        pairs = []
        for debtor, (lots, *_) in enumerate(cells):
            debt = int(Fraction(baseline['rows'][debtor]['writeoff'][market]))
            for winner, (opposite, capacity, *_) in enumerate(cells):
                if debt and lots * opposite < 0 and capacity > 0:
                    pairs.append((debtor, winner, min(capacity, debt)))
        if pairs:
            assert len(pairs)<=2 and all(pair[0]==pairs[0][0] for pair in pairs)
            groups.append((market,pairs[0][0],[pair[1] for pair in pairs]))
        options.append(pairs[0] if pairs else (0,0,0))
    if any(len(winners)>1 for _,_,winners in groups):
        assert venue is not None
        return competing_certificate(book,positions,groups,venue)
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
    if 'priority_episode' in data:
        from test_indexed_market_priority import asymmetric_book
        book, positions = asymmetric_book(data.get('multi_lot_winner',False))
        proof = competing_certificate(book, positions, [(0,0,[2,4]),(1,1,[3,5])], bytes(32), data['priority_episode'])
        result = dict(proof=proof, positions=positions, rows=[(int(row['cash']),[int(v)//SCALE for v in row['claims']])
                     for row in book['rows']])
    elif 'probe' in data:
        result = probe(*data['probe'])
    else:
        reserves = [f // 4 for f in data['fees']]
        book = frozen(data['rows'], reserves=reserves, fees=[f-r for f,r in zip(data['fees'], reserves)])
        # Positive limits use the opposite inventory and surviving entry from signed fills.
        result = certificate(book, data['positions'], framed=any(reserves) or data.get('framed', False), venue=data.get('venue'))
    json.dump(result, sys.stdout)
