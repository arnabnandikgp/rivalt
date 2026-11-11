"""Executable P51B feasibility candidate, NOT a runtime settlement implementation.

Dynamic exact arithmetic and a linear merge of two piecewise-affine response
curves replace the old fixed-width/product-of-branches model. No payout precision,
priority or trust change is proposed. Input rows are already frozen and valued;
this module does not authenticate chain state or model position admission.
"""

from dataclasses import dataclass, field
from fractions import Fraction
from functools import cmp_to_key
from math import gcd, lcm

SCALE = 10**9
MAX_CASH = 10**15
MAX_CLAIM = 100_300_000_000_000_000_000_000_000


@dataclass
class Work:
    curve_segments: int = 0
    composed_intervals: int = 0
    collection_divisions: int = 0
    denominator_limb_visits: int = 0
    collection_limb_visits: int = 0
    common_bits: int = 0
    rate_bits: int = 0
    flow_bits: int = 0
    augmentations: int = 0
    arc_visits: int = 0
    original_edges: int = 0
    residual_arcs: int = 0
    flow_recomputations: int = 0
    remainder_comparisons: int = 0
    active_successor_queries: int = 0


@dataclass(frozen=True)
class Segment:
    lower: Fraction
    upper: Fraction
    intercept: Fraction
    slope: Fraction


@dataclass
class Plan:
    common: int
    rates: tuple[Fraction, Fraction]
    factor: int
    rate_numerators: tuple[int, int]
    denominator: int
    flows: tuple[tuple[int, int], ...] | None
    cash_numerators: tuple[int, ...] | None
    insurance_spent: tuple[int, int]
    budgets: tuple[int, int]
    evaluations: int
    work: Work = field(repr=False)


def validate(rows, pools, insurance, fees=(0, 0)):
    if not rows:
        raise ValueError("empty cohort")
    for cash, claims in rows:
        if type(cash) is not int or not 0 <= cash <= MAX_CASH or len(claims) != 2:
            raise ValueError("row cash/shape")
        if any(type(claim) is not int or abs(claim) > MAX_CLAIM for claim in claims):
            raise ValueError("row claim bound")
    if any(len(values) != 2 for values in (pools, insurance, fees)) or any(
        type(value) is not int or not 0 <= value <= MAX_CASH for value in (*pools, *insurance, *fees)
    ):
        raise ValueError("market pool bound")
    if sum(cash for cash, _ in rows) + sum(pools) + sum(insurance) + sum(fees) > MAX_CASH:
        raise ValueError("allocated custody bound")
    if any(sum(claims[market] for _, claims in rows) != pools[market] * SCALE for market in range(2)):
        raise ValueError("complete market claim identity")


def response_curve(positive, base, budget, links):
    """Build F_m(r_other) in O(N log N), with exact prefix coefficients.

    Links are (positive face, residual debt), in scaled collateral units.
    Multiple equal thresholds are one boundary. Constant/capped intervals are
    retained so a closed cashless cycle's continuum includes its greatest end.
    """
    if not positive:
        yield Segment(Fraction(0), Fraction(1), Fraction(1), Fraction(0))
        return
    events = {}
    intercept = base + budget * SCALE
    slope = sum(face for face, _ in links)
    for face, debt in links:
        threshold = Fraction(debt, face)
        if threshold < 1:
            fixed, variable = events.get(threshold, (0, 0))
            events[threshold] = fixed + debt, variable + face
    lower = Fraction(0)
    for upper in sorted({*events, Fraction(1)}):
        offset, gradient = intercept / positive, Fraction(slope, positive)
        if offset + gradient * lower >= 1:
            yield Segment(lower, Fraction(1), Fraction(1), Fraction(0))
            break
        if offset + gradient * upper > 1:
            crossing = (1 - offset) / gradient
            yield Segment(lower, crossing, offset, gradient)
            yield Segment(crossing, Fraction(1), Fraction(1), Fraction(0))
            break
        yield Segment(lower, upper, offset, gradient)
        fixed, variable = events.get(upper, (0, 0))
        intercept += fixed
        slope -= variable
        lower = upper


def greatest_rates(positives, bases, budgets, links, work):
    """Merge F0(F1(x)) branches instead of enumerating their Cartesian product.

    Both responses are continuous and nondecreasing. As x advances through F1,
    its output can cross each F0 boundary at most once. Solve H(x)=x on each
    intersecting interval; the largest x gives the greatest pair (x,F1(x)).
    An identity interval contributes its upper end, never an iterative epsilon.
    """
    def counted_curve(market):
        for segment in response_curve(positives[market], bases[market], budgets[market], links[market]):
            work.curve_segments += 1
            yield segment

    # Stream wide intercepts. Keeping all segments would reintroduce O(N*B)
    # memory on cohorts combining large proportional denominators and links.
    outer, inner = counted_curve(0), counted_curve(1)
    first = next(outer)
    best = None
    for second in inner:
        lower = second.lower
        while True:
            mapped = second.intercept + second.slope * lower
            while mapped >= first.upper and first.upper < 1:
                first = next(outer)
            upper = second.upper
            if second.slope:
                upper = min(upper, (first.upper - second.intercept) / second.slope)
            offset = first.intercept + first.slope * second.intercept
            gradient = first.slope * second.slope
            work.composed_intervals += 1
            if gradient == 1:
                candidate = upper if offset == 0 else None
            else:
                candidate = offset / (1 - gradient)
            if candidate is not None and lower <= candidate <= upper:
                pair = candidate, second.intercept + second.slope * candidate
                if best is None or candidate > best[0]:
                    best = pair
            if upper == second.upper:
                break
            if upper <= lower:
                raise AssertionError("composition made no progress")
            lower = upper
    if best is None:
        raise AssertionError("no greatest fixed point")
    return best


def common_denominator(rows, strategy, work):
    """Compare inherited product with exact reduced per-row LCM.

    Reduction needs only big-integer modulo/division by <=88-bit row divisors
    plus bounded small gcd. This Python model counts limb visits, not SBF CU.
    It does NOT imply the worst-case LCM is small.
    """
    if strategy not in ("product", "reduced-lcm"):
        raise ValueError("denominator strategy")
    common = 1
    for cash, claims in rows:
        debts = tuple(max(-claim, 0) for claim in claims)
        total = sum(debts)
        collected = min(cash, total // SCALE)
        if not all(debts) or not collected:
            continue
        if strategy == "product":
            work.denominator_limb_visits += (common.bit_length() + 63) // 64
            common *= total
        else:
            divisor = total // gcd(total, collected * SCALE * debts[0])
            # The other collection has the same reduced denominator because
            # their sum is the integer collected*S.
            work.denominator_limb_visits += 3 * ((common.bit_length() + 63) // 64)
            common = (common // gcd(common, divisor)) * divisor
    work.common_bits = common.bit_length()
    return common


def collection_row(cash, claims, common, work):
    debts = tuple(max(-claim, 0) for claim in claims)
    total = sum(debts)
    collected = min(cash, total // SCALE)
    if all(debts) and collected:
        numerator = collected * SCALE * debts[0]
        reduction = gcd(total, numerator)
        divisor = total // reduction
        work.collection_divisions += 1
        work.collection_limb_visits += (common.bit_length() + 63) // 64
        first = (common // divisor) * (numerator // reduction)
        return first, collected * SCALE * common - first
    return tuple(collected * SCALE * common if debt else 0 for debt in debts)


def exact_flows(row, common, factor, numerators, work):
    cash, claims = row
    collection = collection_row(cash, claims, common, work)
    collected = min(cash, sum(max(-claim, 0) for claim in claims) // SCALE)
    flows = []
    for market, claim in enumerate(claims):
        flow = claim * numerators[market] if claim > 0 else -collection[market] * factor
        if claim < 0 and claims[1 - market] > 0:
            flow -= min((-claim - collected * SCALE) * common * factor,
                        claims[1 - market] * numerators[1 - market])
        flows.append(flow)
        work.flow_bits = max(work.flow_bits, abs(flow).bit_length())
    return tuple(flows)


def solve(rows, pools=(0, 0), insurance=(0, 0), *, strategy="reduced-lcm", compact=False, fees=(0, 0), proposal_sink=None):
    validate(rows, pools, insurance, fees)
    work = Work()
    common = common_denominator(rows, strategy, work)
    collection_totals, links = [0, 0], [[], []]
    for cash, claims in rows:
        debts = tuple(max(-claim, 0) for claim in claims)
        total = sum(debts)
        collected = min(cash, total // SCALE)
        collection = collection_row(cash, claims, common, work)
        for market in range(2):
            collection_totals[market] += collection[market]
        for market in range(2):
            if claims[1 - market] > 0 and debts[market] > collected * SCALE:
                links[market].append((claims[1 - market], debts[market] - collected * SCALE))
    positives = tuple(sum(max(claims[market], 0) for _, claims in rows) for market in range(2))
    bases = tuple(Fraction(pools[market] * SCALE * common + collection_totals[market], common)
                  for market in range(2))
    budgets, clipped = list(insurance), set()
    for evaluation in range(1, 4):
        rates = greatest_rates(positives, bases, budgets, links, work)
        rate_lcm = lcm(*(rate.denominator for rate in rates))
        factor = rate_lcm // gcd(common, rate_lcm)
        rate_denominator = common * factor
        numerators = tuple(int(rate * rate_denominator) for rate in rates)
        # Optional untrusted proposal transport for the separately compiled
        # P54A verifier. Capturing a proposal cannot make it pass that verifier.
        if proposal_sink is not None:
            proposal_sink(factor, numerators)
        denominator = SCALE * rate_denominator
        work.rate_bits = max(work.rate_bits, rate_denominator.bit_length())
        flows = None if compact else []
        totals = [0, 0]
        for row in rows:
            flow = exact_flows(row, common, factor, numerators, work)
            for market in range(2):
                totals[market] += flow[market]
            if flows is not None:
                flows.append(flow)
            if row[0] * denominator + sum(flow) < 0:
                raise AssertionError("negative entitlement")
        spent = tuple(totals[market] - pools[market] * denominator for market in range(2))
        if any(not 0 <= value <= budgets[market] * denominator for market, value in enumerate(spent)):
            raise AssertionError("invalid insurance consumption")
        fractional = [market for market in range(2) if spent[market] % denominator]
        if not fractional:
            cash_numerators = None if compact else tuple(cash * denominator + sum(flow) for (cash, _), flow in zip(rows, flows))
            return Plan(common, rates, factor, numerators, denominator, None if compact else tuple(flows), cash_numerators,
                        tuple(value // denominator for value in spent), tuple(budgets), evaluation, work)
        for market in fractional:
            if market in clipped:
                raise AssertionError("insurance clipping did not progress")
            budgets[market] = spent[market] // denominator
            clipped.add(market)
    raise AssertionError("insurance clipping exceeded two markets")


def round_plan(rows, pools, plan, *, max_arc_visits=None, compact=False):
    """Dynamic integer residual graph with the existing canonical DFS ordering.

    Compact mode recomputes remainders for ordering instead of storing N wide
    numerators, and skips zero-capacity arcs through active bit sets. Removing
    unavailable arcs preserves the exact canonical DFS choices and atom owners.
    Python integers implement these bit sets here; a paged bounded hierarchy is
    still required in the on-chain implementation. Native timing is not CU.
    """
    count = len(rows)
    cash_sink, source, sink = count + 2, count + 3, count + 4
    supplies = [cash for cash, _ in rows] + [pools[market] + plan.insurance_spent[market] for market in range(2)]
    supplies += [-sum(supplies)]
    edges, claim_edges = [], {}

    def numerator(row_index, market):
        if plan.flows is not None:
            return abs(plan.flows[row_index][market]) if market < 2 else plan.cash_numerators[row_index]
        plan.work.flow_recomputations += 1
        flows = exact_flows(rows[row_index], plan.common, plan.factor, plan.rate_numerators, plan.work)
        return abs(flows[market]) if market < 2 else rows[row_index][0] * plan.denominator + sum(flows)

    for market in range(2):
        for index, (_, claims) in enumerate(rows):
            if claims[market]:
                positive = claims[market] > 0
                claim_edges[index, market] = len(edges), 1 if positive else -1
                edges.append((count + market if positive else index,
                              index if positive else count + market, index, market))
    cash_edges = []
    for index in range(count):
        cash_edges.append(len(edges))
        edges.append((index, cash_sink, index, 2))
    adjacency, arcs = [[] for _ in range(count + 5)], []

    def add_arc(start, end, capacity, preference):
        identifier = len(arcs)
        arcs.extend([[end, capacity], [start, 0]])
        adjacency[start].append((preference, end, identifier))
        adjacency[end].append(((2, 0), start, identifier + 1))
        return identifier

    residual, originals = list(supplies), []
    for edge_index, (start, end, row_index, market) in enumerate(edges):
        lower, remainder = divmod(numerator(row_index, market), plan.denominator)
        capacity = int(remainder != 0)
        identifier = add_arc(start, end, capacity, (1, edge_index if compact else -remainder))
        originals.append((identifier, lower, capacity))
        residual[start] -= lower
        residual[end] += lower
    required = 0
    for index, amount in enumerate(residual):
        if amount > 0:
            add_arc(source, index, amount, (0, 0))
            required += amount
        elif amount < 0:
            add_arc(index, sink, -amount, (0, 0))
    def compare(first, second):
        if first[0][0] != second[0][0]:
            return (first[0][0] > second[0][0]) - (first[0][0] < second[0][0])
        if first[0][0] == 1:
            plan.work.remainder_comparisons += 1
            left, right = edges[first[0][1]], edges[second[0][1]]
            left_value = numerator(left[2], left[3]) % plan.denominator
            right_value = numerator(right[2], right[3]) % plan.denominator
            if left_value != right_value:
                return (right_value > left_value) - (right_value < left_value)
        return (first[1:] > second[1:]) - (first[1:] < second[1:])

    for outgoing in adjacency:
        outgoing.sort(key=cmp_to_key(compare) if compact else None)
    positions, active = {}, [0] * len(adjacency)
    if compact:
        for node, outgoing in enumerate(adjacency):
            for index, (_, _, identifier) in enumerate(outgoing):
                positions[identifier] = node, index
                if arcs[identifier][1]:
                    active[node] |= 1 << index

    def outgoing_arcs(node):
        if not compact:
            yield from adjacency[node]
            return
        cursor = 0
        while True:
            plan.work.active_successor_queries += 1
            remaining = active[node] >> cursor
            if not remaining:
                return
            cursor += (remaining & -remaining).bit_length() - 1
            yield adjacency[node][cursor]
            cursor += 1

    def update_capacity(identifier, amount):
        arcs[identifier][1] += amount
        if compact:
            node, index = positions[identifier]
            if arcs[identifier][1]:
                active[node] |= 1 << index
            else:
                active[node] &= ~(1 << index)
    plan.work.original_edges = len(edges)
    plan.work.residual_arcs = len(arcs)
    sent = 0
    while sent < required:
        parents = {source: None}
        frontier = [(source, outgoing_arcs(source))]
        while frontier and sink not in parents:
            start, outgoing = frontier[-1]
            candidate = next(outgoing, None)
            if candidate is None:
                frontier.pop()
                continue
            plan.work.arc_visits += 1
            if max_arc_visits is not None and plan.work.arc_visits > max_arc_visits:
                raise RuntimeError("diagnostic arc budget exhausted; no payout plan")
            _, end, identifier = candidate
            if arcs[identifier][1] and end not in parents:
                parents[end] = start, identifier
                frontier.append((end, outgoing_arcs(end)))
        if sink not in parents:
            raise AssertionError("infeasible conserving rounding")
        node, amount = sink, required - sent
        while node != source:
            previous, identifier = parents[node]
            amount = min(amount, arcs[identifier][1])
            node = previous
        node = sink
        while node != source:
            previous, identifier = parents[node]
            update_capacity(identifier, -amount)
            update_capacity(identifier ^ 1, amount)
            node = previous
        sent += amount
        plan.work.augmentations += 1
        if plan.work.augmentations > len(edges):
            raise AssertionError("rounding did not progress")
    rounded = tuple(lower + capacity - arcs[identifier][1] for identifier, lower, capacity in originals)
    movements = [[0, 0] for _ in rows]
    for (index, market), (edge, sign) in claim_edges.items():
        movements[index][market] = sign * rounded[edge]
    cash = tuple(rounded[index] for index in cash_edges)
    if any(final != initial + sum(movement) for final, (initial, _), movement in zip(cash, rows, movements)):
        raise AssertionError("account conservation")
    if any(sum(movement[market] for movement in movements) != pools[market] + plan.insurance_spent[market]
           for market in range(2)):
        raise AssertionError("market conservation")
    if any(abs(actual * plan.denominator - numerator(index, 2)) >= plan.denominator
           for index, actual in enumerate(cash)):
        raise AssertionError("cash rounding exceeds one atom")
    if any(final < initial - min(initial, sum(max(-claim, 0) for claim in claims) // SCALE)
           for final, (initial, claims) in zip(cash, rows)):
        raise AssertionError("rounding seized retained own cash")
    if any(abs(value * plan.denominator - numerator(edge[2], edge[3])) >= plan.denominator
           for value, edge in zip(rounded, edges)):
        raise AssertionError("claim flow rounding exceeds one atom")
    return cash, tuple(map(tuple, movements))
