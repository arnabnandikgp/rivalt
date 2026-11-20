"""Whole-lot lower bounds and a constructive transport witness for a populated freeze."""
from fractions import Fraction
from math import ceil
from frozen_plan_selection import FrozenIdentity


def integer_transport(left, right):
    """Match two nonnegative integer vectors with equal totals on a complete bipartite graph."""
    left, right = left.copy(), right.copy()
    assert sum(left.values()) == sum(right.values()) and min([0,*left.values(),*right.values()]) == 0
    flows = {}
    for debtor in sorted(left, key=lambda i: -left[i]):
        for winner in sorted(right, key=lambda i: -right[i]):
            sent = min(left[debtor], right[winner])
            if sent:
                flows[debtor,winner] = sent
                left[debtor] -= sent
                right[winner] -= sent
            if not left[debtor]:
                break
    assert not any(left.values()) and not any(right.values())
    return flows


def lot_witness(case, targets):
    """A sufficient construction. The native verifier must admit the exact filled quantities."""
    charges = []
    for market, shares in enumerate(targets):
        # Charges can only flow between opposing positions. A common conservative
        # tick suffices for this construction even if some winners have better rates.
        for sign in (-1,1):
            owed = {i:row[market] for i,row in enumerate(case.budgets) if row[market] and sign*case.lots[i][market] > 0}
            gains = {i:value for i,value in enumerate(shares) if value and sign*case.lots[i][market] < 0}
            if not owed and not gains:
                continue
            assert owed and gains and sum(owed.values()) == sum(gains.values())
            ticks = min(int(case.rates[i][market]) for i in gains)
            assert ticks > 0, "This construction requires a positive whole tick"
            debtor_lots = {i:ceil(Fraction(v,ticks)) for i,v in owed.items()}
            winner_lots = {i:ceil(Fraction(v,ticks)) for i,v in gains.items()}
            lower = debtor_lots if sum(debtor_lots.values()) < sum(winner_lots.values()) else winner_lots
            extra = abs(sum(debtor_lots.values())-sum(winner_lots.values()))
            for i in sorted(lower, key=lambda i:(-lower[i],i)):
                if extra and lower[i] < abs(case.lots[i][market]):
                    lower[i] += 1
                    extra -= 1
            assert extra == 0, "No capacity for the proposed whole-lot assignment"
            assert all(q <= abs(case.lots[i][market]) for side in (debtor_lots,winner_lots) for i,q in side.items())
            # Assign the unused tick capacity first. Then transfer full lots
            # between the remaining row and column quotas at the common tick.
            unused = integer_transport({i:q*ticks-owed[i] for i,q in debtor_lots.items()},
                                       {i:q*ticks-gains[i] for i,q in winner_lots.items()})
            quantities = {}
            for (debtor,winner), slack in unused.items():
                quantity = ceil(Fraction(slack,ticks))
                quantities[debtor,winner] = quantity
                debtor_lots[debtor] -= quantity
                winner_lots[winner] -= quantity
            for pair,quantity in integer_transport(debtor_lots,winner_lots).items():
                quantities[pair] = quantities.get(pair,0)+quantity
            for (debtor,winner),quantity in quantities.items():
                amount = quantity*ticks-unused.get((debtor,winner),0)
                if amount:
                    charges.append((market,debtor,winner,amount))
    return charges


def lot_bounds(case, allocations):
    """Every full-recovery debtor must pay; every possible optimal winner vector is considered."""
    bounds = []
    for market, choices in enumerate(allocations):
        debtor_bound = 0
        for debtor,budget in enumerate(case.budgets):
            if budget[market]:
                best = max(row[market] for i,row in enumerate(case.rates)
                           if case.lots[i][market]*case.lots[debtor][market] < 0)
                debtor_bound += ceil(Fraction(budget[market])/best)
        winner_bound = min(sum(ceil(Fraction(x)/case.rates[i][market]) for i,x in enumerate(shares) if x)
                           for shares in choices)
        bounds.append(max(debtor_bound,winner_bound))
    return bounds


def earliest_winners(case, allocations):
    order = FrozenIdentity(bytes(case.source['venue']),int(case.source['epoch']),
                           tuple(int(row['id']) for row in case.rows)).order()
    return [max(choices,key=lambda shares:tuple(shares[i] for i in order)) for choices in allocations]
