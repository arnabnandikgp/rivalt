"""Compare attainable recovery and unconstrained proportional charges on a signed freeze."""
import argparse
import json
import subprocess
from fractions import Fraction
from itertools import combinations, product
from math import ceil, comb, prod
from pathlib import Path

from account_contract_reference import Account
from clearing_network_reference import clear_atom_cohort, clear_rational_cohort
from test_scalable_settlement import independent_input

SCALE = 10**9


def charge_rate(row, market, mark):
    lots = int(row['lots'][market])
    if not lots or int(row['claims'][market]) <= 0:
        return Fraction(0)
    data = bytes(row['history'][market])
    cursor = 6
    fields = []
    for index in range(3):
        size = int.from_bytes(data[2*index:2*index+2], 'little')
        assert cursor + size <= len(data)
        fields.append(int.from_bytes(data[cursor:cursor+size], 'little'))
        cursor += size
    assert not any(data[cursor:])
    entry, paid, denominator = fields
    unit = denominator*SCALE
    gain = (mark*unit-entry) * (1 if lots > 0 else -1)
    room = mark-1 if lots > 0 else 1_000_000-mark
    return max(0, min(Fraction(gain-paid, unit), gain//unit, room))


def proportional_targets(weights, total):
    """Minimize sum(x_i^2 / w_i) over integer x with fixed total and 0 <= x <= w."""
    capacity = sum(weights)
    assert 0 <= total <= capacity and all(weight >= 0 for weight in weights)
    if total == 0:
        return [0]*len(weights)
    shares = [total*weight//capacity for weight in weights]

    def next_credit():
        return min((Fraction(2*share+1, weight), index)
                   for index, (share, weight) in enumerate(zip(shares, weights)) if share < weight)

    for _ in range(total-sum(shares)):
        shares[next_credit()[1]] += 1
    # Convex one-atom marginal costs make the no-improving-exchange condition sufficient.
    while total < capacity:
        last_cost, donor = max((Fraction(2*share-1, weights[i]), i)
                               for i, share in enumerate(shares) if share)
        next_cost, recipient = next_credit()
        if last_cost <= next_cost:
            break
        shares[donor] -= 1
        shares[recipient] += 1
    return shares


def tied_shares(weights, total):
    """Return one base allocation and the complete set of choices at its last marginal cost."""
    shares = proportional_targets(weights, total)
    if not total or total == sum(weights):
        return shares, [], 0
    threshold = max(Fraction(2*shares[i]-1, weight) for i, weight in enumerate(weights) if shares[i])
    last = [i for i,w in enumerate(weights) if shares[i] and Fraction(2*shares[i]-1,w) == threshold]
    next_ties = [i for i,w in enumerate(weights) if shares[i] < w and Fraction(2*shares[i]+1,w) == threshold]
    if not next_ties:
        return shares, [], 0
    for i in last:
        shares[i] -= 1
    return shares, last + next_ties, len(last)


def allocations(base, tied, remaining):
    for chosen in combinations(tied, remaining):
        shares = base.copy()
        for i in chosen:
            shares[i] += 1
        yield shares


class FrozenCase:
    def __init__(self, source):
        self.source = source
        self.rows = source['rows']
        self.inputs = [tuple(map(int, source[key])) for key in ('pools', 'insurance', 'fees')]
        self.table = [(int(row['cash']), tuple(map(int, row['claims']))) for row in self.rows]
        self.lots = [tuple(map(int, row['lots'])) for row in self.rows]
        self.accounts = tuple(Account(cash, tuple(Fraction(claim, SCALE) for claim in claims))
                              for cash, claims in self.table)
        self.original = clear_atom_cohort(self.accounts, *self.inputs)
        self.budgets = [[int(amount) for amount in row] for row in self.original.benchmark.debtor_writeoffs]
        self.ceilings = [sum(row[m] for row in self.budgets) for m in range(2)]
        self.rates = [[charge_rate(row, m, int(mark)) for m, mark in enumerate(source['marks'])]
                      for row in self.rows]

    def eligible_weights(self, market):
        weights = []
        for winner, (_, claims) in enumerate(self.table):
            pairable = sum(abs(lots[market]) for debtor, lots in enumerate(self.lots)
                           if self.budgets[debtor][market] and self.lots[winner][market]*lots[market] < 0
                           and int(min(abs(self.lots[winner][market]), abs(lots[market]))*self.rates[winner][market]) > 0)
            available = min(pairable, abs(self.lots[winner][market]))
            weights.append(min(max(0, claims[market]//SCALE), int(available*self.rates[winner][market])))
        return weights

    def proposal(self, proportional):
        charges = []
        for market in range(2):
            budget = [row[market] for row in self.budgets]
            inventory = [abs(lots[market]) for lots in self.lots]
            credits = self.eligible_weights(market)
            if proportional:
                credits = proportional_targets(credits, self.ceilings[market])
            for debtor in sorted(range(len(budget)), key=lambda i: -budget[i]):
                if not budget[debtor]:
                    continue
                if proportional:
                    order = sorted(range(len(credits)), key=lambda i:
                                   (credits[i] < budget[debtor], abs(budget[debtor]-credits[i]), i))
                else:
                    order = sorted(range(len(credits)), key=lambda i:
                                   (bool(self.lots[i][1-market]), -inventory[i], i))
                for winner in order:
                    if self.lots[debtor][market]*self.lots[winner][market] >= 0:
                        continue
                    rate = self.rates[winner][market]
                    amount = min(budget[debtor], credits[winner], int(rate*min(inventory[winner], inventory[debtor])))
                    if amount == 0:
                        continue
                    matched = ceil(Fraction(amount)/rate)
                    inventory[debtor] -= matched
                    inventory[winner] -= matched
                    budget[debtor] -= amount
                    credits[winner] -= amount
                    charges.append((market, debtor, winner, amount))
                    if not budget[debtor]:
                        break
            if proportional:
                assert not any(credits), "Unconstrained sharing target was not routed"
        return charges

    def sharing_frontier(self, limit):
        # At both debtor ceilings every debtor must spend its whole verified
        # budget. Given winner totals, this fixes every effective claim, for
        # every possible pairing. Rational recovery is earlier than rounding.
        ties = [tied_shares(self.eligible_weights(m), self.ceilings[m]) for m in range(2)]
        counts = [comb(len(tied), remaining) for _, tied, remaining in ties]
        if prod(counts) > limit:
            return dict(allocations=counts, complete=False)
        original = self.original.benchmark
        losses = [sum(row[m] for row in original.creditor_impairments) for m in range(2)]
        minimum_gap = None
        reached = 0
        for btc, eth in product(*(allocations(*entry) for entry in ties)):
            targets = [btc, eth]
            accounts = tuple(Account(account.cash, tuple(account.claims[m]+self.budgets[i][m]-targets[m][i]
                                     for m in range(2))) for i,account in enumerate(self.accounts))
            pools, insurance, fees = self.inputs
            for _ in range(3):
                after = clear_rational_cohort(accounts, pools, insurance, fees, whole_cash_collection=True,
                                              frozen_collections=original.collections)
                if all(spend.denominator == 1 for spend in after.insurance_spent):
                    break
                insurance = tuple(int(spend) if spend.denominator != 1 else insurance[m]
                                  for m,spend in enumerate(after.insurance_spent))
            else:
                raise AssertionError("Two-market insurance clipping did not finish")
            recovery = [min(self.ceilings[m], losses[m]-sum(row[m] for row in after.creditor_impairments))
                        for m in range(2)]
            gap = sum(self.ceilings)-sum(recovery)
            reached += int(gap == 0)
            minimum_gap = gap if minimum_gap is None else min(minimum_gap, gap)
        return dict(allocations=counts, complete=True, reached=reached, smallestShortfall=str(minimum_gap))

    def assess(self, binary, charges):
        changed = [(cash, list(claims)) for cash, claims in self.table]
        collected = self.original.benchmark.collections
        for market, debtor, winner, amount in charges:
            changed[debtor][1][market] += amount*SCALE
            changed[winner][1][market] -= amount*SCALE
        accounts, _, rates, orders = independent_input(changed, *self.inputs, frozen_collections=collected)
        outcome = clear_atom_cohort(accounts, *self.inputs, frozen_collections=collected)
        original = self.source['original']
        request = dict(rows=[dict(row, history=[bytes(v).hex() for v in row['history']]) for row in self.rows],
                       charges=[[str(m), self.rows[d]['id'], self.rows[w]['id'], str(v)] for m,d,w,v in charges],
                       original=dict(rates=[original['rates'], *original['additionalRates']],
                                     orders=[[str(i) for i in order] for order in original['orders']]),
                       effective=dict(rates=[list(map(str, r)) for r in rates], orders=[list(map(str, o)) for o in orders]),
                       measure_recovery_bound=True)
        for key in ('marks', 'pools', 'insurance', 'fees'):
            request[key] = self.source[key]
        receipt = json.loads(subprocess.check_output([binary], input=json.dumps(request), text=True))
        assert 'error' not in receipt, receipt
        assert list(map(int, receipt['recoveryCeilings'])) == self.ceilings
        gross = [sum(amount for m, _, _, amount in charges if m == market) for market in range(2)]
        loss = lambda plan, market: sum(row[market] for row in plan.benchmark.creditor_impairments)
        recovered = [min(gross[m], loss(self.original,m)-loss(outcome,m)) for m in range(2)]
        assert [Fraction(int(n), int(d)) for n,d in receipt['recovered']] == recovered
        assert receipt['bothCeilingsReached'] == (recovered == self.ceilings)
        return dict(pairs=len(charges), gross=list(map(str,gross)), recovered=list(map(str,recovered)),
                    lots=[str(sum(int(fill[1]) for (m,*_),fill in zip(charges,receipt['fills']) if m==market))
                          for market in range(2)], bothCeilingsReached=receipt['bothCeilingsReached'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('freeze', type=Path)
    parser.add_argument('--sharing-budget', type=int, default=4096)
    parser.add_argument('--binary', default='target/release/examples/joint_reduction_audit')
    args = parser.parse_args()
    case = FrozenCase(json.loads(args.freeze.read_text()))
    baseline = case.assess(args.binary, [])
    saturated = case.assess(args.binary, case.proposal(False))
    shared = case.assess(args.binary, case.proposal(True))
    assert saturated['bothCeilingsReached'], "This book needs a tighter bound or another feasible plan"
    print(json.dumps(dict(members=len(case.rows), ceilings=list(map(str,case.ceilings)), baseline=baseline,
                          attained=saturated, unconstrainedSharing=shared,
                          allUnconstrainedTargets=case.sharing_frontier(args.sharing_budget)), indent=2))
