"""Certify exact whole-atom decisions from two fixed-width surviving-cost bounds."""
from fractions import Fraction
from random import Random
from typing import NamedTuple
import unittest

from account_contract_reference import Account
from market_settlement_reference import MarketBook
from test_bounded_entry import MARK, SCALE, fill, reference_and_native, signed_member_actions
from test_scalable_settlement import decode, frozen_book_command, run


class Decisions(NamedTuple):
    ordinary: int | None
    forced: int | None


class Observation(NamedTuple):
    bounds: tuple
    claim_scaled: int
    exact: Decisions
    inclusive: Decisions
    strict: Decisions


def evaluate(cost_scaled, lots, claim_scaled, mark, matched):
    """Independent rational evaluation at a possible cost, in atoms."""
    cost = cost_scaled / SCALE
    gain = max(0, lots * mark - (1 if lots >= 0 else -1) * cost)
    payable = int(max(0, Fraction(claim_scaled, SCALE) - gain))
    ticks = int(gain / abs(lots)) if lots else 0
    room = mark - 1 if lots > 0 else 1_000_000 - mark
    charge = min(int(max(0, Fraction(claim_scaled, SCALE))), matched * min(ticks, room))
    return Decisions(payable, charge)


def observations(actions, available=None):
    results = []
    for ceilings, fields, lots, claim, cost, mark, matched in reference_and_native(actions, available, intervals=True):
        lower, open_lower, upper, open_upper = map(int, fields[:4])
        assert open_lower in (0, 1) and open_upper in (0, 1)
        assert (lower < cost if open_lower else lower <= cost)
        assert (cost < upper if open_upper else cost <= upper)
        exact = Decisions(ceilings.exact_pay, ceilings.exact_charge)
        amounts = [None if field == "?" else int(field) for field in fields[4:]]
        inclusive, strict = Decisions(*amounts[:2]), Decisions(*amounts[2:])
        for use_open, actual in [(False, inclusive), (True, strict)]:
            # Every jump is at an integer scaled cost. Probe the interior side of
            # an excluded endpoint with an exact rational independent of Rust.
            inset = Fraction(1, 7) if use_open else Fraction()
            low = evaluate(lower + open_lower * inset, lots, claim, mark, matched)
            high = evaluate(upper - open_upper * inset, lots, claim, mark, matched)
            expected = Decisions(*(left if left == right else None for left, right in zip(low, high)))
            assert actual == expected
            assert all(value is None or value == target for value, target in zip(actual, exact))
        results.append(Observation((lower, open_lower, upper, open_upper), claim, exact, inclusive, strict))
    return results


def ambiguous_counts(rows, column):
    decisions = [getattr(row, column) for row in rows]
    return tuple(sum(decision[index] is None for decision in decisions) for index in (0, 1))


def opposite_histories(offset, rounds=30):
    # Two histories converge towards MARK from opposite sides. The compensating
    # first sale gives them equal total virtual quote. At five lots their cost
    # falls inside the same interval; a later increase puts a tick inside it.
    mark = MARK + 2
    actions = [fill(1, MARK + offset, mark)]
    for round_index in range(rounds):
        premium = offset if round_index == 0 else 0
        actions.extend([fill(1, MARK, mark), fill(-1, MARK + 1 + premium, mark)])
    actions.extend([(8, 8*MARK + 3, mark, 0), fill(-4, MARK, mark),
                    fill(-2, MARK, mark), fill(1, MARK - 1, mark)])
    return actions


class EntryBounds(unittest.TestCase):
    def test_retained_histories(self):
        for rounds, key, inclusive_misses in [(65, "WALLET", 127), (69, "DIAGNOSTIC", 135)]:
            series = [observations(actions) for actions in signed_member_actions(rounds, key)]
            route_count = 2*rounds + 4
            self.assertEqual([len(rows) for rows in series], [4, 2*rounds, route_count])
            for member, rows in enumerate(series):
                with self.subTest(run=key, member=member):
                    self.assertEqual(ambiguous_counts(rows, "inclusive"),
                                     (0, inclusive_misses if member == 2 else 0))
                    self.assertEqual(ambiguous_counts(rows, "strict"), (0, 0))

    def test_known_partial_closes_and_frozen_settlement(self):
        for side in (1, -1):
            mark = MARK + 2*side
            opening = [(side*6, 6*MARK + 2*side, mark, 0)]
            together = observations(opening + [fill(-side*3, mark, mark)])[-1]
            split = observations(opening + [fill(-side, mark, mark)]*3)[-1]
            self.assertEqual(together.strict, Decisions(5, 3))
            self.assertEqual((split.exact, split.strict), (Decisions(5, 3), Decisions(None, 3)))
            flat = observations(opening + [fill(-side, mark, mark)]*6)[-1]
            self.assertEqual((flat.bounds, flat.strict), ((0, 0, 0, 0), Decisions(10, 0)))
        mark = MARK + 2
        history = [fill(1, MARK+1, mark)] + [fill(1, MARK, mark), fill(-1, MARK+1, mark)]*30
        frozen = observations(history)[-1]
        self.assertEqual((frozen.inclusive, frozen.strict), (Decisions(29, None), Decisions(29, 1)))
        charge = frozen.strict.forced
        book = MarketBook((Account(8, (-33+charge, 0)), Account(0, (31-charge, 0)),
                           Account(0, (2, 0))), frozen=True)
        result = decode(run([frozen_book_command(book)])[0])
        self.assertEqual((result["cash"], result["spent"]), ((0, 8, 0), (0, 0)))

    def test_two_reachable_histories_share_bounds_but_have_different_answers(self):
        below, above = [observations(opposite_histories(offset))[-1] for offset in (-1, 1)]
        self.assertEqual((below.bounds, below.claim_scaled), (above.bounds, above.claim_scaled))
        center = 4 * MARK * SCALE
        self.assertEqual((below.bounds, below.claim_scaled), ((center-1, 1, center+1, 1), 36*SCALE))
        self.assertEqual((below.exact, above.exact), (Decisions(27, 8), Decisions(28, 4)))
        self.assertEqual((below.strict, above.strict), (Decisions(None, None),)*2)
        for offset in (-1, 1):
            history = opposite_histories(offset)
            # Flat clears prior uncertainty. Flipping the position discards its
            # old cost and starts the opposite side at its share of the gross.
            flat = observations(history + [fill(-4, MARK+2, MARK+2)])[-1]
            self.assertEqual((flat.bounds, flat.strict), ((0, 0, 0, 0), Decisions(36, 0)))
            flipped = observations(history + [(-7, 7*MARK+1, MARK, 0)])[-1]
            accrued = Fraction(3*(7*MARK+1)*SCALE, 7)
            self.assertEqual(flipped.bounds, (int(accrued), 1, int(accrued)+1, 1))

    def test_mixed_fills_funding_clamps_and_domain_boundaries(self):
        rng = Random(177)
        for available in (0, 1, None):
            actions = []
            for _ in range(350):
                delta = rng.choice([-7, -4, -2, -1, 0, 1, 2, 4, 7])
                price = MARK + rng.randint(-4, 4)
                gross = abs(delta)*price + (rng.randrange(abs(delta)) if delta else 0)
                mark = rng.choice([1, MARK-2, MARK, MARK+2, 1_000_000])
                actions.append((delta, gross, mark, rng.randint(-2*SCALE, 2*SCALE)))
            observations(actions, available)
        limit = 100_000_000
        for side in (1, -1):
            actions = [fill(side*limit, 1_000_000, 1_000_000),
                       fill(-side, 1, 1), fill(-side*(limit-1), 1_000_000, 1_000_000)]
            rows = observations(actions)
            self.assertEqual(rows[0].bounds, (10**23, 0, 10**23, 0))
            self.assertEqual(rows[-1].bounds, (0, 0, 0, 0))


if __name__ == "__main__":
    unittest.main()
