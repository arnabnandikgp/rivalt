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
    # Only two signed fills precede the freeze, with zero funding and no payments.
    assert marks == (50_000, 20_000) and list(map(int, data['funding'])) == [0, 0]
    assert len(rows) == len(by_key) == 8 and len(data['fills']) == 2
    lots = [[0, 0] for row in rows]
    entries = [[None, None] for row in rows]
    cash = [int(data['makerDeposit']) if i not in [debtor, by_key[data['otherTrader']]] else 20_012 for i in range(len(rows))]
    for market, (event, maker, gross, fee) in enumerate(zip(data['fills'], winners, (60_002,30_002), (13,7), strict=True)):
        assert (event['market'],int(event['grossQuote']),int(event['fee']),event['side']) == (data['markets'][market],gross,fee,0)
        assert int(event['lots']) == 1 and len(event['legs']) == 1 and event['legs'][0]['capital'] == rows[maker]['key']
        assert int(event['rootStates'][0]['id']) == int(rows[debtor]['id'])
        lots[debtor][market], lots[maker][market] = 1, -1
        entries[debtor][market] = entries[maker][market] = gross
        cash[debtor] -= fee
    accounts = []
    for i, row in enumerate(rows):
        claims = tuple(lots[i][m]*(marks[m]-(entries[i][m] or 0)) for m in range(2))
        assert tuple(map(int,row['claims'])) == tuple(value*SCALE for value in claims)
        assert row['cash'] == str(cash[i]) and list(map(int,row['lots'])) == lots[i]
        for m, slot in enumerate(row['basis']):
            assert int(slot['paidScaled']) == 0 and Fraction(int(slot['entryScaled']),int(slot['denominator'])*SCALE) == (entries[i][m] or 0)
        accounts.append(Account(cash[i],claims))
    book = MarketBook(tuple(accounts), pools=tuple(map(int,data['pools'])), insurance=tuple(map(int,data['insurance'])),
                      fees=tuple(map(int,data['fees'])), frozen=True)
    assert (book.pools,book.insurance,book.fees)==((0,0),(3,1),(10,6))
    exposures = [Exposure(marks[m], tuple(leg[m] for leg in lots), tuple(e[m] for e in entries),
                          tuple(max(0,account.claims[m]) for account in accounts)) for m in range(2)]
    identity = FrozenIdentity(bytes.fromhex(data['venueHex']),int(data['epoch']),tuple(int(r['id']) for r in rows))
    search = FrozenSearch(book,exposures,identity,bytes.fromhex(data['sourceDigest']))
    assert search.radices == (4,6)
    plan = select_joint(book,exposures,identity)
    audit = search.begin(23)
    for steps in (3,7,14):
        audit=search.advance(audit,audit.next_ordinal,steps)
    assert search.verified_plan(audit) == plan
    assert plan.charges == plan.recovered == (3,5)
    assert search.baseline.benchmark.collections[debtor] == (9996,9996)
    assert [leg.pairs[0].fills for leg in plan.markets] == [((1,50003),),((1,20005),)]
    for adjusted,payout in [(book,search.baseline),(plan.book,plan.payout)]:
        native=decode(run([protected_command(book,adjusted)])[0])
        assert (native['cash'],native['movements'],native['spent']) == (payout.cash,payout.claim_cash_movements,payout.insurance_spent)
    assert plan.payout.cash == search.baseline.cash
    assert [plan.payout.cash[w]-cash[w] for w in winners]==[9999,9997]
    return dict(cash={row['key']:str(amount) for row,amount in zip(rows,plan.payout.cash,strict=True)},
                charges=[3,5], matched=[50003,20005], collections=[9996,9996], assignments=search.size)


if __name__ == '__main__':
    print(json.dumps(comparison(json.load(sys.stdin))))
