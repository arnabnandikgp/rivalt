"""Market-count-independent acceptance for frozen settlement and proposed joint reductions."""
import copy
from fractions import Fraction
from itertools import product
import json
import os
import random
import subprocess
import unittest

from clearing_network_reference import InfeasiblePayoutFloor
from test_three_market_default import SCALE, permute
from market_indexed_reference import expected

BINARY = os.getenv("RIVALT_MARKET_SETTLEMENT", "target/debug/examples/market_settlement")


def frozen(members, reserves=None, fees=None):
    width = len(members[0][1])
    ids = [13 + 5*i for i in range(width)]
    rows = []
    for i, (cash, claims) in enumerate(members):
        assert len(claims) == width
        scaled = [Fraction(x) * SCALE for x in claims]
        assert all(x.denominator == 1 for x in scaled)
        rows.append(dict(id=str(100+i), cash=str(cash), claims=[str(int(x)) for x in scaled]))
    markets = [dict(id=key, pool="0", insurance=str(reserve), fees=str(fee))
               for key, reserve, fee in zip(ids, reserves or [0]*width, fees or [0]*width, strict=True)]
    vault = sum(cash for cash, _ in members) + sum(int(m['insurance'])+int(m['fees']) for m in markets)
    return dict(markets=markets, market_roster=ids, rows=rows, roster=[r['id'] for r in rows], vault=str(vault))


def run(books):
    batch = ''.join(json.dumps(book)+'\n' for book in books)
    result = subprocess.run([BINARY], input=batch, text=True, capture_output=True, check=True)
    output = list(map(json.loads, result.stdout.splitlines()))
    assert len(output) == len(books)
    return output


def linked_book(width, protect_winner=False):
    # Two standalone defaults. The last two BTC/ETH creditors must forward
    # what they receive to real third/fourth-market creditors.
    members = [(9, [-11, 0]), (0, [2, -1]), (9, [0, -11]), (0, [-1, 2]),
               (0, [10, 0]), (0, [0, 10])]
    for _, claims in members:
        claims.extend([0]*(width-2))
    for m in range(2, width):
        owner = 1 if protect_winner else 4+(m%2)
        debt = 1 if protect_winner else 9
        members[owner][1][m] -= debt
        row = [0]*width
        row[m] = debt
        members.append((0, row))
    return frozen(members, fees=list(range(1, width+1)))


def leg(book, market, debtor, winner, charge):
    positions = []
    for i, row in enumerate(book['rows']):
        qty = -1 if i == debtor else int(i == winner)
        entry = ((99 if i == debtor else 98) * SCALE * abs(qty)).to_bytes(16, 'little')
        positions.append(dict(member=row['id'], lots=str(qty), entry_bytes=list(entry*2 + abs(qty).to_bytes(8, 'little'))))
    return dict(market=book['markets'][market]['id'], mark='100', positions=positions,
                charges=[dict(debtor=book['rows'][debtor]['id'], winner=book['rows'][winner]['id'], charge=str(charge))])


def candidate(book, legs):
    """Use exact settlement of the adjusted claims, retaining the original debt proportions."""
    before = expected(book)
    changed = copy.deepcopy(book)
    member_index = {r['id']: i for i, r in enumerate(book['rows'])}
    markets = book['market_roster']
    charged = {}
    for action in legs:
        m = markets.index(action['market'])
        for pair in action['charges']:
            debtor, winner = (member_index[pair[key]] for key in ('debtor', 'winner'))
            amount = int(pair['charge'])
            if amount > Fraction(before['rows'][debtor]['writeoff'][m]):
                return None
            for i, delta in [(debtor, amount), (winner, -amount)]:
                row = changed['rows'][i]['claims']
                row[m] = str(int(row[m]) + SCALE*delta)
            charged[winner, m] = charged.get((winner, m), 0) + amount
    after = expected(changed, frozen=book)
    active = {m for _, m in charged}
    floors = {}
    recovery = []
    for m in range(len(markets)):
        improvement = sum(Fraction(b['loss'][m]) - Fraction(a['loss'][m]) for b, a in zip(before['rows'], after['rows']))
        total = sum(cost for (_, market), cost in charged.items() if m == market)
        recovery.append(str(min(improvement, total) if total else 0))
        if not active - {m}:
            continue
        if improvement < 0 or int(after['spent'][m]) > int(before['spent'][m]):
            return None
        for i, (b, a) in enumerate(zip(before['rows'], after['rows'])):
            direct = charged.get((i, m), 0)
            if Fraction(a['recovered'][m]) + direct < Fraction(b['recovered'][m]):
                return None
            if (floor := int(b['movements'][m]) - direct) > 0:
                floors[i, m] = floor
    if any(int(after['rows'][i]['movements'][m]) < floor for (i, m), floor in floors.items()):
        try:
            after = expected(changed, frozen=book, minimums=floors)
        except InfeasiblePayoutFloor:
            return None
    return dict(settlement=after, recovery=recovery, matched=['1']*len(legs))


class MarketSettlementTests(unittest.TestCase):
    def check_permutations(self, data):
        width = len(data['markets'])
        model = expected(data)
        variants = [data, permute(data, list(reversed(range(width))), True),
                    permute(data, list(range(1, width))+[0], False)]
        variants[-1]['market_roster'].reverse()
        self.assertEqual(run(variants), [model]*len(variants))
        return model

    def test_one_recovery_funds_many_creditors(self):
        for debts in ([150], [150, 120], [150, 120, 30], [10, 20, 30, 40, 50, 60, 70]):
            width = len(debts) + 1
            face = sum(debts)
            members = [(0, [-debt for debt in debts] + [face]), (face//2, [0]*(width-1)+[-face])]
            for m, debt in enumerate(debts):
                claim = [0]*width
                claim[m] = debt
                members.append((0, claim))
            data = frozen(members, reserves=[25]+[0]*(width-1), fees=list(range(width)))
            result = self.check_permutations(data)
            self.assertEqual(result['rows'][0]['forwarded'], [str(debt//2) for debt in debts]+['0'])
            self.assertEqual(result['spent'], [str(min(25, debts[0]//2))]+['0']*(width-1))
            self.assertEqual([int(r['cash']) for r in result['rows'][2:]],
                             [debt//2 + (min(25, debts[0]//2) if i == 0 else 0) for i, debt in enumerate(debts)])

    def test_two_positions_per_member_can_connect_twelve_markets(self):
        width = 12
        members = [(25, [-100]+[0]*(width-1))]
        for i in range(width-1):
            claims = [0]*width
            claims[i:i+2] = [100, -100]
            members.append((0, claims))
        members.append((0, [0]*(width-1)+[100]))
        plan = self.check_permutations(frozen(members))
        self.assertEqual(plan['rates'], ['1/4']*width)
        self.assertEqual([r['cash'] for r in plan['rows']], ['0']*width+['25'])

    def test_leaky_cycle_with_eight_markets(self):
        width = 8
        members = []
        for m in range(width):
            row = [0]*width
            row[m] = 10
            row[(m+1)%width] = -10
            members.append((0, row))
        closed = self.check_permutations(frozen(members))
        self.assertEqual(closed['rates'], ['1']*width)
        # Seven markets forward exactly 10*r to the next. In the eighth,
        # 14*r = 1 + 10*r, so the only possible rate is 1/4 throughout.
        members.extend([(0, [4]+[0]*7), (1, [-4]+[0]*7)])
        actual, = run([frozen(members)])
        self.assertEqual(actual['rates'], ['1/4']*width)
        self.assertEqual([row['cash'] for row in actual['rows']], ['0']*8+['1','0'])
        self.assertEqual(actual['spent'], ['0']*width)

    def test_four_market_fractional_books(self):
        rng = random.Random(228)
        for _ in range(12):
            rows = [[Fraction(rng.randrange(-8,9), 4) for _ in range(4)] for _ in range(3)]
            rows.append([-sum(row[m] for row in rows) for m in range(4)])
            self.check_permutations(frozen([(rng.randrange(3), row) for row in rows],
                                           reserves=[rng.randrange(3) for _ in range(4)]))

    def test_joint_payouts_and_foreign_protection(self):
        for width, attached in [(2,False),(3,False),(4,False),(3,True)]:
            data = linked_book(width, attached)
            requests, outcomes = [], []
            for first, second in product(range(3), repeat=2):
                legs = ([leg(data,0,0,1,first)] if first else []) + ([leg(data,1,2,3,second)] if second else [])
                model = candidate(data, legs)
                if (first, second) == (2, 2):
                    if attached:
                        self.assertIsNone(model)
                    else:
                        self.assertEqual(model['recovery'][:2], ['1','1'])
                        self.assertEqual([r['cash'] for r in model['settlement']['rows'][6:]], ['9']*(width-2))
                if bool(first) != bool(second) and max(first,second)==2:
                    self.assertIsNone(model)
                for ordered in [legs, list(reversed(legs))] if len(legs)>1 else [legs]:
                    requests.append(dict(data, joint=ordered))
                    outcomes.append(model or {'error':'Entitlement'})
            self.assertEqual(run(requests), outcomes)

    def test_signed_two_winner_book_has_the_same_protected_split(self):
        # Recreate the frozen economic state reached by six signed fills in #227.
        # Candidate evaluation establishes safety. Among safe full recoveries of
        # ten, equal capacities favor the smallest difference in assigned charge.
        data = frozen([(7884, [120,-5000,-3000]), (289, [-300,0,0]), (1000, [180,0,0]),
                       (2000, [0,5000,0]), (2000, [0,0,3000])], reserves=[1]*3, fees=[3]*3)
        positions = []
        for row, qty, entry in zip(data['rows'], [1,-2,1,0,0], [1000,1000,1030,0,0]):
            cost = (abs(qty)*entry*SCALE).to_bytes(16,'little')
            positions.append(dict(member=row['id'],lots=str(qty),entry_bytes=list(cost*2+abs(qty).to_bytes(8,'little'))))
        cases = []
        for first in range(11):
            charges = [dict(debtor='101', winner=winner, charge=str(charge))
                       for winner, charge in [('100',first),('102',10-first)] if charge]
            action = dict(market=data['markets'][0]['id'],mark='1150',positions=positions,charges=charges)
            cases.append(dict(data,joint=[action]))
        evaluated = run(cases)
        self.assertEqual([i for i, r in enumerate(evaluated) if 'settlement' in r], list(range(5)))
        best = min((abs(i-(10-i)), i) for i,r in enumerate(evaluated) if r.get('recovery')==['10','0','0'])[1]
        self.assertEqual(best,4)
        self.assertEqual(evaluated[best]['matched'], ['1','1'])
        self.assertEqual([r['cash'] for r in evaluated[best]['settlement']['rows']], ['0','0','1174','7000','5000'])
        self.assertEqual(evaluated[best]['settlement']['spent'], ['1','0','0'])

    def test_incomplete_rosters_and_malformed_proposals(self):
        data = linked_book(4)
        requests = []
        for edit in (lambda b: b.pop('market_roster'), lambda b: b['market_roster'].pop(),
                     lambda b: b['market_roster'].__setitem__(2,b['market_roster'][1]),
                     lambda b: b['rows'][0]['claims'].pop(), lambda b: b['roster'].pop(),
                     lambda b: b.update(vault='0')):
            bad=copy.deepcopy(data)
            edit(bad)
            requests.append(bad)
        pair = leg(data,0,0,1,2)
        duplicate = copy.deepcopy(pair)
        duplicate['charges'] *= 2
        requests += [dict(data,joint=[pair,pair]), dict(data,joint=[duplicate]),
                     dict(data,joint=[dict(pair,charges=[])]), dict(data,joint=[dict(pair,market=112)])]
        errors = [out['error'] for out in run(requests)]
        self.assertEqual(errors, ['market roster','Cohort','Cohort','Bounds','Cohort','Invariant']+['Cohort']*4)


if __name__ == '__main__':
    unittest.main(verbosity=2)
