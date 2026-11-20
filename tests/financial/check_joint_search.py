"""Compare native complete D120 coverage against independent exact-fraction settlement."""
from copy import deepcopy
from dataclasses import replace
from itertools import product
import json
import subprocess
import sys
from pathlib import Path

from check_joint_reductions import BINARY, comparison_books, original_input, proposal, signed_book, witness
from frozen_plan_selection import FrozenIdentity, IncomparableFinancialProfiles, select_joint
from joint_reduction_model import evaluate, market_losses, market_plans, recovery_score
from settlement_liquidation_model import terminal
from test_joint_reductions import linked_defaults, inactive
from joint_reduction_model import Exposure
from account_contract_reference import Account
from market_settlement_reference import MarketBook
from test_joint_market_ties import mirror_book


def invoke(request):
    result = subprocess.run([str(BINARY)], input=json.dumps(request)+'\n', text=True,
                            check=True, capture_output=True)
    return json.loads(result.stdout)


def compare(book, exposures, epoch=1, ids=None, venue=bytes(32), source=None, expected_cash=None):
    ids = ids or [11 + i * 13 for i in range(len(book.accounts))]
    source = source or original_input(book, exposures, ids)
    baseline = terminal(book)
    plans = [market_plans(book, m, e, baseline) for m, e in enumerate(exposures)]
    rows, scored = [], []
    for legs in product(*plans):
        candidate, expected = proposal(source, book, baseline, legs)
        charges = candidate['charges']
        rows.append(dict(charges=charges, effective=candidate['effective']))
        if expected is not None:
            plan = evaluate(book, baseline, legs)
            scored.append((recovery_score(plan, market_losses(baseline)), charges))
    highest = max(score for score, _ in scored)
    winners = sorted(charges for score, charges in scored if score == highest)
    request = dict(source, charges=[], effective=source['original'],
                   search=dict(limit='10000', epoch=str(epoch), venue_hex=venue.hex(),
                               reflections=[[i^1 for i in range(len(ids))]] if len(ids)%2==0 else [], witnesses=[row for row in reversed(rows) if row['charges']]))
    result = invoke(request)
    assert 'finalists' in result, result
    assert sorted(result['finalists']) == winners
    try:
        chosen = select_joint(book, exposures, FrozenIdentity(venue, epoch, tuple(ids)))
    except IncomparableFinancialProfiles:
        assert result['selected'] is None
    else:
        selected, expected = proposal(source, book, baseline, chosen.markets)
        if expected_cash is not None:
            assert expected['cash'] == expected_cash
            actual = invoke(selected)
            assert actual['cash'] == expected_cash and actual['insuranceSpent'] == expected['insuranceSpent']
        assert result['selected'] == selected['charges'], result
    if len(winners)>1 and book == mirror_book()[0]:
        broken = deepcopy(request)
        broken['search']['reflections'] = [list(range(len(ids))), [0]*len(ids)]
        assert invoke(broken)['selected'] is None
    assert (int(result['valid']), int(result['admitted'])) == (len(rows), len(scored))
    count = int(result['combinations'])
    assert count >= len(rows)
    # One fewer resource credit must never yield a provisional winner.
    limited = deepcopy(request)
    limited['search']['limit'] = str(count - 1)
    answer = invoke(limited)
    assert list(answer) == ['atLeast'] and int(answer['atLeast']) > count - 1
    if request['search']['witnesses']:
        omitted = deepcopy(request)
        omitted['search']['witnesses'].pop()
        assert 'error' in invoke(omitted)
        positive = next((row for row in request['search']['witnesses'] if row['charges'] in winners), None)
        if positive:
            invalid = deepcopy(request)
            index = invalid['search']['witnesses'].index(positive)
            invalid['search']['witnesses'][index]['effective']['rates'] = []
            assert 'error' in invoke(invalid)
    bounded = deepcopy(request)
    # A valid lower bound is optional. A weaker proposal must lead to the same
    # complete decision, including a refusal under a broken reflection.
    bounded['search']['limit'] = str(2*count)
    for hint in ([], result['selected'] or winners[0]):
        bounded['search']['hint'] = hint
        accelerated = invoke(bounded)
        assert accelerated['selected'] == result['selected'] and sorted(accelerated['finalists']) == winners
        assert int(accelerated['leaves'])+int(accelerated['pruned']) == count
    bounded['search']['limit'] = str(int(accelerated['nodes'])-1)
    pending = invoke(bounded)
    assert pending['selected'] is None and pending['finalists'] is None
    return count, len(rows), len(scored), len(winners), int(accelerated['nodes']), int(accelerated['leaves'])


def large_joint():
    size = 5_000_000_000
    lots = size//100
    book = MarketBook((Account(2,(-size-1,-size-1)),Account(0,(size,0)),Account(0,(0,size)),Account(0,(1,1))), frozen=True)
    exposures = (Exposure(1000,(-lots,lots,0,0),(1000,900,None,None),(0,size,0,0)),
                 Exposure(1000,(-lots,0,lots,0),(1000,None,900,None),(0,0,size,0)))
    source = original_input(book,exposures,[10,20,30,40])
    charges = [['0','10','20',str(size)],['1','10','30',str(size)]]
    after = replace(book,accounts=(Account(2,(-1,-1)),Account(0,(0,0)),Account(0,(0,0)),Account(0,(1,1))))
    effective = witness(after,terminal(book).benchmark.collections)
    request=dict(source,charges=charges,effective=effective)
    payment=invoke(request)
    assert payment['cash']==['0','0','0','2'] and payment['recovered']==[[str(size),'1']]*2
    request['search']=dict(limit='256',epoch='2',venue_hex=bytes(32).hex(),reflections=[],hint=charges,
                           witnesses=[dict(charges=charges,effective=effective)])
    result=invoke(request)
    assert result['selected']==charges and int(result['combinations'])==(size+1)**2
    assert int(result['leaves'])==1 and int(result['pruned'])==(size+1)**2-1
    reversed_request = deepcopy(request)
    reversed_request['search']['hint'].reverse()
    reversed_request['search']['witnesses'][0]['charges'].reverse()
    assert invoke(reversed_request) == result
    reversed_request['search']['witnesses'].append(request['search']['witnesses'][0])
    assert invoke(reversed_request) == {'error':'duplicate schedule witness'}
    request['search']['witnesses'][0]['effective']['rates']=[]
    assert 'error' in invoke(request)
    return {key:result[key] for key in ('combinations','nodes','leaves','pruned')}


if __name__ == '__main__':
    books = [*comparison_books(), linked_defaults(insurance=(1, 0)), linked_defaults(insurance=(2, 2))]
    results = [compare(book, exposures) for book, exposures in books]
    mirror, positions = mirror_book()
    for epoch in (1, 2):
        results.append(compare(mirror, positions, epoch, list(range(8))))
    results.append(compare(replace(mirror, fees=(1, 0)), positions))
    for debt in (1,2,3):
        for gain in (1,2,3):
            book = MarketBook((Account(4-debt, (-4,0)),Account(2,(-4,0)),Account(0,(4,0)),Account(0,(4,0))), frozen=True)
            btc = Exposure(100,(-1,-1,1,1),(100,100,100-gain,98),(0,0,gain,2))
            results.append(compare(book,(btc,inactive(4))))
    print(json.dumps(dict(books=len(results),columns=['combinations','structural','admitted','bestRecovery','rangeNodes','rangeLeaves'],results=results,large=large_joint())))

    for filename in sys.argv[1:]:
        record, book, exposures, freeze, source = signed_book(Path(filename))
        # Start with zero witnesses. Exceeding the comparison budget must return
        # a size bound before asking a keeper to prepare any candidate rates.
        probe=dict(source,charges=[],effective=source['original'],search=dict(limit='10000',
                   epoch=str(freeze.episode),venue_hex=freeze.venue.hex(),reflections=[],witnesses=[]))
        outcome=invoke(probe)
        if 'atLeast' not in outcome:
            balances=[record['comparison']['cash'][row['key']] for row in record['inputs']['rows']]
            outcome=compare(book,exposures,freeze.episode,freeze.member_ids,freeze.venue,source,balances)
        print(json.dumps(dict(freeze=record['freeze'],result=outcome)))
