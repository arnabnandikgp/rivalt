"""Compare complete native BTC/ETH proposals with independent fractional settlement.

Pass a retained linked-default.json to also compare the proposed disbursement
with the balances recorded in that signed episode.
"""
from copy import deepcopy
from dataclasses import replace
from fractions import Fraction
from itertools import product
from math import floor, gcd
from pathlib import Path
import json
import subprocess
import sys

from account_contract_reference import Account
from check_multi_lot_search import history
from frozen_plan_selection import FrozenIdentity, select_joint
from joint_reduction_model import Exposure, evaluate, market_plans
from market_settlement_reference import MarketBook
from settlement_liquidation_model import terminal
from test_joint_market_ties import mirror_book
from test_joint_reductions import linked_defaults
from test_scalable_settlement import SCALE, independent_input

BINARY = Path(__file__).resolve().parents[2] / 'target/debug/examples/joint_reduction_audit'


def strings(values):
    return list(map(str, values))


def scaled(amount):
    exact = Fraction(amount) * SCALE
    assert exact.denominator == 1
    return int(exact)


def witness(book, collections=None):
    rows = [(a.cash, tuple(map(scaled, a.claims))) for a in book.accounts]
    _, _, rates, orders = independent_input(rows, book.pools, book.insurance, book.fees,
                                             frozen_collections=collections)
    return dict(rates=list(map(strings, rates)), orders=list(map(strings, orders)))


def history_bytes(exposure, index):
    qty = exposure.lots[index]
    if not qty:
        return ''
    entry = Fraction(exposure.entries[index]) * SCALE
    gain = max(0, qty * (exposure.mark * SCALE - entry))
    paid = (gain - exposure.unpaid_gains[index] * SCALE) / abs(Fraction(qty))
    denominator = entry.denominator * paid.denominator // gcd(entry.denominator, paid.denominator)
    return history(dict(entryScaled=int(entry*denominator), paidScaled=int(paid*denominator),
                        denominator=denominator), qty)


def original_input(book, exposures, ids):
    rows = [dict(id=str(ids[index]), cash=str(a.cash), claims=strings(map(scaled, a.claims)),
                 lots=strings(e.lots[index] for e in exposures), history=[history_bytes(e, index) for e in exposures])
            for index, a in enumerate(book.accounts)]
    return dict(rows=rows, marks=strings(e.mark for e in exposures), pools=strings(book.pools),
                insurance=strings(book.insurance), fees=strings(book.fees), original=witness(book))


def proposal(source, book, baseline, legs):
    charges, fills = [], []
    ids = [row['id'] for row in source['rows']]
    for market, leg in enumerate(legs):
        for pair in leg.pairs:
            charges.append(strings((market, ids[pair.debtor], ids[pair.winner], pair.charge)))
            lots = sum(size for size, _ in pair.fills)
            base, extra = divmod(pair.charge, lots)
            assert sum(size * abs(price-int(source['marks'][market])) for size, price in pair.fills) == pair.charge
            fills.append(strings((pair.charge, lots, base, extra)))
    changed = replace(book, accounts=tuple(Account(a.cash, (legs[0].claims[i], legs[1].claims[i]))
                                            for i, a in enumerate(book.accounts)))
    request = dict(source, charges=charges, effective=witness(changed, baseline.benchmark.collections))
    independent = evaluate(book, baseline, legs)
    if independent is None:
        return request, None
    expected = dict(budgets=[strings(map(floor, row)) for row in baseline.benchmark.debtor_writeoffs],
                    fills=fills, lots=[strings(pair) for pair in zip(*(leg.remaining_lots for leg in legs))],
                    cash=strings(independent.payout.cash), movements=list(map(strings, independent.payout.claim_cash_movements)),
                    insuranceSpent=strings(independent.payout.insurance_spent),
                    recovered=[strings((x.numerator, x.denominator)) for x in independent.recovered])
    return request, expected


def verify(vectors):
    raw = ''.join(json.dumps(request)+'\n' for request, _ in vectors)
    result = subprocess.run([str(BINARY)], input=raw, text=True, check=True, capture_output=True)
    for line, (request, expected) in zip(result.stdout.splitlines(), vectors, strict=True):
        actual = json.loads(line)
        if expected is None:
            assert 'error' in actual, (request['charges'], actual)
        else:
            assert actual == expected, (request['charges'], actual, expected)
    return len(vectors), sum(expected is not None for _, expected in vectors)


def synthetic():
    portfolios = [mirror_book(), linked_defaults(), linked_defaults(insurance=(1, 2))]
    book, exposures = linked_defaults()
    rows = list(book.accounts)
    rows[0] = Account(9, (Fraction(-23, 2), 0))
    rows[-2] = Account(0, (Fraction(23, 2), 0))
    # A funded BTC pool of one atom and fractional creditors exercise both
    # conservation identities with nonzero market-owned money.
    portfolios.append((replace(book, accounts=tuple(rows), pools=(1, 0), fees=(5, 2)), exposures))
    # A precut paid share makes a partial concession consume multiple lots.
    split = MarketBook((Account(1, (-6, 0)), Account(0, (4, -4)), Account(0, (2, 0)),
                        Account(1, (0, 4))), frozen=True)
    btc = Exposure(100, (-3, 3, 0, 0), (100, 98, None, None), (0, Fraction(5, 2), 0, 0))
    eth = Exposure(80, (0, -2, 0, 2), (None, 80, None, 78), (0, 0, 0, 4))
    portfolios.append((split, (btc, eth)))
    vectors = []
    for book, exposures in portfolios:
        source = original_input(book, exposures, [11 + i*13 for i in range(len(book.accounts))])
        baseline = terminal(book)
        choices = [market_plans(book, market, exposure, baseline) for market, exposure in enumerate(exposures)]
        vectors.extend(proposal(source, book, baseline, pair) for pair in product(*choices))
    # Declared rows are insufficient to authorize any particular fill, even
    # given valid settlement witnesses for the proposed post-reduction balances.
    good = next(request for request, expected in vectors if expected and len(request['charges']) >= 2)
    for variant in ('unknown member', 'duplicate', 'flat winner', 'budget', 'bad rate', 'reordered members',
                    'forged history', 'invalid marks', 'market overflow', 'unbalanced lot inventory'):
        bad = deepcopy(good)
        if variant == 'unknown member':
            bad['charges'][0][1] = '999'
        elif variant == 'duplicate':
            bad['charges'].append(bad['charges'][0])
        elif variant == 'flat winner':
            bad['charges'][0][2] = bad['rows'][-1]['id']
        elif variant == 'budget':
            bad['charges'][0][3] = '1000000'
        elif variant == 'bad rate':
            bad['effective']['rates'] = [['1', '0', '0']]
        elif variant == 'reordered members':
            bad['rows'].reverse()
        elif variant == 'forged history':
            winner = next(r for r in bad['rows'] if r['id'] == bad['charges'][0][2])
            winner['history'][int(bad['charges'][0][0])] = ''
        elif variant == 'invalid marks':
            bad['marks'][1] = '0'
        elif variant == 'market overflow':
            bad['charges'][0][0] = '2'
        else:
            # Keep both histories well formed so only the signed lot sum fails.
            debtor = next(r for r in bad['rows'] if r['id'] == bad['charges'][0][1])
            market = int(bad['charges'][0][0])
            qty = int(debtor['lots'][market])
            debtor['lots'][market] = str(qty + (1 if qty > 0 else -1))
        vectors.append((bad, None))
    return verify(vectors)


def signed(path):
    result = json.loads(path.read_text())
    data = result['inputs']
    ids = tuple(int(row['id']) for row in data['rows'])
    marks = tuple(map(int, data['marks']))
    accounts = tuple(Account(int(row['cash']), tuple(Fraction(int(c), SCALE) for c in row['claims']))
                     for row in data['rows'])
    book = MarketBook(accounts, pools=tuple(map(int, data['pools'])), fees=tuple(map(int, data['fees'])),
                      insurance=tuple(map(int, data['insurance'])), frozen=True)
    exposures = []
    for market, mark in enumerate(marks):
        quantities, entries, gains = [], [], []
        for row in data['rows']:
            terms = row['basis'][market]
            qty = int(row['lots'][market])
            denominator = int(terms['denominator']) * SCALE
            entry = Fraction(int(terms['entryScaled']), denominator)
            paid = abs(qty) * Fraction(int(terms['paidScaled']), denominator)
            quantities.append(qty)
            entries.append(entry if qty else None)
            gains.append(max(0, qty*(mark-entry)-paid))
        exposures.append(Exposure(mark, tuple(quantities), tuple(entries), tuple(gains)))
    identity = FrozenIdentity(bytes.fromhex(data['venueHex']), int(data['epoch']), ids)
    selected = select_joint(book, exposures, identity)
    source = original_input(book, exposures, ids)
    # Use the exact carry and paid history captured from the accounts, including
    # previously paid gains on positions currently below entry.
    for config, row in zip(source['rows'], data['rows'], strict=True):
        config['history'] = [history(terms, int(lots)) for terms, lots in zip(row['basis'], row['lots'], strict=True)]
    request, expected = proposal(source, book, terminal(book), selected.markets)
    assert expected['cash'] == [result['comparison']['cash'][r['key']] for r in data['rows']]
    assert verify([(request, expected)]) == (1, 1)
    return dict(freeze=result['freeze'], recovered=expected['recovered'], charges=request['charges'])


if __name__ == '__main__':
    candidates, admitted = synthetic()
    print(f'{admitted} admitted and {candidates-admitted} refused across {candidates} native checks')
    for filename in sys.argv[1:]:
        print(json.dumps(signed(Path(filename))))
