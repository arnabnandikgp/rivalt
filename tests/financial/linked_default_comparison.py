"""Compare a real two-market freeze with the protected successor and ordinary settlement."""
from fractions import Fraction
from itertools import product
import os
import json
import sys

from account_contract_reference import Account
from bounded_default_search import FrozenSearch
from frozen_plan_selection import FrozenIdentity, select_joint
from joint_reduction_model import Exposure
from market_settlement_reference import MarketBook
from test_native_protected_receipts import protected_command
from test_scalable_settlement import SCALE, decode, run


def comparison(data):
    rows = data['rows']
    by_key = {row['key']: i for i, row in enumerate(rows)}
    debtor = by_key[data['debtor']]
    winners = [by_key[key] for key in data['winners']]
    marks = tuple(map(int, data['marks']))
    flat = data.get('flatCreditor', False)
    other = by_key[data['otherTrader']]
    second = by_key[data['secondBtcWinner']] if data.get('secondBtcWinner') else None
    contested = second is not None
    additional_pass = data.get('additionalInsurancePass', False)
    deposits = 30_029 if additional_pass else 30_000 if contested else 19_996 if flat else 20_012
    assert marks == (50_000, 20_000) and list(map(int, data['funding'])) == [0, 0]
    expected_fills = [(debtor, winners[0], 0, 0, 60_002, 13), (debtor, winners[1], 1, 0, 30_002, 7)]
    if contested:
        expected_fills.append((debtor, second, 0, 0, 60_002, 13))
    equal_winners = 'flatCounterparty' in data
    flat_counterparty = by_key[data['flatCounterparty']] if equal_winners else winners[0]
    if flat:
        expected_fills.extend([(other, flat_counterparty, 0, 1, 64_998, 13), (other, flat_counterparty, 0, 0, 60_002, 13)])
    inactive = by_key[data['inactiveTrader']] if 'inactiveTrader' in data else None
    trader_ids = {debtor, other}
    if inactive is not None:
        assert other == 8 and inactive not in trader_ids
        trader_ids.add(inactive)
    assert len(rows) == len(by_key) == 6 + len(trader_ids)
    lots = [[0, 0] for _ in rows]
    entries = [[None, None] for _ in rows]
    quote = [[0, 0] for _ in rows]
    cash = [deposits if i in trader_ids else int(data['makerDeposit']) for i in range(len(rows))]
    for event, (trader, maker, market, side, gross, fee) in zip(data['fills'], expected_fills, strict=True):
        assert (event['market'], int(event['grossQuote']), int(event['fee']), event['side']) == (data['markets'][market], gross, fee, side)
        assert int(event['lots']) == 1 and len(event['legs']) == 1 and event['legs'][0]['capital'] == rows[maker]['key']
        assert int(event['rootStates'][0]['id']) == int(rows[trader]['id'])
        size = 1 if side == 0 else -1
        for participant, change in ((trader, size), (maker, -size)):
            lots[participant][market] += change
            if abs(lots[participant][market]) > 1:
                assert participant == debtor and market == 0 and entries[participant][market] == gross
            quote[participant][market] -= change * gross
            entries[participant][market] = gross if lots[participant][market] else None
        cash[trader] -= fee
    accounts = []
    for i, row in enumerate(rows):
        claims = tuple(lots[i][m]*marks[m] + quote[i][m] for m in range(2))
        assert tuple(map(int,row['claims'])) == tuple(value*SCALE for value in claims)
        assert row['cash'] == str(cash[i]) and list(map(int,row['lots'])) == lots[i]
        for m, slot in enumerate(row['basis']):
            assert int(slot['paidScaled']) == 0 and Fraction(int(slot['entryScaled']),int(slot['denominator'])*SCALE) == (entries[i][m] or 0)
        accounts.append(Account(cash[i],claims))
    book = MarketBook(tuple(accounts), pools=tuple(map(int,data['pools'])), insurance=tuple(map(int,data['insurance'])),
                      fees=tuple(map(int,data['fees'])), frozen=True)
    insurance, fees = ((13,1), (39,6)) if contested else ((9,1), (30,6)) if flat else ((3,1), (10,6))
    assert (book.pools,book.insurance,book.fees) == ((0,0), insurance, fees)
    exposures = [Exposure(marks[m], tuple(leg[m] for leg in lots), tuple(e[m] for e in entries),
                          tuple(max(0, lots[i][m]*(marks[m]-(entries[i][m] or 0))) for i in range(len(rows)))) for m in range(2)]
    identity = FrozenIdentity(bytes.fromhex(data['venueHex']),int(data['epoch']),tuple(int(r['id']) for r in rows))
    search = FrozenSearch(book,exposures,identity,bytes.fromhex(data['sourceDigest']))
    if additional_pass:
        from check_joint_reductions import terminal_movements, witness
        # Five signed fills leave ten atoms of deficit. Original debtor cash has
        # a 2:1 claim split. BTC's fractional reserve use must round down to six.
        # A second rate solution then preserves that floor and ETH's one atom.
        assert equal_winners and inactive is not None
        original = search.baseline
        collections = original.benchmark.collections
        assert collections[debtor] == (Fraction(59_992, 3), Fraction(29_996, 3))
        assert search.radices == (3,)
        selected = select_joint(book, exposures, identity)
        assert selected.charges == selected.recovered == (0, 2)
        audit = search.advance(search.begin(2), 0, 3)
        assert search.verified_plan(audit) == selected
        before = witness(book)['rates']
        after = witness(selected.book, collections)['rates']
        assert before == [['10002','30006','29999'], ['62512500','187532499','187493750']]
        assert after == [['10000','30000','29999'], ['50000','149996','149995']]
        assert selected.payout.insurance_spent == (6, 1)
        assert selected.payout.cash[other] == 34_999
        assert [selected.payout.cash[i] for i in [winners[0],second,winners[1]]] == [1_010_002,1_010_001,1_010_000]
        def balances(payout):
            return {row['key']: str(amount) for row, amount in zip(rows, payout.cash, strict=True)}
        return dict(cash=balances(selected.payout), ordinaryCash=balances(original),
                    terminal=terminal_movements(book, selected.payout), charges=selected.charges,
                    radices=search.radices, assignments=search.size, proposedRank=2,
                    beforeRates=before, afterRates=after)
    if contested:
        charges, shares = (13, 12), (19_978, 9_989)
        if equal_winners:
            earlier, later = sorted((winners[0], second), key=identity.order().index)
            allocations = ({earlier: 7, later: 6}, {winners[1]: 12})
        else:
            allocations = ({winners[0]: 4, second: 9}, {winners[1]: 12})
        beneficiaries = (other, winners[0], second, winners[1])
        if equal_winners:
            ordinary = (4993, 9997, 9997, 9990)
            successor = (4996, 10002-allocations[0][winners[0]], 10002-allocations[0][second], 9990)
            assert cash[flat_counterparty] == 1000000 and accounts[flat_counterparty].claims == (-4996,0)
        else:
            ordinary, successor = (4993, 5003, 9995, 9990), (4996, 5002, 9993, 9990)
    else:
        charges, share = ((5, 13), 9_988) if flat else ((3, 5), 9_996)
        allocations = ({winners[0]: charges[0]}, {winners[1]: charges[1]})
        shares, beneficiaries = (share, share), (other, *winners)
        ordinary, successor = ((4994,5003,9989), (4996,5001,9989)) if flat else ((0,9999,9997), (0,9999,9997))
    plan = select_joint(book,exposures,identity)
    ordinal, stride = 0, 1
    for market, (_, _, edges, _) in enumerate(search.inputs):
        for debtor_id, position in edges:
            assert debtor_id == debtor
            ordinal += stride * allocations[market][position.member]
            stride *= charges[market] + 1
    assert stride == search.size
    audit = search.begin(ordinal)
    for steps in (3, 7, search.size - 10):
        audit=search.advance(audit,audit.next_ordinal,steps)
    assert search.verified_plan(audit) == plan
    assert plan.charges == plan.recovered == charges
    assert search.baseline.benchmark.collections[debtor] == shares
    for market, leg in enumerate(plan.markets):
        assert {pair.winner: pair.fills for pair in leg.pairs} == {
            winner: ((1, marks[market]+amount),) for winner,amount in allocations[market].items()}
    for adjusted,payout in [(book,search.baseline),(plan.book,plan.payout)]:
        native=decode(run([protected_command(book,adjusted)])[0])
        assert (native['cash'],native['movements'],native['spent']) == (payout.cash,payout.claim_cash_movements,payout.insurance_spent)
    def funded_gains(payout):
        return tuple(payout.cash[i] - cash[i] for i in beneficiaries)
    assert funded_gains(search.baseline) == ordinary
    assert funded_gains(plan.payout) == successor
    def balances(payout):
        return {row['key']: str(amount) for row, amount in zip(rows, payout.cash, strict=True)}
    result = dict(cash=balances(plan.payout), ordinaryCash=balances(search.baseline), charges=charges,
                matched=[pair.fills[0][1] for market in plan.markets for pair in market.pairs],
                winnerCharges={rows[w]['key']: amount for allocation in allocations for w,amount in allocation.items()},
                collections=shares, assignments=search.size)
    if contested and os.environ.get('RIVALT_FROZEN_PLAN_PROOF') == '1':
        result.update(tied_comparison(book, exposures, search, identity, plan, winners[0], second, equal_winners))
    return result


def tied_comparison(book, exposures, search, identity, selected, first_winner, second_winner, equal_winners):
    from check_joint_reductions import terminal_movements, witness
    from frozen_plan_selection import _break_exact_ties
    from joint_reduction_model import evaluate, market_plans
    radices = search.radices
    assert radices == (14, 14, 13)
    options = [market_plans(book, market, exposure, search.baseline) for market, exposure in enumerate(exposures)]
    survivors = {}
    for btc, eth in product(*options):
        if (btc.charged, eth.charged) != selected.charges:
            continue
        plan = evaluate(book, search.baseline, (btc, eth))
        assert plan is not None and tuple(plan.recovered) == (13, 12)
        # Program ordinals enumerate the last eligible pair fastest.
        rank = 0
        for market, (_, _, edges, _) in enumerate(search.inputs):
            for _, position in edges:
                rank = rank * (14 if market == 0 else 13) + plan.markets[market].winner_charges[position.member]
        survivors[rank] = plan
    assert len(survivors) == 14
    best = next(rank for rank,plan in survivors.items() if plan.markets == selected.markets)
    selected_split = tuple(selected.markets[0].winner_charges[maker] for maker in (first_winner,second_winner))
    inferior_split = selected_split[::-1] if equal_winners else (5,8)
    inferior = next(rank for rank,plan in survivors.items() if
                    (plan.markets[0].winner_charges[first_winner],plan.markets[0].winner_charges[second_winner]) == inferior_split)
    coverage = {}
    for rank,plan in survivors.items():
        better = _break_exact_ties([plan,survivors[inferior]], identity, book, exposures, search.baseline)
        coverage[str(rank)] = dict(witness=witness(plan.book, search.baseline.benchmark.collections),
                                   recovery=str(sum(plan.recovered)), beatsInferior=plan != survivors[inferior] and better == plan)
    digits = list(product(*(range(radix) for radix in radices)))
    def bounded(first,last):
        left, right, eth = zip(*digits[first:last+1], strict=True)
        return min(left)+min(right)>13 or min(13,max(left)+max(right))+max(eth)<25
    # Brute coordinate extrema over explicit assignments, independent of the
    # program's mixed-radix endpoint and aggregate budget arithmetic.
    ranges = {}
    cursor = radices[-1]
    while cursor < len(digits):
        if cursor in survivors:
            cursor += 1
            continue
        assert bounded(cursor,cursor)
        end = cursor
        while end+1 < len(digits) and bounded(cursor,end+1):
            end += 1
        ranges[str(cursor)] = end
        cursor = end+1
    return dict(terminal=terminal_movements(book,selected.payout), coverage=coverage, radices=radices, witnesses=[witness(book)],
                tieTest=dict(best=best,inferior=inferior,ranges=ranges))





if __name__ == '__main__':
    print(json.dumps(comparison(json.load(sys.stdin))))
