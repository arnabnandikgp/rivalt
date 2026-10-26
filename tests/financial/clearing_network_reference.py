"""P22B exact-rational benchmark for a complete two-market frozen cohort.

This is independent of Rust/SDK code and deliberately is NOT executable settlement.
The rational benchmark can have fractional cash effects. The whole-atom output
candidate conserves each market/account, but still uses arbitrary-size rational
internals. Numeric bounds, authority and staged implementation remain G17/P26 gates.
"""

from dataclasses import dataclass
from fractions import Fraction
from itertools import product

from account_contract_reference import Account, require


@dataclass(frozen=True)
class ClaimLink:
    account_index: int
    source_market: int
    destination_market: int
    claim: Fraction
    debt: Fraction


@dataclass(frozen=True)
class AffineSegment:
    lower: Fraction
    upper: Fraction
    intercept: Fraction
    slope: Fraction


@dataclass(frozen=True)
class ClearingBenchmark:
    rates: tuple[Fraction, Fraction]
    collections: tuple[tuple[Fraction, Fraction], ...]
    links: tuple[ClaimLink, ...]
    link_payments: tuple[Fraction, ...]
    insurance_spent: tuple[Fraction, Fraction]
    cash_entitlements: tuple[Fraction, ...]
    creditor_impairments: tuple[tuple[Fraction, Fraction], ...]
    debtor_writeoffs: tuple[tuple[Fraction, Fraction], ...]
    segment_pairs: int

    @property
    def has_fractional_cash_effects(self):
        amounts = (*self.insurance_spent, *self.cash_entitlements,
                   *(amount for collection in self.collections for amount in collection))
        return any(amount.denominator != 1 for amount in amounts)


def _curve_segments(positive, base, insurance, links):
    """Exact branches of min(1, (base + I + sum(min(debt, claim*x))) / W)."""
    if positive == 0:
        return (AffineSegment(Fraction(0), Fraction(1), Fraction(1), Fraction(0)),)
    boundaries = sorted({Fraction(0), Fraction(1),
                         *(link.debt / link.claim for link in links if link.debt < link.claim)})
    segments = []
    for lower, upper in zip(boundaries, boundaries[1:]):
        midpoint = (lower + upper) / 2
        fixed = sum(link.debt for link in links if link.claim * midpoint >= link.debt)
        variable = sum(link.claim for link in links if link.claim * midpoint < link.debt)
        intercept = (base + insurance + fixed) / positive
        slope = variable / positive
        if intercept + slope * lower >= 1:
            segments.append(AffineSegment(lower, upper, Fraction(1), Fraction(0)))
        elif intercept + slope * upper <= 1:
            segments.append(AffineSegment(lower, upper, intercept, slope))
        else:
            crossing = (1 - intercept) / slope
            segments.append(AffineSegment(lower, crossing, intercept, slope))
            segments.append(AffineSegment(crossing, upper, Fraction(1), Fraction(0)))
    return tuple(segments)


def _greatest_rates(positives, bases, insurance, links):
    incoming = tuple(tuple(link for link in links if link.destination_market == market)
                     for market in range(2))
    curves = tuple(_curve_segments(positives[market], bases[market], insurance[market],
                                   incoming[market]) for market in range(2))
    candidates = set()

    def evaluate(market, other_rate):
        if positives[market] == 0:
            return Fraction(1)
        recovered = sum(min(link.debt, link.claim * other_rate) for link in incoming[market])
        return min(Fraction(1), (bases[market] + insurance[market] + recovered) / positives[market])

    for first, second in product(*curves):
        determinant = 1 - first.slope * second.slope
        if determinant == 0:
            # A closed unbacked cycle admits a continuum. Choose its greatest
            # branch endpoint: circular setoff is not a reason to spend insurance.
            if first.intercept + first.slope * second.intercept != 0:
                continue
            lower = max(second.lower, first.intercept + first.slope * first.lower)
            upper = min(second.upper, first.intercept + first.slope * first.upper)
            if lower > upper:
                continue
            first_rate = upper
        else:
            first_rate = (first.intercept + first.slope * second.intercept) / determinant
        second_rate = second.intercept + second.slope * first_rate
        if not (second.lower <= first_rate <= second.upper and
                first.lower <= second_rate <= first.upper):
            continue
        if first_rate == evaluate(0, second_rate) and second_rate == evaluate(1, first_rate):
            candidates.add((first_rate, second_rate))

    require(bool(candidates), "clearing benchmark has no exact fixed point")
    greatest = max(candidates, key=sum)
    require(all(all(chosen >= candidate for chosen, candidate in zip(greatest, alternative))
                for alternative in candidates), "fixed points have no greatest candidate")
    return greatest, len(curves[0]) * len(curves[1])


def clear_rational_cohort(accounts, pools=(0, 0), insurance=(0, 0), fees=(0, 0), *,
                          whole_cash_collection=False):
    """Resolve ideal entitlements, retaining every cross-market obligation.

    Risk has no positive unpaid credit. This function is only a simultaneous
    terminal-clearing benchmark after complete frozen valuation, not live margin
    netting or an instruction that can borrow/advance unpaid profit.
    """
    require(type(accounts) is tuple and 0 < len(accounts) <= 64 and
            all(type(account) is Account for account in accounts), "invalid complete cohort")
    for balances in (pools, insurance, fees):
        require(type(balances) is tuple and len(balances) == 2 and
                all(type(amount) is int and amount >= 0 for amount in balances),
                "market cash pools must be whole nonnegative atoms")
    require(all(sum(account.claims[market] for account in accounts) == pools[market]
                for market in range(2)), "per-market claim identity is broken")
    require(type(whole_cash_collection) is bool, "invalid collection policy")

    debts = tuple(tuple(max(-claim, Fraction(0)) for claim in account.claims) for account in accounts)
    positives = tuple(sum(max(account.claims[market], Fraction(0)) for account in accounts)
                      for market in range(2))
    collections = []
    links = []
    for account_index, (account, owed) in enumerate(zip(accounts, debts)):
        total_debt = sum(owed)
        collectible = (Fraction(total_debt.numerator // total_debt.denominator)
                       if whole_cash_collection else total_debt)
        available = min(Fraction(account.cash), collectible)
        collected = tuple(available * debt / total_debt if total_debt else Fraction(0) for debt in owed)
        collections.append(collected)
        for source_market in range(2):
            destination = 1 - source_market
            claim = account.claims[source_market]
            remaining_debt = owed[destination] - collected[destination]
            if claim > 0 and remaining_debt > 0:
                links.append(ClaimLink(account_index, source_market, destination, claim, remaining_debt))
    collections = tuple(collections)
    links = tuple(links)
    bases = tuple(Fraction(pools[market]) + sum(row[market] for row in collections) for market in range(2))
    rates, segment_pairs = _greatest_rates(positives, bases, insurance, links)
    flows = tuple(min(link.debt, link.claim * rates[link.source_market]) for link in links)
    residual_debts = [list(debt) for debt in debts]
    cash_entitlements = [Fraction(account.cash) - sum(collection) +
                         sum(max(claim, Fraction(0)) * rate for claim, rate in zip(account.claims, rates))
                         for account, collection in zip(accounts, collections)]
    for row_index, collection in enumerate(collections):
        for market in range(2):
            residual_debts[row_index][market] -= collection[market]
    for link, flow in zip(links, flows):
        residual_debts[link.account_index][link.destination_market] -= flow
        cash_entitlements[link.account_index] -= flow
    insurance_spent = tuple(max(Fraction(0), positives[market] * rates[market] - bases[market] -
                               sum(flow for link, flow in zip(links, flows)
                                   if link.destination_market == market)) for market in range(2))
    impairments = tuple(tuple(max(claim, Fraction(0)) * (1 - rate)
                              for claim, rate in zip(account.claims, rates)) for account in accounts)
    total_residual = tuple(sum(row[market] for row in residual_debts) for market in range(2))
    writeoffs = tuple(tuple(debt * (1 - insurance_spent[market] / total_residual[market])
                           if total_residual[market] else Fraction(0)
                           for market, debt in enumerate(row)) for row in residual_debts)

    require(all(amount >= 0 for amount in cash_entitlements), "negative final cash entitlement")
    require(all(0 <= spent <= available for spent, available in zip(insurance_spent, insurance)),
            "insurance budget exceeded")
    require(all(spent <= remaining for spent, remaining in zip(insurance_spent, total_residual)),
            "insurance exceeds actual residual debt")
    require(all(amount >= 0 for row in writeoffs for amount in row), "negative debtor writeoff")
    require(all(sum(row[market] for row in writeoffs) == sum(row[market] for row in impairments)
                for market in range(2)), "market debt and creditor impairment do not match")
    initial_vault = sum(account.cash for account in accounts) + sum(pools) + sum(insurance) + sum(fees)
    final_allocated = sum(cash_entitlements) + sum(insurance) - sum(insurance_spent) + sum(fees)
    require(final_allocated == initial_vault, "clearing benchmark creates or loses cash")
    return ClearingBenchmark(rates, collections, links, flows, insurance_spent,
                             tuple(cash_entitlements), impairments, writeoffs, segment_pairs)


@dataclass(frozen=True)
class AtomClearingPlan:
    benchmark: ClearingBenchmark
    cash: tuple[int, ...]
    insurance_spent: tuple[int, int]
    effective_insurance_budgets: tuple[int, int]
    claim_cash_movements: tuple[tuple[int, int], ...]
    rounding_adjustments: tuple[tuple[Fraction, Fraction], ...]
    insurance_passes: int
    augmentations: int


def _round_circulation(node_supplies, edges):
    """Round each exact flow within floor/ceil, conserving every integer node.

    Residual arcs have capacity at most one. Deterministic depth-first search prefers larger
    fractional forward arcs, then stable node/edge identities; reverse arcs allow
    earlier choices to be repaired rather than violating a market's balance.
    """
    source, sink = len(node_supplies), len(node_supplies) + 1
    adjacency = [[] for _ in range(len(node_supplies) + 2)]
    arcs = []

    def add_arc(start, end, capacity, preference):
        index = len(arcs)
        arcs.extend([[end, capacity], [start, 0]])
        adjacency[start].append((preference, end, index))
        adjacency[end].append(((2, Fraction(0)), start, index + 1))
        return index

    residual = list(node_supplies)
    originals = []
    for start, end, exact in edges:
        lower = exact.numerator // exact.denominator
        fraction = exact - lower
        capacity = int(fraction != 0)
        arc = add_arc(start, end, capacity, (1, -fraction))
        originals.append((arc, lower, capacity))
        residual[start] -= lower
        residual[end] += lower
    required = 0
    for node, balance in enumerate(residual):
        if balance > 0:
            add_arc(source, node, balance, (0, Fraction(0)))
            required += balance
        elif balance < 0:
            add_arc(node, sink, -balance, (0, Fraction(0)))
    for row in adjacency:
        row.sort()
    sent = augmentations = 0
    while sent < required:
        parents = {source: None}
        search = [(source, iter(adjacency[source]))]
        while search and sink not in parents:
            start, outgoing = search[-1]
            candidate = next(outgoing, None)
            if candidate is None:
                search.pop()
                continue
            _, end, arc = candidate
            if arcs[arc][1] > 0 and end not in parents:
                parents[end] = (start, arc)
                search.append((end, iter(adjacency[end])))
        require(sink in parents, "fractional circulation has no integral rounding")
        node, amount = sink, required - sent
        while node != source:
            previous, arc = parents[node]
            amount = min(amount, arcs[arc][1])
            node = previous
        node = sink
        while node != source:
            previous, arc = parents[node]
            arcs[arc][1] -= amount
            arcs[arc ^ 1][1] += amount
            node = previous
        sent += amount
        augmentations += 1
        require(augmentations <= len(edges), "rounding progress bound exceeded")
    rounded = tuple(lower + capacity - arcs[arc][1] for arc, lower, capacity in originals)
    balances = list(node_supplies)
    for (start, end, exact), value in zip(edges, rounded):
        require(abs(value - exact) < 1, "unattributed flow rounding exceeds one atom")
        balances[start] -= value
        balances[end] += value
    require(all(value == 0 for value in balances), "rounded flow does not conserve every node")
    return rounded, augmentations


def clear_atom_cohort(accounts, pools=(0, 0), insurance=(0, 0), fees=(0, 0)):
    """Whole-atom OUTPUT candidate; rational internals still need bounded encoding.

    Clip fractional insurance usage, then use constrained flow rounding. Never
    independently floor market flows or globally apportion unrelated markets' cash.
    This model still does not qualify any runtime financial instruction.
    """
    require(type(insurance) is tuple and len(insurance) == 2 and
            all(type(amount) is int and amount >= 0 for amount in insurance),
            "insurance must be two whole nonnegative market balances")
    budgets = list(insurance)
    clipped = set()
    for pass_index in range(3):
        benchmark = clear_rational_cohort(accounts, pools, tuple(budgets), fees,
                                          whole_cash_collection=True)
        fractional = [market for market, spent in enumerate(benchmark.insurance_spent)
                      if spent.denominator != 1]
        if not fractional:
            break
        for market in fractional:
            require(market not in clipped, "insurance clipping must make permanent progress")
            spent = benchmark.insurance_spent[market]
            budgets[market] = spent.numerator // spent.denominator
            clipped.add(market)
    else:
        raise AssertionError("two markets must reach integral insurance in three evaluations")
    spent = tuple(int(amount) for amount in benchmark.insurance_spent)
    account_count = len(accounts)
    cash_sink = account_count + 2
    supplies = [account.cash for account in accounts] + [pools[market] + spent[market] for market in range(2)]
    supplies.append(-sum(supplies))
    edges, claim_edges = [], {}
    for market in range(2):
        market_node = account_count + market
        for account_index, account in enumerate(accounts):
            claim = account.claims[market]
            if claim == 0:
                continue
            if claim > 0:
                exact = claim * benchmark.rates[market]
                start, end, sign = market_node, account_index, 1
            else:
                exact = benchmark.collections[account_index][market] + sum(
                    flow for link, flow in zip(benchmark.links, benchmark.link_payments)
                    if link.account_index == account_index and link.destination_market == market)
                start, end, sign = account_index, market_node, -1
            claim_edges[account_index, market] = (len(edges), sign)
            edges.append((start, end, exact))
    cash_edges = []
    for account_index, entitlement in enumerate(benchmark.cash_entitlements):
        cash_edges.append(len(edges))
        edges.append((account_index, cash_sink, entitlement))
    rounded, augmentations = _round_circulation(supplies, edges)
    cash = tuple(rounded[index] for index in cash_edges)
    movements = [[0, 0] for _ in accounts]
    adjustments = [[Fraction(0), Fraction(0)] for _ in accounts]
    for (account_index, market), (edge_index, sign) in claim_edges.items():
        movements[account_index][market] = sign * rounded[edge_index]
        adjustments[account_index][market] = sign * (rounded[edge_index] - edges[edge_index][2])
    require(all(account.cash + sum(row) == final for account, row, final in zip(accounts, movements, cash)),
            "account cash does not reconcile to its rounded claim movements")
    require(all(sum(row[market] for row in adjustments) == 0 for market in range(2)),
            "terminal rounding moves value between unrelated markets")
    require(all(abs(actual - ideal) < 1 for actual, ideal in zip(cash, benchmark.cash_entitlements)),
            "account entitlement error exceeds one atom")
    require(all(final >= account.cash - sum(collection) for account, collection, final
                in zip(accounts, benchmark.collections, cash)),
            "rounding seized cash retained after contractual whole-atom collection")
    initial_vault = sum(account.cash for account in accounts) + sum(pools) + sum(insurance) + sum(fees)
    require(sum(cash) + sum(insurance) - sum(spent) + sum(fees) == initial_vault,
            "whole-atom plan does not reconcile actual custody")
    return AtomClearingPlan(benchmark, cash, spent, tuple(budgets), tuple(map(tuple, movements)),
                            tuple(map(tuple, adjustments)), pass_index + 1, augmentations)
