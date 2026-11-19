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
    partial = data.get('smallWinnerEntry') is not None
    entry = int(data['smallWinnerEntry']) if partial else None
    assert len(rows) == len(by_key) == (9 if partial else 8) and len(set(debtors + winners)) == 4
    marks = tuple(map(int, data['marks']))
    assert marks == (40_000, 30_000) and list(map(int, data['funding'])) == [0, 0]
    third = by_key[data['thirdTrader']] if partial else None
    flat = by_key[data['flatMaker']] if partial else None
    deposits = set(debtors) | ({third} if partial else set())
    cash = [(20_000 if partial else 20_010) if i in deposits else int(data['makerDeposit']) for i in range(len(rows))]
    lots, entries, virtual = [0]*len(rows), [None]*len(rows), [0]*len(rows)
    trades = [(debtors[0],flat if partial else winners[0],1,60_002), (debtors[1],winners[1],1,60_006)]
    if partial:
        assert entry in (40_000,40_001)
        trades.extend([(third,flat,-1,entry),(third,winners[0],1,entry)])
    fees_paid=0
    for (trader,maker,side,price),fill in zip(trades,data['fills'],strict=True):
        fee = (price+4_999)//5_000
        assert (int(fill['rootStates'][0]['id']),fill['market'],fill['side'],int(fill['lots']),
                int(fill['grossQuote']),int(fill['fee'])) == (int(rows[trader]['id']),data['markets'][0],0 if side==1 else 1,1,price,fee)
        assert len(fill['legs'])==1 and fill['legs'][0]['capital']==rows[maker]['key']
        cash[trader]-=fee
        fees_paid+=fee
        for index,change in ((trader,side),(maker,-side)):
            assert lots[index] in (0,-change)
            lots[index]+=change
            virtual[index]-=change*price
            entries[index]=price if lots[index] else None
    faces=[position*marks[0]+quote for position,quote in zip(lots,virtual,strict=True)]
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
    assert (book.pools,book.insurance,book.fees) == ((0,0),(fees_paid//4,0),(fees_paid-fees_paid//4,0))
    exposures = (Exposure(marks[0],tuple(lots),tuple(entries),tuple(max(face,0) for face in faces)),
                 Exposure(marks[1],(0,)*len(rows),(None,)*len(rows),(0,)*len(rows)))
    identity = FrozenIdentity(bytes.fromhex(data['venueHex']),int(data['epoch']),tuple(int(row['id']) for row in rows))
    search = FrozenSearch(book,exposures,identity,bytes.fromhex(data['sourceDigest']))
    assert search.size == (324 if not partial else 572 if entry==40_001 else 154)
    # A mix of the two rightful debtor budgets can fit within a single winner's
    # gain but both paired fills would consume the same sole opposite lot.
    _, budgets, edges, _ = search.inputs[0]
    expected_budgets = [2,5] if not partial else [10,12] if entry==40_001 else [10,13]
    assert [budgets[index] for index in debtors] == expected_budgets

    def ordinal(edge_charges):
        index, place = 0,1
        for radix, (debtor, position) in zip(search.radices,edges,strict=True):
            value=edge_charges.get((debtor,position.member),0)
            assert 0<=value<radix
            index += place*value
            place *= radix
        return index

    for winner in winners:
        if all((debtor,winner) in {(d,p.member) for d,p in edges} for debtor in debtors):
            assert search.candidate(ordinal({(debtor,winner):1 for debtor in debtors})) is None
    best = select_joint(book,exposures,identity)
    pairs = best.markets[0].pairs
    charges = [next((p.charge for p in pairs if p.debtor==debtor),0) for debtor in debtors]
    expected_charges = [2,5] if not partial else ([1,12] if entry==40_001 else [0,13])
    assert charges==expected_charges
    assert {(p.debtor,p.winner) for p in pairs}=={(d,w) for d,w,c in zip(debtors,winners,charges) if c}
    assert [best.markets[0].winner_charges[index] for index in winners]==charges
    remaining=lots.copy()
    for pair in pairs:
        assert sum(size for size,_ in pair.fills)==1
        remaining[pair.debtor]=remaining[pair.winner]=0
    assert best.markets[0].remaining_lots==tuple(remaining)
    audit = search.begin(ordinal({(pair.debtor,pair.winner):pair.charge for pair in pairs}))
    audit = search.advance(audit,0,search.size)
    assert search.verified_plan(audit)==best
    for effective,expected in ((book,search.baseline),(best.book,best.payout)):
        actual=decode(run([protected_command(book,effective)])[0])
        assert (actual['cash'],actual['movements'],actual['spent'])==(expected.cash,expected.claim_cash_movements,expected.insurance_spent)

    def balances(plan):
        return {row['key']:str(plan.cash[index]) for index,row in enumerate(rows)}

    def credits(plan):
        return [plan.cash[index]-cash[index] for index in ([flat,*winners] if partial else winners)]

    if not partial:
        assert credits(search.baseline)==[19_998,20_002] and credits(best.payout)==[20_000,20_000]
    elif entry==40_001:
        assert credits(search.baseline)==[19_990,1,19_994] and credits(best.payout)==[19_996,0,19_989]
    return dict(ordinaryCash=balances(search.baseline),cash=balances(best.payout),ordinaryCredits=credits(search.baseline),
                successorCredits=credits(best.payout),charges=charges,assignments=search.size,
                debtorBudgets=expected_budgets,
                schedules=[dict(debtor=rows[pair.debtor]['id'],winner=rows[pair.winner]['id'],charge=pair.charge,
                                fills=pair.fills) for pair in pairs])


if __name__=='__main__':
    print(json.dumps(compare(json.load(sys.stdin))))
