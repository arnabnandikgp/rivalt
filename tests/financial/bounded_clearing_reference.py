"""P22B integer schedule for D59; no Fraction or implementation imports.

Scaled input is i128-compatible. All wide work is checked against 96 little-endian
u64 limbs. This is a contract reference; SBF implementation/cost is P26 evidence.
"""
from dataclasses import dataclass
from functools import cmp_to_key
from itertools import product

SCALE = 10**9
MAX_CASH = 10**15
MAX_CLAIM = 10**26 + 3 * 10**23
BITS = 6144


@dataclass
class Checked:
    maximum_bits: int = 0

    def value(self, value):
        size = abs(value).bit_length()
        if size > BITS:
            raise OverflowError("6144-bit clearing work bound")
        self.maximum_bits = max(self.maximum_bits, size)
        return value

    def mul(self, first, second):
        return self.value(first * second)

    def add(self, *values):
        return self.value(sum(values))


@dataclass(frozen=True)
class IntegerPlan:
    common: int
    rate_numerators: tuple[int, int]
    rate_factor: int
    flow_denominator: int
    signed_flows: tuple[tuple[int, int], ...]
    cash_numerators: tuple[int, ...]
    insurance_spent: tuple[int, int]
    effective_budgets: tuple[int, int]
    evaluations: int
    candidate_count: int
    maximum_bits: int


def prepare_scaled(rows, pools=(0, 0), insurance=(0, 0)):
    """Whole collection, exact greatest rates and integral reserve consumption.

    Rows are stable registry order: (whole_cash, (BTC_scaled, ETH_scaled)).
    All output money shares flow_denominator; ordinary state stays scale=10**9.
    """
    if not 1 <= len(rows) <= 64:
        raise ValueError("complete bounded cohort")
    for cash, claims in rows:
        if type(cash) is not int or not 0 <= cash <= MAX_CASH or len(claims) != 2:
            raise ValueError("cash/position bound")
        if any(type(claim) is not int or abs(claim) > MAX_CLAIM for claim in claims):
            raise ValueError("scaled claim bound")
    if len(pools) != 2 or len(insurance) != 2 or any(
            type(value) is not int or not 0 <= value <= MAX_CASH for value in (*pools, *insurance)):
        raise ValueError("pool bound")
    if sum(cash for cash, _ in rows) + sum(pools) + sum(insurance) > MAX_CASH:
        raise ValueError("allocated custody bound")
    if any(sum(claims[market] for _, claims in rows) != pools[market] * SCALE for market in range(2)):
        raise ValueError("complete market claim invariant")
    checked = Checked()
    debts = [tuple(max(-claim, 0) for claim in claims) for _, claims in rows]
    collected = [min(cash, sum(debt) // SCALE) for (cash, _), debt in zip(rows, debts)]
    # Single-negative rows introduce no proportional denominator. This is also
    # why all cross links have a plain scaled integer cap after own collection.
    common = 1
    for debt, amount in zip(debts, collected):
        if all(debt) and amount:
            common = checked.mul(common, sum(debt))
    collection_numerators = []
    links = [[], []]  # incoming to each market, (row, positive_scaled, debt_scaled)
    for index, ((_, claims), debt, amount) in enumerate(zip(rows, debts, collected)):
        total = sum(debt)
        if all(debt) and amount:
            collection = tuple(checked.mul(amount * SCALE * owed, common // total) for owed in debt)
        else:
            collection = tuple(checked.mul(amount * SCALE if owed else 0, common) for owed in debt)
        collection_numerators.append(collection)
        for destination in range(2):
            source = 1 - destination
            if claims[source] > 0 and debt[destination] > amount * SCALE:
                links[destination].append((index, claims[source], debt[destination] - amount * SCALE))
    for incoming in links:
        incoming.sort(key=cmp_to_key(lambda first, second:
                      (first[2] * second[1] > second[2] * first[1]) -
                      (first[2] * second[1] < second[2] * first[1]) or first[0] - second[0]))
    positives = tuple(sum(max(claims[market], 0) for _, claims in rows) for market in range(2))
    bases = tuple(checked.add(checked.mul(pools[market] * SCALE, common),
                             *(collection[market] for collection in collection_numerators)) for market in range(2))
    return checked, common, collection_numerators, links, positives, bases


def solve_scaled(rows, pools=(0, 0), insurance=(0, 0)):
    checked, common, collection_numerators, links, positives, bases = prepare_scaled(rows, pools, insurance)
    budgets = list(insurance)
    clipped = set()
    total_candidates = 0
    for evaluation in range(1, 4):
        best = None
        candidates = []

        def consider(numerators, factor):
            nonlocal best, total_candidates
            total_candidates += 1
            denominator = checked.mul(common, factor)
            if denominator <= 0 or any(value < 0 or value > denominator for value in numerators):
                return
            for market in range(2):
                incoming = checked.add(*(min(checked.mul(debt, denominator),
                                                checked.mul(claim, numerators[1 - market]))
                                         for _, claim, debt in links[market]))
                capacity = checked.add(checked.mul(bases[market], factor),
                                       checked.mul(budgets[market] * SCALE, denominator), incoming)
                if positives[market] == 0:
                    if numerators[market] != denominator:
                        return
                elif checked.mul(positives[market], numerators[market]) != min(
                        checked.mul(positives[market], denominator), capacity):
                    return
            candidates.append((numerators, factor))
            if best is None or checked.mul(sum(numerators), best[1]) > checked.mul(sum(best[0]), factor):
                best = (numerators, factor)

        branches = []
        for market in range(2):
            market_branches = []
            for saturated in range(len(links[market]) + 1):
                fixed = sum(link[2] for link in links[market][:saturated])
                slope = sum(link[1] for link in links[market][saturated:])
                intercept = checked.add(bases[market], checked.mul((budgets[market] * SCALE + fixed), common))
                market_branches.append((positives[market], slope, intercept))
            # A capped market has r=1. It needs no interval enumeration: the
            # original min equations below authenticate its admissibility.
            market_branches.append((1, 0, common))
            branches.append(market_branches)
        for first, second in product(*branches):
            weight0, slope0, intercept0 = first
            weight1, slope1, intercept1 = second
            determinant = weight0 * weight1 - slope0 * slope1
            if determinant > 0:
                numerators = (checked.add(checked.mul(intercept0, weight1), checked.mul(slope0, intercept1)),
                              checked.add(checked.mul(intercept1, weight0), checked.mul(slope1, intercept0)))
                consider(numerators, determinant)
            elif determinant == 0 and intercept0 == intercept1 == 0 and weight0 and weight1:
                # The largest point on a singular branch is at a cap/threshold.
                # Test all such endpoints, with the ORIGINAL equations. Every
                # endpoint has a small denominator, represented as common*factor.
                endpoints = [(0, 1, 1), (1, 1, 1)]
                endpoints += [(1 - market, debt, claim) for market in range(2) for _, claim, debt in links[market]]
                for market, numerator, denominator in endpoints:
                    if market == 0:
                        pair = (checked.mul(common, numerator * weight1), checked.mul(common, numerator * slope1))
                        consider(pair, denominator * weight1)
                    else:
                        pair = (checked.mul(common, numerator * slope0), checked.mul(common, numerator * weight0))
                        consider(pair, denominator * weight0)
        if best is None:
            raise AssertionError("no exact clearing candidate")
        numerators, factor = best
        if any(any(checked.mul(chosen, other_factor) < checked.mul(other, factor)
                   for chosen, other in zip(numerators, alternative)) for alternative, other_factor in candidates):
            raise AssertionError("candidate is not the greatest fixed point")
        denominator = checked.mul(common, factor)
        cash_denominator = checked.mul(SCALE, denominator)
        signed = [[0, 0] for _ in rows]
        for index, (_, claims) in enumerate(rows):
            for market in range(2):
                signed[index][market] = (checked.mul(claims[market], numerators[market]) if claims[market] > 0
                                         else -checked.mul(collection_numerators[index][market], factor))
        for destination in range(2):
            for index, claim, debt in links[destination]:
                recovered = min(checked.mul(debt, denominator), checked.mul(claim, numerators[1 - destination]))
                signed[index][destination] = checked.add(signed[index][destination], -recovered)
        spent_numerators = tuple(checked.add(*(row[market] for row in signed),
                                            -checked.mul(pools[market], cash_denominator)) for market in range(2))
        if any(value < 0 or value > checked.mul(budgets[market], cash_denominator)
               for market, value in enumerate(spent_numerators)):
            raise AssertionError("insurance capacity mismatch")
        fractional = [market for market in range(2) if spent_numerators[market] % cash_denominator]
        if not fractional:
            cash_numerators = tuple(checked.add(checked.mul(cash, cash_denominator), *row)
                                    for (cash, _), row in zip(rows, signed))
            return IntegerPlan(common, numerators, factor, cash_denominator, tuple(map(tuple, signed)),
                               cash_numerators, tuple(value // cash_denominator for value in spent_numerators),
                               tuple(budgets), evaluation, total_candidates, checked.maximum_bits)
        for market in fractional:
            if market in clipped:
                raise AssertionError("insurance clipping lacks permanent progress")
            budgets[market] = spent_numerators[market] // cash_denominator
            clipped.add(market)
    raise AssertionError("three insurance evaluations exhausted")

@dataclass(frozen=True)
class IntegerAtoms:
    plan: IntegerPlan
    cash: tuple[int, ...]
    signed_movements: tuple[tuple[int, int], ...]
    adjustment_numerators: tuple[tuple[int, int], ...]
    augmentations: int


def finalize_scaled(rows, pools=(0, 0), insurance=(0, 0)):
    """Integer-only deterministic circulation. All remainders share one divisor."""
    plan = solve_scaled(rows, pools, insurance)
    count = len(rows)
    cash_sink, source, sink = count + 2, count + 3, count + 4
    supplies = [cash for cash, _ in rows] + [pools[market] + plan.insurance_spent[market] for market in range(2)]
    supplies.append(-sum(supplies))
    edges, claim_indices = [], {}
    for market in range(2):
        for index, (_, claims) in enumerate(rows):
            if claims[market]:
                positive = claims[market] > 0
                claim_indices[index, market] = len(edges), 1 if positive else -1
                edges.append((count + market if positive else index,
                              index if positive else count + market, abs(plan.signed_flows[index][market])))
    cash_indices = []
    for index, numerator in enumerate(plan.cash_numerators):
        cash_indices.append(len(edges))
        edges.append((index, cash_sink, numerator))
    adjacency, arcs = [[] for _ in range(count + 5)], []

    def arc(start, end, capacity, preference):
        identifier = len(arcs)
        arcs.extend([[end, capacity], [start, 0]])
        adjacency[start].append((preference, end, identifier))
        adjacency[end].append(((2, 0), start, identifier + 1))
        return identifier

    residual, originals = list(supplies), []
    for start, end, numerator in edges:
        lower, remainder = divmod(numerator, plan.flow_denominator)
        capacity = int(remainder != 0)
        identifier = arc(start, end, capacity, (1, -remainder))
        originals.append((identifier, lower, capacity))
        residual[start] -= lower
        residual[end] += lower
    required = 0
    for index, amount in enumerate(residual):
        if amount > 0:
            arc(source, index, amount, (0, 0))
            required += amount
        elif amount < 0:
            arc(index, sink, -amount, (0, 0))
    for outgoing in adjacency:
        outgoing.sort()
    augmentations = sent = 0
    while sent < required:
        parents = {source: None}
        frontier = [(source, iter(adjacency[source]))]
        while frontier and sink not in parents:
            start, outgoing = frontier[-1]
            candidate = next(outgoing, None)
            if candidate is None:
                frontier.pop()
                continue
            _, end, identifier = candidate
            if arcs[identifier][1] and end not in parents:
                parents[end] = (start, identifier)
                frontier.append((end, iter(adjacency[end])))
        if sink not in parents:
            raise AssertionError("integer circulation is infeasible")
        node, amount = sink, required - sent
        while node != source:
            previous, identifier = parents[node]
            amount = min(amount, arcs[identifier][1])
            node = previous
        node = sink
        while node != source:
            previous, identifier = parents[node]
            arcs[identifier][1] -= amount
            arcs[identifier ^ 1][1] += amount
            node = previous
        sent += amount
        augmentations += 1
        if augmentations > 192:
            raise AssertionError("circulation progress limit")
    rounded = tuple(lower + capacity - arcs[identifier][1] for identifier, lower, capacity in originals)
    movements, adjustments = [[0, 0] for _ in rows], [[0, 0] for _ in rows]
    checked = Checked()
    for (index, market), (edge, sign) in claim_indices.items():
        movements[index][market] = sign * rounded[edge]
        adjustments[index][market] = checked.add(checked.mul(movements[index][market], plan.flow_denominator),
                                                -plan.signed_flows[index][market])
    cash = tuple(rounded[index] for index in cash_indices)
    if any(cash[index] != initial + sum(movements[index]) for index, (initial, _) in enumerate(rows)):
        raise AssertionError("account cash conservation")
    if any(sum(row[market] for row in adjustments) for market in range(2)):
        raise AssertionError("market rounding conservation")
    if any(abs(actual * plan.flow_denominator - expected) >= plan.flow_denominator
           for actual, expected in zip(cash, plan.cash_numerators)):
        raise AssertionError("cash entitlement rounding")
    if sum(cash) != sum(initial for initial, _ in rows) + sum(pools) + sum(plan.insurance_spent):
        raise AssertionError("actual cash conservation")
    return IntegerAtoms(plan, cash, tuple(map(tuple, movements)), tuple(map(tuple, adjustments)), augmentations)


def verify_rate_certificate(rows, pools, budgets, numerators, factor):
    """O(N) greatest-fixed-point verification, independent of branch search.

    A complete canonical frozen cohort is mandatory in the later runtime. Passing
    a caller-selected subset to this mathematical reference is not authentication.
    """
    checked, common, _, links, positives, bases = prepare_scaled(rows, pools, budgets)
    if type(factor) is not int or not 0 < factor < 2**186 or len(numerators) != 2:
        return False
    denominator = checked.mul(common, factor)
    if any(type(value) is not int or not 0 <= value <= denominator for value in numerators):
        return False
    slopes = []
    for market in range(2):
        incoming = checked.add(*(min(checked.mul(debt, denominator),
                                      checked.mul(claim, numerators[1 - market]))
                                 for _, claim, debt in links[market]))
        capacity = checked.add(checked.mul(bases[market], factor),
                               checked.mul(budgets[market] * SCALE, denominator), incoming)
        if positives[market] == 0:
            if numerators[market] != denominator:
                return False
        elif checked.mul(positives[market], numerators[market]) != min(
                checked.mul(positives[market], denominator), capacity):
            return False
        # A link EXACTLY at cap is no longer in the right-hand derivative.
        slopes.append(sum(claim for _, claim, debt in links[market]
                          if checked.mul(claim, numerators[1 - market]) < checked.mul(debt, denominator)))
    if denominator in numerators:
        return True
    # Each incoming slope is <= the other market's complete positive population.
    # A strictly contracting right derivative rules out any greater fixed point.
    return slopes[0] * slopes[1] < positives[0] * positives[1]
