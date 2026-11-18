"""Small exact search over shared inventory and two frozen markets. Offline only."""
from dataclasses import dataclass, replace
from fractions import Fraction
from itertools import product
from math import floor

from account_contract_reference import Account, require
from adl_eligibility_model import eligible_positions
from clearing_network_reference import AtomClearingPlan, clear_atom_cohort
from cross_market_adl_model import market_losses, protect_receipts
from market_settlement_reference import MarketBook
from settlement_liquidation_model import MarketSnapshot, paired_reduction, terminal


@dataclass(frozen=True)
class Exposure:
    mark: int
    lots: tuple[int, ...]
    entries: tuple[int | Fraction | None, ...]
    unpaid_gains: tuple[int | Fraction, ...]


@dataclass(frozen=True)
class Pair:
    debtor: int
    winner: int
    charge: int
    fills: tuple[tuple[int, int], ...]


@dataclass(frozen=True)
class MarketPlan:
    claims: tuple[Fraction, ...]
    winner_charges: tuple[int, ...]
    remaining_lots: tuple[int, ...]
    pairs: tuple[Pair, ...]
    deviation: Fraction

    @property
    def charged(self):
        return sum(self.winner_charges)


def market_plans(book, market, exposure, baseline):
    # The paired-fill primitive takes its target in column zero. Rotate both
    # claims and market buckets together, then return only that market's column.
    if market == 1:
        book = replace(book, accounts=tuple(Account(a.cash, a.claims[::-1]) for a in book.accounts),
                       pools=book.pools[::-1], insurance=book.insurance[::-1], fees=book.fees[::-1])
    state = MarketSnapshot(book, exposure.lots, exposure.mark, exposure.entries)
    member_count = len(book.accounts)
    require(len(exposure.unpaid_gains) == member_count and all(
        type(gain) in (int, Fraction) and gain >= 0 for gain in exposure.unpaid_gains), "invalid frozen gains")
    budgets = [floor(row[market]) for row in baseline.benchmark.debtor_writeoffs]
    edges = [(debtor, pos) for debtor in range(member_count) if budgets[debtor] and state.lots[debtor]
             for pos in eligible_positions(state, debtor, exposure.unpaid_gains)]
    # Count each winner's eligible position once, even if several debtors can pair with it.
    caps = {}
    for winner in sorted({position.member for _, position in edges}):
        pairable = [(debtor, pos) for debtor, pos in edges if pos.member == winner]
        available_lots = min(abs(state.lots[winner]), sum(abs(state.lots[d]) for d, _ in pairable))
        caps[winner] = min(floor(book.accounts[winner].claims[0]), floor(available_lots * pairable[0][1].gain_per_lot))
    total_capacity = sum(caps.values())
    winners = (0,) * member_count

    def extend(cursor, current, remaining_budgets, charges, pairs):
        if cursor == len(edges):
            total = sum(charges)
            deviation = sum((charges[w] - Fraction(total * cap, total_capacity)) ** 2 / cap
                            for w, cap in caps.items())
            yield MarketPlan(tuple(account.claims[0] for account in current.book.accounts),
                             charges, current.lots, pairs, deviation)
            return
        debtor, pos = edges[cursor]
        winner = pos.member
        lots = min(abs(current.lots[debtor]), abs(current.lots[winner]))
        maximum = min(remaining_budgets[debtor], caps[winner] - charges[winner],
                      floor(lots * pos.gain_per_lot))
        yield from extend(cursor + 1, current, remaining_budgets, charges, pairs)
        for charge in range(1, maximum + 1):
            reduced, fills = paired_reduction(current, debtor, winner, pos.gain_per_lot, charge)
            next_budgets, next_charges = list(remaining_budgets), list(charges)
            next_budgets[debtor] -= charge
            next_charges[winner] += charge
            yield from extend(cursor + 1, reduced, next_budgets, tuple(next_charges),
                              (*pairs, Pair(debtor, winner, charge, fills)))

    return tuple(extend(0, state, budgets, winners, ()))


@dataclass(frozen=True)
class JointPlan:
    markets: tuple[MarketPlan, MarketPlan]
    book: MarketBook
    payout: AtomClearingPlan
    recovered: tuple[Fraction, Fraction]

    @property
    def charges(self):
        return tuple(market.charged for market in self.markets)


def evaluate(original, baseline, plans):
    """Test the complete package against the original frozen cohort in both markets."""
    accounts = tuple(Account(account.cash, (plans[0].claims[index], plans[1].claims[index]))
                     for index, account in enumerate(original.accounts))
    book = replace(original, accounts=accounts)
    collections = baseline.benchmark.collections
    payout = clear_atom_cohort(accounts, book.pools, book.insurance, book.fees, frozen_collections=collections)
    initial, final = market_losses(baseline), market_losses(payout)
    floors = {}
    for market, own in enumerate(plans):
        if not plans[1 - market].charged:
            continue  # No foreign action to test for this market.
        if final[market] > initial[market] or payout.insurance_spent[market] > baseline.insurance_spent[market]:
            return None
        for index, account in enumerate(original.accounts):
            if account.claims[market] <= 0:
                continue
            # Only the verified charge on this very claim may lower its original
            # entitlement. A flat creditor's allowance is always zero.
            direct_charge = own.winner_charges[index]
            before = account.claims[market] * baseline.benchmark.rates[market]
            after = plans[market].claims[index] * payout.benchmark.rates[market]
            if after < before - direct_charge:
                return None
            minimum = baseline.claim_cash_movements[index][market] - direct_charge
            if minimum > 0:
                floors[index, market] = minimum
    payout = protect_receipts(book, payout, floors, collections)
    if payout is None:
        return None
    recovered = tuple(min(m.charged, before - after) for m, before, after in zip(plans, initial, final))
    return JointPlan(plans, book, payout, recovered)


def preferred(first, second):
    """Keep incomparable market outcomes visible; never add BTC and ETH shortfalls for ranking."""
    if first.recovered != second.recovered:
        return all(a >= b for a, b in zip(first.recovered, second.recovered))
    deviations = [tuple(m.deviation for m in plan.markets) for plan in (first, second)]
    if deviations[0] != deviations[1]:
        return all(a <= b for a, b in zip(*deviations))
    # Research tie break after both economic objectives. Preserve equivalent
    # allocations for inspection when the tie break also matches.
    def costs(plan):
        return tuple((market.charged, sum(size for pair in market.pairs for size, _ in pair.fills))
                     for market in plan.markets)
    first_costs, second_costs = costs(first), costs(second)
    return first_costs != second_costs and all(a <= b for a, b in zip(first_costs, second_costs))


def compare_joint(book, exposures, *, require_standalone=False):
    require(book.frozen and len(exposures) == 2, "both frozen markets required")
    baseline = terminal(book)
    choices = [market_plans(book, m, exposures[m], baseline) for m in range(2)]
    empty = tuple(next(plan for plan in market if not plan.pairs) for market in choices)
    if require_standalone:
        choices = [[plan for plan in choices[0] if evaluate(book, baseline, (plan, empty[1])) is not None],
                   [plan for plan in choices[1] if evaluate(book, baseline, (empty[0], plan)) is not None]]
    frontier = []
    for pair in product(*choices):
        result = evaluate(book, baseline, pair)
        if result is not None and not any(preferred(other, result) for other in frontier):
            frontier = [other for other in frontier if not preferred(result, other)]
            frontier.append(result)
    require(bool(frontier), "the original frozen plan must remain feasible")
    return frontier
