"""Independent three-market oracle. Enumerate debtor/market saturation regimes
and solve simultaneous cash balances with Python Fraction and Gaussian elimination.
Inputs and outputs are canonically ordered here; the caller permutes the Rust input.
"""
from fractions import Fraction as F
from itertools import combinations, product

from clearing_network_reference import _round_circulation, recovered_debt_shares

MARKETS = range(3)
ONE = (F(1),) * 3


def dot(a, b):
    return sum((x * y for x, y in zip(a, b)), F(0))


def point(equations):
    """Unique intersection; a singular regime is handled by its boundary vertices."""
    matrix = [list(map(F, row)) for row in equations]
    for column in MARKETS:
        pivot = next((i for i in range(column, 3) if matrix[i][column]), None)
        if pivot is None:
            return None
        matrix[column], matrix[pivot] = matrix[pivot], matrix[column]
        matrix[column] = [x / matrix[column][column] for x in matrix[column]]
        for i in MARKETS:
            if i != column:
                factor = matrix[i][column]
                matrix[i] = [x - factor * y for x, y in zip(matrix[i], matrix[column])]
    return tuple(row[-1] for row in matrix)


def rates_for(claims, debts, bases, face, insurance):
    links = [(win, owed) for win, owed in zip(claims, debts) if any(win) and any(owed)]
    if not links:
        return tuple(min(F(1), (base + reserve) / weight) if weight else F(1)
                     for base, reserve, weight in zip(bases, insurance, face))

    def evaluate(rates):
        incoming = [recovered_debt_shares(dot(win, rates), owed) for win, owed in links]
        return tuple(min(F(1), (bases[m] + insurance[m] + sum(row[m] for row in incoming)) / face[m])
                     if face[m] else F(1) for m in MARKETS)

    if evaluate(ONE) == ONE:
        return ONE
    solutions = set()
    units = [tuple(F(i == m) for i in MARKETS) for m in MARKETS]
    boundaries = [(*unit, n) for unit in units for n in (0, 1)]
    boundaries += [(*win, sum(owed)) for win, owed in links]
    for saturated in product((False, True), repeat=len(links)):
        equations = []
        for m in MARKETS:
            coeff = [units[m][i] * face[m] for i in MARKETS]
            rhs = bases[m] + insurance[m]
            for (win, owed), covered in zip(links, saturated):
                if covered:
                    rhs += owed[m]
                else:
                    share = owed[m] / sum(owed)
                    coeff = [value - share * claim for value, claim in zip(coeff, win)]
            equations.append((*coeff, rhs))
        for full in product((False, True), repeat=3):
            active = [(*units[m], 1) if full[m] or not face[m] else equations[m] for m in MARKETS]
            unique = point(active)
            if unique is None:
                # A greatest point on a nontrivial fixed face has an active
                # market cap, debtor threshold or rate bound at the endpoint.
                candidates = (point(e) for e in combinations(set(active + boundaries + equations), 3))
            else:
                candidates = (unique,)
            for value in candidates:
                if value is not None and all(0 <= v <= 1 for v in value) and value == evaluate(value):
                    solutions.add(value)
    assert solutions
    greatest = tuple(max(s[m] for s in solutions) for m in MARKETS)
    assert greatest in solutions
    return greatest


def expected(book):
    market_ids = [item["id"] for item in book["markets"]]
    assert market_ids == sorted(market_ids)
    rows = sorted(book["rows"], key=lambda row: int(row["id"]))
    cash = [int(row["cash"]) for row in rows]
    net = [tuple(F(int(value), 10**9) for value in row["claims"]) for row in rows]
    pools, reserves, fees = (
        [int(market[key]) for market in book["markets"]] for key in ("pool", "insurance", "fees")
    )
    gains = [tuple(max(x, 0) for x in row) for row in net]
    debts = [tuple(max(-x, 0) for x in row) for row in net]
    own = [
        recovered_debt_shares(min(balance, int(sum(owed))), owed)
        for balance, owed in zip(cash, debts)
    ]
    debts = [tuple(x - y for x, y in zip(owed, paid)) for owed, paid in zip(debts, own)]
    bases = [F(pools[m]) + sum(row[m] for row in own) for m in MARKETS]
    face = [sum(row[m] for row in gains) for m in MARKETS]

    budgets = list(reserves)
    for _ in range(4):
        rates = rates_for(gains, debts, bases, face, budgets)
        recovered = [tuple(claim * rate for claim, rate in zip(row, rates)) for row in gains]
        forwarded = [recovered_debt_shares(sum(src), owed) for src, owed in zip(recovered, debts)]
        spent = [face[m] * rates[m] - bases[m] - sum(row[m] for row in forwarded) for m in MARKETS]
        assert all(0 <= use <= budget for use, budget in zip(spent, budgets))
        if all(use.denominator == 1 for use in spent):
            break
        budgets = [
            budget if use.denominator == 1 else int(use) for budget, use in zip(budgets, spent)
        ]
    else:
        raise AssertionError("reserve clipping did not stabilize")

    spent = [int(use) for use in spent]
    remaining = [tuple(x - y for x, y in zip(owed, paid)) for owed, paid in zip(debts, forwarded)]
    total_owed = [sum(row[m] for row in remaining) for m in MARKETS]
    supply = cash + [pool + use for pool, use in zip(pools, spent)]
    supply.append(-sum(supply))
    count = len(cash)
    edges, claim_edges = [], {}
    for market in MARKETS:
        for member in range(count):
            if net[member][market] == 0:
                continue
            claim_edges[member, market] = len(edges)
            market_node = count + market
            if net[member][market] > 0:
                edges.append((market_node, member, recovered[member][market]))
            else:
                edges.append((member, market_node, own[member][market] + forwarded[member][market]))

    entitlement = [
        balance - sum(collection) + sum(win) - sum(pay)
        for balance, collection, win, pay in zip(cash, own, recovered, forwarded)
    ]
    edges.extend((member, count + 3, amount) for member, amount in enumerate(entitlement))
    rounded, _ = _round_circulation(supply, edges, {})
    result = []
    for member, row in enumerate(rows):
        loss = [claim - win for claim, win in zip(gains[member], recovered[member])]
        writeoff = [
            debt * (1 - spent[m] / total_owed[m]) if total_owed[m] else F(0)
            for m, debt in enumerate(remaining[member])
        ]
        movements = [0, 0, 0]
        for market in MARKETS:
            if (member, market) in claim_edges:
                direction = 1 if net[member][market] > 0 else -1
                movements[market] = direction * rounded[claim_edges[member, market]]
        result.append(dict(
            id=row["id"], own=list(map(str, own[member])), recovered=list(map(str, recovered[member])),
            forwarded=list(map(str, forwarded[member])), loss=list(map(str, loss)),
            writeoff=list(map(str, writeoff)), entitlement=str(entitlement[member]),
            cash=str(rounded[-count + member]), movements=list(map(str, movements)),
        ))
    return dict(
        markets=market_ids, rates=list(map(str, rates)), spent=list(map(str, spent)),
        left=[str(reserve - use) for reserve, use in zip(reserves, spent)],
        fees=list(map(str, fees)), rows=result,
    )
