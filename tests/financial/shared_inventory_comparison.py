"""Rebuild competing one-lot debtor and winner inventory from landed trades."""
import json
import sys
from fractions import Fraction

from account_contract_reference import Account
from bounded_default_search import FrozenSearch
from frozen_plan_selection import FrozenIdentity, select_joint
from joint_reduction_model import Exposure
from market_settlement_reference import MarketBook
from test_native_protected_receipts import protected_command
from test_scalable_settlement import SCALE, decode, run


def compare(data):
    rows = data['rows']
    by_key = {row['key']: index for index, row in enumerate(rows)}
    debtors = [by_key[data[name]] for name in ('debtor', 'otherTrader')]
    winners = [by_key[key] for key in data['winners']]
    assert len(rows) == len(by_key) == 8 and len(set(debtors + winners)) == 4
    marks = tuple(map(int, data['marks']))
    assert marks == (40_000, 30_000) and list(map(int, data['funding'])) == [0, 0]
    cash = [20_010 if i in debtors else int(data['makerDeposit']) for i in range(len(rows))]
    lots, entries, faces = [0]*len(rows), [None]*len(rows), [0]*len(rows)
    for debtor, winner, price, fill in zip(debtors, winners, (60_002, 60_006), data['fills'], strict=True):
        fee = (price + 4_999)//5_000
        assert (int(fill['rootStates'][0]['id']), fill['market'], fill['side'], int(fill['lots']),
                int(fill['grossQuote']), int(fill['fee'])) == (int(rows[debtor]['id']), data['markets'][0], 0, 1, price, fee)
        assert len(fill['legs']) == 1 and fill['legs'][0]['capital'] == rows[winner]['key']
        cash[debtor] -= fee
        for index, quantity in ((debtor, 1), (winner, -1)):
            lots[index], entries[index], faces[index] = quantity, price, quantity*(marks[0]-price)
    for index, row in enumerate(rows):
        assert tuple(map(int, row['claims'])) == (faces[index]*SCALE, 0)
        assert tuple(map(int, row['lots'])) == (lots[index], 0) and int(row['cash']) == cash[index]
        for market, basis in enumerate(row['basis']):
            assert int(basis['paidScaled']) == 0
            expected_entry = (entries[index] or 0) if market == 0 else 0
            assert Fraction(int(basis['entryScaled']), int(basis['denominator']) * SCALE) == expected_entry
    book = MarketBook(tuple(Account(balance, (face, 0)) for balance, face in zip(cash, faces)),
                      pools=tuple(map(int,data['pools'])),insurance=tuple(map(int,data['insurance'])),
                      fees=tuple(map(int,data['fees'])),frozen=True)
    assert (book.pools,book.insurance,book.fees) == ((0,0),(6,0),(20,0))
    exposures = (Exposure(marks[0],tuple(lots),tuple(entries),tuple(max(face,0) for face in faces)),
                 Exposure(marks[1],(0,)*len(rows),(None,)*len(rows),(0,)*len(rows)))
    identity = FrozenIdentity(bytes.fromhex(data['venueHex']),int(data['epoch']),tuple(int(row['id']) for row in rows))
    search = FrozenSearch(book,exposures,identity,bytes.fromhex(data['sourceDigest']))
    assert search.size == 324
    # A mix of the two rightful debtor budgets can fit within a single winner's
    # gain but both paired fills would consume the same sole opposite lot.
    _, budgets, edges, _ = search.inputs[0]
    assert [budgets[index] for index in debtors] == [2,5]

    def ordinal(edge_charges):
        index, place = 0,1
        for radix, (debtor, position) in zip(search.radices,edges,strict=True):
            value=edge_charges.get((debtor,position.member),0)
            assert 0<=value<radix
            index += place*value
            place *= radix
        return index

    for winner in winners:
        assert search.candidate(ordinal({(debtor,winner):budgets[debtor] for debtor in debtors})) is None
    best = select_joint(book,exposures,identity)
    pairs = best.markets[0].pairs
    assert len(pairs)==2 and {pair.winner for pair in pairs}==set(winners)
    assert {(pair.debtor,pair.charge) for pair in pairs}==set(zip(debtors,(2,5)))
    assert [best.markets[0].winner_charges[index] for index in winners]==[2,5]
    assert best.markets[0].remaining_lots==(0,)*len(rows)
    audit = search.begin(ordinal({(pair.debtor,pair.winner):pair.charge for pair in pairs}))
    audit = search.advance(audit,0,search.size)
    assert search.verified_plan(audit)==best
    for effective,expected in ((book,search.baseline),(best.book,best.payout)):
        actual=decode(run([protected_command(book,effective)])[0])
        assert (actual['cash'],actual['movements'],actual['spent'])==(expected.cash,expected.claim_cash_movements,expected.insurance_spent)

    def balances(plan):
        return {row['key']:str(plan.cash[index]) for index,row in enumerate(rows)}

    def credits(plan):
        return [plan.cash[index]-cash[index] for index in winners]

    assert credits(search.baseline)==[19_998,20_002] and credits(best.payout)==[20_000,20_000]
    return dict(ordinaryCash=balances(search.baseline),cash=balances(best.payout),ordinaryCredits=credits(search.baseline),
                successorCredits=credits(best.payout),charges=[pair.charge for pair in pairs],assignments=search.size,
                debtorBudgets=[budgets[index] for index in debtors],
                schedules=[dict(debtor=rows[pair.debtor]['id'],winner=rows[pair.winner]['id'],charge=pair.charge,
                                fills=pair.fills) for pair in pairs])


if __name__=='__main__':
    print(json.dumps(compare(json.load(sys.stdin))))
