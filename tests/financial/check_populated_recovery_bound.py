"""Compare attainable recovery and unconstrained proportional charges on a signed freeze."""
import argparse
import json
import subprocess
from fractions import Fraction
from itertools import combinations, product
from math import ceil, comb, prod
from pathlib import Path

from account_contract_reference import Account
from cross_market_adl_model import protect_receipts
from market_settlement_reference import MarketBook
from clearing_network_reference import clear_atom_cohort, clear_rational_cohort
from test_scalable_settlement import independent_input
from recovery_lot_bound import earliest_winners, lot_bounds, lot_witness, ordered_pair_witness

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


def bounded_shares(weights, total, linked, cap):
    """Solve and independently certify both market-total and linked-subset constraints."""
    shares = proportional_targets(weights, total)
    if sum(shares[i] for i in linked) > cap:
        for members, amount in ((sorted(linked), cap),
                                ([i for i in range(len(weights)) if i not in linked], total-cap)):
            local = proportional_targets([weights[i] for i in members], amount)
            for index, value in zip(members, local):
                shares[index] = value
    linked_total = sum(shares[i] for i in linked)
    assert all(0 <= value <= weight for value,weight in zip(shares,weights))
    assert sum(shares) == total and linked_total <= cap
    # Every competing vector decomposes into same-subset exchanges and then
    # cross-subset exchanges in the direction of its net transfer. Convex costs
    # only increase along those exchanges. Check all permissible first steps.
    for i,paid in enumerate(shares):
        for j,received in enumerate(shares):
            if not paid or received == weights[j] or i == j:
                continue
            if linked_total == cap and i not in linked and j in linked:
                continue
            assert Fraction(2*paid-1,weights[i]) <= Fraction(2*received+1,weights[j])
    return shares


def constrained_targets(weights,total,group,cap,limit):
    # The integer minimum cost at a specified group total is convex in that
    # total: marginal costs within each subset are nondecreasing. If every
    # unrestricted minimizer exceeds cap, the constrained optimum binds cap.
    def choices(subweights, amount):
        base,ties,count = tied_shares(subweights,amount)
        assert comb(len(ties),count) <= limit, "Too many tied allocations for this diagnostic"
        return list(allocations(base,ties,count))
    unconstrained = [x for x in choices(weights,total) if sum(x[i] for i in group) <= cap]
    if unconstrained:
        return unconstrained
    inside = sorted(group)
    outside = [i for i in range(len(weights)) if i not in group]
    groups = [choices([weights[i] for i in indices],value)
              for indices,value in ((inside,cap),(outside,total-cap))]
    assert prod(map(len,groups)) <= limit, "Too many constrained ties for this diagnostic"
    results = []
    for left,right in product(*groups):
        result = [0]*len(weights)
        for i,x in zip(inside+outside,left+right):
            result[i] = x
        results.append(result)
    return results


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
        self.original_budgets = [list(map(int, row)) for row in self.original.benchmark.debtor_writeoffs]
        self.budgets = [[amount if lots[m] else 0 for m, amount in enumerate(row)]
                        for row, lots in zip(self.original_budgets, self.lots)]
        self.original_ceilings = [sum(row[m] for row in self.original_budgets) for m in range(2)]
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

    def proposal(self, proportional, targets=None):
        charges = []
        for market in range(2):
            budget = [row[market] for row in self.budgets]
            inventory = [abs(lots[market]) for lots in self.lots]
            credits = self.eligible_weights(market)
            if proportional:
                credits = targets[market].copy() if targets is not None else proportional_targets(credits, self.ceilings[market])
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

    def linked_share_bounds(self):
        # At both recovery ceilings the debtor charges are fixed. The available
        # pool, original collections and entire insurance give an upper bound
        # on outside cash. Incoming cross payments cannot exceed remaining debt.
        original = self.original.benchmark
        pools, insurance, _ = self.inputs
        linked = [[link for link in original.links if link.destination_market == m] for m in range(2)]
        positives = [sum(max(0, a.claims[m]) for a in self.accounts) for m in range(2)]
        cash = [pools[m]+insurance[m]+sum(row[m] for row in original.collections) for m in range(2)]
        rate_caps = []
        for m in range(2):
            face = positives[m]-self.ceilings[m]
            received = sum(link.debt-self.budgets[link.account_index][m] for link in linked[m])
            assert face >= 0 and received >= 0
            rate_caps.append(min(1,Fraction(cash[m]+received,face)) if face else Fraction(1))
        result = []
        for market in range(2):
            other = 1-market
            links = linked[other]
            group = {link.account_index for link in links}
            required = max(0, positives[other]*original.rates[other]-cash[other])
            # To maintain the foreign market's recovery, the remaining positive
            # source claims times the source rate must cover its required inflow.
            if required:
                assert rate_caps[market] > 0, "Positive foreign receipts are infeasible"
                limit = sum(link.claim for link in links)-required/rate_caps[market]
                assert limit >= 0, "No feasible full-recovery plan under this bound"
                cap = min(self.ceilings[market],int(limit))
            else:
                cap = self.ceilings[market]
            result.append((group,cap))
        return result

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

    def assess(self, binary, charges, check_pair_order=False):
        changed = [(cash, list(claims)) for cash, claims in self.table]
        collected = self.original.benchmark.collections
        for market, debtor, winner, amount in charges:
            changed[debtor][1][market] += amount*SCALE
            changed[winner][1][market] -= amount*SCALE
        accounts, _, rates, orders = independent_input(changed, *self.inputs, frozen_collections=collected)
        outcome = clear_atom_cohort(accounts, *self.inputs, frozen_collections=collected)
        winners = [[0,0] for _ in self.rows]
        for market,_,winner,amount in charges:
            winners[winner][market] += amount
        floors = {}
        for market in range(2):
            if not any(row[1-market] for row in winners):
                continue
            for index,account in enumerate(self.accounts):
                if account.claims[market] > 0:
                    direct = winners[index][market]
                    assert (accounts[index].claims[market]*outcome.benchmark.rates[market]
                            >= account.claims[market]*self.original.benchmark.rates[market]-direct)
                    minimum = self.original.claim_cash_movements[index][market]-direct
                    if minimum > 0:
                        floors[index,market] = minimum
        outcome = protect_receipts(MarketBook(accounts,*self.inputs,frozen=True),outcome,floors,collected)
        assert outcome is not None
        original = self.source['original']
        request = dict(rows=[dict(row, history=[bytes(v).hex() for v in row['history']]) for row in self.rows],
                       charges=[[str(m), self.rows[d]['id'], self.rows[w]['id'], str(v)] for m,d,w,v in charges],
                       original=dict(rates=[original['rates'], *original['additionalRates']],
                                     orders=[[str(i) for i in order] for order in original['orders']]),
                       effective=dict(rates=[list(map(str, r)) for r in rates], orders=[list(map(str, o)) for o in orders]),
                       measure_recovery_bound=True)
        request['check_original_page_budgets'] = True
        if check_pair_order:
            request['check_dense_sharing'] = True
            request['pair_order'] = dict(venue_hex=bytes(self.source['venue']).hex(), epoch=self.source['epoch'])
        for key in ('marks', 'pools', 'insurance', 'fees'):
            request[key] = self.source[key]
        receipt = json.loads(subprocess.check_output([binary], input=json.dumps(request), text=True))
        assert 'error' not in receipt, receipt
        assert [list(map(int,row)) for row in receipt['originalPageBudgets']] == self.original_budgets
        assert list(map(int,receipt['cash'])) == list(outcome.cash)
        assert [list(map(int,row)) for row in receipt['movements']] == [list(row) for row in outcome.claim_cash_movements]
        assert list(map(int,receipt['insuranceSpent'])) == list(outcome.insurance_spent)
        assert list(map(int, receipt['recoveryCeilings'])) == self.original_ceilings
        assert list(map(int, receipt['openLotCeilings'])) == self.ceilings
        gross = [sum(amount for m, _, _, amount in charges if m == market) for market in range(2)]
        loss = lambda plan, market: sum(row[market] for row in plan.benchmark.creditor_impairments)
        recovered = [min(gross[m], loss(self.original,m)-loss(outcome,m)) for m in range(2)]
        assert [Fraction(int(n), int(d)) for n,d in receipt['recovered']] == recovered
        assert receipt['bothCeilingsReached'] == (recovered == self.original_ceilings)
        assert receipt['openLotCeilingsReached'] == (recovered == self.ceilings)
        pair_result = dict(pairOrderAtFixedTotals=receipt['pairOrderAtFixedTotals']) if check_pair_order else {}
        if check_pair_order:
            assert [int(value) for value in receipt['linkedChargeCaps']] == [cap for _,cap in self.linked_share_bounds()]
            pair_result.update(sharingAtFullRecovery=receipt['sharingAtFullRecovery'],
                               matchedLotFloors=receipt['matchedLotFloors'], winnerLotFloors=receipt['winnerLotFloors'])
        return dict(**pair_result, pairs=len(charges), gross=list(map(str,gross)), recovered=list(map(str,recovered)),
                    lots=[str(sum(int(fill[1]) for (m,*_),fill in zip(charges,receipt['fills']) if m==market))
                          for market in range(2)], bothCeilingsReached=receipt['openLotCeilingsReached'],
                    originalWriteoffCeilingsReached=receipt['bothCeilingsReached'])


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
    bounds = case.linked_share_bounds()
    targets = [bounded_shares(case.eligible_weights(m),case.ceilings[m],*bounds[m]) for m in range(2)]
    bounded = case.assess(args.binary, case.proposal(True,targets))
    assert bounded['bothCeilingsReached'], "Linked relaxation needs an additional feasibility constraint"
    choices = [constrained_targets(case.eligible_weights(m),case.ceilings[m],*bounds[m],args.sharing_budget) for m in range(2)]
    minimum_lots = lot_bounds(case,choices)
    winners = earliest_winners(case,choices)
    charges = lot_witness(case,winners)
    assert [[sum(amount for market,_,index,amount in charges if market==m and index==i)
             for i in range(len(case.rows))] for m in range(2)] == winners
    fewest = case.assess(args.binary,charges,check_pair_order=True)
    assert fewest['bothCeilingsReached'] and list(map(int,fewest['lots'])) == minimum_lots
    ordered = ordered_pair_witness(case,winners,minimum_lots)
    assert [[sum(charge for market,_,winner,charge in ordered if market==m and winner==i)
             for i in range(len(case.rows))] for m in range(2)] == winners
    final = case.assess(args.binary,ordered,check_pair_order=True)
    assert final['bothCeilingsReached'] and final['pairOrderAtFixedTotals']
    assert final['sharingAtFullRecovery'] and list(map(int,final['matchedLotFloors'])) == minimum_lots
    assert list(map(int,final['lots'])) == minimum_lots
    assert saturated['bothCeilingsReached'], "This book needs a tighter bound or another feasible plan"
    print(json.dumps(dict(members=len(case.rows), ceilings=list(map(str,case.ceilings)),
                          originalWriteoffCeilings=list(map(str,case.original_ceilings)), baseline=baseline,
                          attained=saturated, unconstrainedSharing=shared,
                          optimalSharingAtMaximum=bounded, minimumLots=list(map(str,minimum_lots)),
                          tiedWinnerAllocations=list(map(len,choices)), episodeOrderedWinners=fewest, episodeOrderedPairs=final, linkedChargeCaps=[str(cap) for _,cap in bounds],
                          allUnconstrainedTargets=case.sharing_frontier(args.sharing_budget)), indent=2))
