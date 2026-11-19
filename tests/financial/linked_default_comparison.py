"""Compare a real two-market freeze with the protected successor and ordinary settlement."""
from fractions import Fraction
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
    deposits = 30_000 if contested else 19_996 if flat else 20_012
    assert marks == (50_000, 20_000) and list(map(int, data['funding'])) == [0, 0]
    expected_fills = [(debtor, winners[0], 0, 0, 60_002, 13), (debtor, winners[1], 1, 0, 30_002, 7)]
    if contested:
        expected_fills.append((debtor, second, 0, 0, 60_002, 13))
    if flat:
        expected_fills.extend([(other, winners[0], 0, 1, 64_998, 13), (other, winners[0], 0, 0, 60_002, 13)])
    assert len(rows) == len(by_key) == 8
    lots = [[0, 0] for _ in rows]
    entries = [[None, None] for _ in rows]
    quote = [[0, 0] for _ in rows]
    cash = [deposits if i in (debtor, other) else int(data['makerDeposit']) for i in range(len(rows))]
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
    if contested:
        charges, shares = (13, 12), (19_978, 9_989)
        allocations = ({winners[0]: 4, second: 9}, {winners[1]: 12})
        beneficiaries = (other, winners[0], second, winners[1])
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
    return dict(cash=balances(plan.payout), ordinaryCash=balances(search.baseline), charges=charges,
                matched=[pair.fills[0][1] for market in plan.markets for pair in market.pairs],
                winnerCharges={rows[w]['key']: amount for allocation in allocations for w,amount in allocation.items()},
                collections=shares, assignments=search.size)



if __name__ == '__main__':
    print(json.dumps(comparison(json.load(sys.stdin))))
