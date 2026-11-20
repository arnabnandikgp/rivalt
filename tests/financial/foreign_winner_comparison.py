"""Reconstruct a BTC winner's ETH liability from finalized fills before comparing default plans."""
from dataclasses import replace
from fractions import Fraction
import json
import sys

from account_contract_reference import Account
from bounded_default_search import FrozenSearch
from clearing_network_reference import clear_atom_cohort
from frozen_plan_selection import FrozenIdentity, select_joint
from joint_reduction_model import Exposure
from market_settlement_reference import MarketBook
from test_native_protected_receipts import protected_command
from test_scalable_settlement import SCALE, decode, run


def compare(data):
    rows = data['rows']
    owners = {row['key']: index for index, row in enumerate(rows)}
    assert len(rows) == len(owners) == 8
    debtor, cross = (owners[data[key]] for key in ('debtor', 'otherTrader'))
    btc_maker, eth_maker = (owners[key] for key in data['winners'])
    assert len({debtor, cross, btc_maker, eth_maker}) == 4
    marks = tuple(map(int, data['marks']))
    assert marks == (40_000, 12_500) and list(map(int, data['funding'])) == [0, 0]
    lots = [[0, 0] for _ in rows]
    virtual = [[0, 0] for _ in rows]
    entries = [[None, None] for _ in rows]
    cash = [20_000 if index in (debtor, cross) else int(data['makerDeposit']) for index in range(len(rows))]
    fees = [0, 0]
    trades = ((debtor, btc_maker, 0, 1, 60_002), (cross, btc_maker, 0, -1, 54_998),
              (cross, eth_maker, 1, 2, 30_002))
    for fill, (trader, maker, market, quantity, price) in zip(data['fills'], trades, strict=True):
        gross = abs(quantity) * price
        fee = (gross + 4_999) // 5_000
        assert (int(fill['rootStates'][0]['id']), fill['market'], fill['side'], int(fill['lots']),
                int(fill['grossQuote']), int(fill['fee'])) == (
                    int(rows[trader]['id']), data['markets'][market], int(quantity < 0), abs(quantity), gross, fee)
        assert len(fill['legs']) == 1 and fill['legs'][0]['capital'] == rows[maker]['key']
        cash[trader] -= fee
        fees[market] += fee
        for member, delta in ((trader, quantity), (maker, -quantity)):
            assert lots[member][market] in (0, -delta)
            lots[member][market] += delta
            entries[member][market] = price if lots[member][market] else None
            virtual[member][market] -= price * delta
    accounts = []
    for index, row in enumerate(rows):
        claims = tuple(virtual[index][market] + lots[index][market] * mark for market, mark in enumerate(marks))
        assert tuple(map(int, row['claims'])) == tuple(claim * SCALE for claim in claims)
        assert list(map(int, row['lots'])) == lots[index] and int(row['cash']) == cash[index]
        for market, position in enumerate(row['basis']):
            assert int(position['paidScaled']) == 0
            assert Fraction(int(position['entryScaled']), int(position['denominator']) * SCALE) == (entries[index][market] or 0)
        accounts.append(Account(cash[index], claims))
    assert accounts[cross] == Account(19_976, (14_998, -35_004))
    book = MarketBook(tuple(accounts), pools=tuple(map(int, data['pools'])),
                      insurance=tuple(map(int, data['insurance'])), fees=tuple(map(int, data['fees'])), frozen=True)
    assert (book.pools, book.insurance, book.fees) == ((0, 0), tuple(fee // 4 for fee in fees),
                                                      tuple(fee - fee // 4 for fee in fees))
    exposures = tuple(Exposure(mark, tuple(pair[market] for pair in lots), tuple(pair[market] for pair in entries),
                               tuple(max(0, pair[market] * (mark - (basis[market] or mark)))
                                     for pair, basis in zip(lots, entries, strict=True))) for market, mark in enumerate(marks))
    identity = FrozenIdentity(bytes.fromhex(data['venueHex']), int(data['epoch']), tuple(int(row['id']) for row in rows))
    search = FrozenSearch(book, exposures, identity, bytes.fromhex(data['sourceDigest']))
    assert search.radices == (10, 34)
    joint = select_joint(book, exposures, identity)
    assert joint.charges == (9, 33)
    audit = search.begin(339)
    for steps in (11, 27, 302):
        audit = search.advance(audit, audit.next_ordinal, steps)
    assert search.verified_plan(audit) == joint
    btc_alone = replace(book, accounts=tuple(Account(account.cash, (joint.markets[0].claims[i], account.claims[1]))
                                            for i, account in enumerate(book.accounts)))
    unprotected = clear_atom_cohort(btc_alone.accounts, book.pools, book.insurance, book.fees,
                                  frozen_collections=search.baseline.benchmark.collections)
    assert search.candidate(9) is None
    native = run([protected_command(book, effective) for effective in (book, btc_alone, joint.book)])
    assert native[1] == 'err:Entitlement'
    for line, plan in ((native[0], search.baseline), (native[2], joint.payout)):
        result = decode(line)
        assert (result['cash'], result['movements'], result['spent']) == (
            plan.cash, plan.claim_cash_movements, plan.insurance_spent)
    def gains(payout):
        return tuple(payout.cash[i] - cash[i] for i in (btc_maker, eth_maker))
    assert gains(search.baseline) == (5_002, 34_970)
    assert gains(unprotected) == gains(joint.payout) == (5_004, 34_968)
    # Equal rounded cash can conceal the absence of a legitimate direct charge.
    assert joint.markets[0].pairs[0].winner == cross and joint.markets[1].pairs[0].winner == eth_maker
    def balances(plan):
        return {row['key']: str(amount) for row, amount in zip(rows, plan.cash, strict=True)}
    from check_joint_reductions import witness
    effective = replace(book, accounts=tuple(Account(account.cash, tuple(market.claims[i] for market in joint.markets))
                                              for i, account in enumerate(book.accounts)))
    return dict(witnesses=[witness(book), witness(effective, search.baseline.benchmark.collections)],ordinaryCash=balances(search.baseline), cash=balances(joint.payout), btcOnlyCash=balances(unprotected),
                charges=joint.charges, assignments=search.size, btcOnlyRejected=native[1],
                recovered=[str(value) for value in joint.recovered], insurance=joint.payout.insurance_spent)


if __name__ == '__main__':
    print(json.dumps(compare(json.load(sys.stdin))))
