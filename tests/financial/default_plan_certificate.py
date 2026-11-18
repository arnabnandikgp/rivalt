"""Offline optimality certificate for one precisely represented class of frozen books."""
from dataclasses import dataclass
from fractions import Fraction
from itertools import combinations
from math import gcd

from account_contract_reference import Account, require
from joint_reduction_model import Exposure
from market_settlement_reference import MarketBook


@dataclass(frozen=True)
class ThreeLotBook:
    """Each debtor has three short lots, and each winner has one indivisible long lot."""
    shortfall: int
    gains: tuple[int, ...]
    cash_per_debtor: int = 10

    def __post_init__(self):
        require(type(self.shortfall) is int and self.shortfall > 0 and self.gains and len(self.gains) % 3 == 0,
                "three one-lot winners required per debtor")
        require(all(type(gain) is int and self.shortfall < 4 * gain and 2 * gain < self.shortfall
                    for gain in self.gains), "gain must lie strictly between one quarter and one half of the budget")
        require(sum(self.gains) == self.debtors * self.shortfall, "original shortfall and gain totals must match")
        require(type(self.cash_per_debtor) is int and self.cash_per_debtor > 0, "funded flat claim required")

    @property
    def debtors(self):
        return len(self.gains) // 3

    def frozen(self):
        cash, budget, count = self.cash_per_debtor, self.shortfall, self.debtors
        accounts = ((Account(cash, (-budget - cash, 0)),) * count +
                    tuple(Account(0, (gain, 0)) for gain in self.gains) + (Account(0, (count * cash, 0)),))
        book = MarketBook(accounts, frozen=True)
        mark = budget + 1
        btc = Exposure(mark, (-3,) * count + (1,) * len(self.gains) + (0,),
                       (mark,) * count + tuple(mark - gain for gain in self.gains) + (None,),
                       (0,) * count + self.gains + (0,))
        empty = (0,) * len(accounts)
        return book, (btc, Exposure(1, empty, (None,) * len(accounts), empty))

    def recovery_bound(self):
        # Assign unused winners to vacant slots at zero charge. All complete
        # triples now have the same residue modulo the gcd of gain differences.
        # The best relaxed group totals straddle B at adjacent allowed values.
        first = self.gains[0]
        unit = gcd(*(gain - first for gain in self.gains))
        if unit == 0:
            return sum(self.gains)
        remainder = (self.shortfall - 3 * first) % unit
        minimum_unused = self.debtors * remainder * (unit - remainder) // unit
        return sum(self.gains) - minimum_unused


@dataclass(frozen=True)
class AssignmentProof:
    # One entry per frozen winner, in member order. A zero charge consumes no lot.
    assignments: tuple[tuple[int, int], ...]  # (debtor ordinal, charge)


@dataclass(frozen=True)
class VerifiedScore:
    recovered: int
    proportional_deviation: Fraction
    recovery_proved: bool
    sharing_proved: bool
    book: MarketBook
    forced_lots: int


def verify(case, proof):
    """Verify the complete witness and sufficient score bounds without searching other plans.

    Inputs represent only ThreeLotBook. Epoch authentication, uniqueness among equal
    scores and the general two-market terminal calculation are separate obligations.
    """
    require(len(proof.assignments) == len(case.gains), "one entry per original winning position")
    paid = [0] * case.debtors
    consumed = [0] * case.debtors
    charges = []
    for gain, (debtor, charge) in zip(case.gains, proof.assignments, strict=True):
        require(type(debtor) is int and 0 <= debtor < case.debtors and type(charge) is int
                and 0 <= charge <= gain, "invalid assignment or gain charge")
        paid[debtor] += charge
        consumed[debtor] += int(charge > 0)
        require(paid[debtor] <= case.shortfall and consumed[debtor] <= 3, "debtor resources exceeded")
        charges.append(charge)
    total = sum(charges)
    capacity = sum(case.gains)
    deviation = sum((charge - Fraction(total * gain, capacity)) ** 2 / gain
                    for gain, charge in zip(case.gains, charges))
    # Moving one atom from a donor to a recipient changes sum(q^2/gain)
    # by recipient marginal minus donor marginal. Monotone marginals make
    # the absence of an improving exchange a global integer lower bound.
    most_expensive = max((Fraction(2 * q - 1, gain) for q, gain in zip(charges, case.gains) if q), default=0)
    next_available = [Fraction(2 * q + 1, gain) for q, gain in zip(charges, case.gains) if q < gain]
    shares_optimal = not next_available or most_expensive <= min(next_available)
    cash = case.cash_per_debtor
    accounts = (tuple(Account(cash, (-case.shortfall - cash + charge, 0)) for charge in paid) +
                tuple(Account(0, (gain - q, 0)) for gain, q in zip(case.gains, charges)) +
                (Account(0, (case.debtors * cash, 0)),))
    return VerifiedScore(total, deviation, total == case.recovery_bound(), shares_optimal,
                         MarketBook(accounts, frozen=True), sum(consumed))


def exact_primary_recovery(case):
    """Exhaust disjoint triples for this family. Report the number of complete partitions tested."""
    def partitions(remaining, charged):
        if not remaining:
            yield charged
            return
        first, *others = remaining
        for second, third in combinations(others, 2):
            group = (first, second, third)
            score = min(case.shortfall, sum(case.gains[index] for index in group))
            yield from partitions(tuple(index for index in others if index != second and index != third),
                                  charged + score)

    best = checked = 0
    for score in partitions(tuple(range(len(case.gains))), 0):
        checked += 1
        best = max(best, score)
    return best, checked
