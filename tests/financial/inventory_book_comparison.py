"""Reconstruct a signed three-debtor BTC book and compare all admissible assignments."""
import json
import sys
from fractions import Fraction

from account_contract_reference import Account
from bounded_default_search import FrozenSearch
from check_shared_inventory import native
from frozen_plan_selection import FrozenIdentity,select_joint
from joint_reduction_model import Exposure
from market_settlement_reference import MarketBook
from test_native_protected_receipts import protected_command
from test_scalable_settlement import SCALE,decode,run


def compare(data):
    rows=data['rows']
    assert len(rows)==9 and [int(row['id']) for row in rows]==list(range(9))
    index={row['key']:i for i,row in enumerate(rows)}
    debtors=[index[key] for key in data['traders']]
    winners=[index[key] for key in data['winners']]
    assert debtors==[6,7,8] and winners==[0,1,2]
    assert [int(mark) for mark in data['marks']]==[40_000,30_000]
    assert list(map(int,data['funding']))==[0,0]
    cash=[20_011 if i in debtors else int(data['makerDeposit']) for i in range(9)]
    lots=[0]*9
    entries=[None]*9
    faces=[0]*9
    for debtor,winner,price,fill in zip(debtors,winners,(60_002,60_003,60_004),data['fills'],strict=True):
        fee=(price+4_999)//5_000
        assert (fill['market'],int(fill['lots']),fill['side'],int(fill['grossQuote']),int(fill['fee']))==(data['markets'][0],1,0,price,fee)
        assert int(fill['rootStates'][0]['id'])==debtor and [leg['capital'] for leg in fill['legs']]==[rows[winner]['key']]
        cash[debtor]-=fee
        for member,side in [(debtor,1),(winner,-1)]:
            lots[member],entries[member],faces[member]=side,price,side*(40_000-price)
    for i,row in enumerate(rows):
        assert int(row['cash'])==cash[i]
        assert list(map(int,row['lots']))==[lots[i],0] and list(map(int,row['claims']))==[faces[i]*SCALE,0]
        for market,basis in enumerate(row['basis']):
            assert int(basis['paidScaled'])==0
            entry=Fraction(int(basis['entryScaled']),int(basis['denominator'])*SCALE)
            assert entry==((entries[i] or 0) if market==0 else 0)
    book=MarketBook(tuple(Account(balance,(face,0)) for balance,face in zip(cash,faces)),
                    pools=tuple(map(int,data['pools'])),insurance=tuple(map(int,data['insurance'])),
                    fees=tuple(map(int,data['fees'])),frozen=True)
    assert (book.pools,book.insurance,book.fees)==((0,0),(9,0),(30,0))
    identity=FrozenIdentity(bytes.fromhex(data['venueHex']),int(data['epoch']),tuple(range(9)))
    exposure=(Exposure(40_000,tuple(lots),tuple(entries),tuple(max(0,face) for face in faces)),
              Exposure(30_000,(0,)*9,(None,)*9,(0,)*9))
    search=FrozenSearch(book,exposure,identity,bytes.fromhex(data['sourceDigest']))
    budgets=[search.inputs[0][1][i] for i in debtors]
    assert budgets==[1,2,2] and search.size==5832
    selected=select_joint(book,exposure,identity)
    pairs=selected.markets[0].pairs
    expected=sorted((pair.debtor,pair.winner,pair.charge) for pair in pairs)
    actual=native(identity.venue,identity.episode,list(zip(debtors,budgets)),[(w,faces[w]) for w in winners],population=True)
    assert actual==expected and len(expected)==3 and sum(pair.charge for pair in pairs)==5
    charges={(p.debtor,p.winner):p.charge for p in pairs}
    ordinal,place=0,1
    for radix,(debtor,position) in zip(search.radices,search.inputs[0][2],strict=True):
        ordinal+=place*charges.get((debtor,position.member),0)
        place*=radix
    verified=search.advance(search.begin(ordinal),0,search.size)
    assert search.verified_plan(verified)==selected
    for effective,expected_cash in [(book,search.baseline),(selected.book,selected.payout)]:
        rust=decode(run([protected_command(book,effective)])[0])
        assert (rust['cash'],rust['movements'],rust['spent'])==(expected_cash.cash,expected_cash.claim_cash_movements,expected_cash.insurance_spent)
    def balances(plan):
        return {row['key']:str(plan.cash[i]) for i,row in enumerate(rows)}
    def credits(plan):
        return [plan.cash[i]-cash[i] for i in winners]
    return dict(ordinaryCash=balances(search.baseline),cash=balances(selected.payout),ordinaryCredits=credits(search.baseline),
                successorCredits=credits(selected.payout),charges=[pair.charge for pair in pairs],assignments=search.size,
                debtorBudgets=budgets,schedules=[dict(debtor=str(p.debtor),winner=str(p.winner),charge=p.charge,fills=p.fills) for p in pairs])


if __name__=='__main__':
    print(json.dumps(compare(json.load(sys.stdin))))
