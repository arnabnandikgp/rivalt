"""Literal outcomes and independent matchings for simultaneous frozen reductions."""
from fractions import Fraction
from itertools import permutations, product
import unittest

from account_contract_reference import Account
from joint_reduction_model import Exposure, compare_joint, evaluate, market_plans
from market_settlement_reference import MarketBook
from settlement_liquidation_model import terminal
from test_creditor_payout_floors import linked_creditors
from test_scalable_settlement import decode, frozen_book_command, run


def inactive(count):
    return Exposure(100, (0,) * count, (None,) * count, (0,) * count)


def linked_defaults(insurance=(0, 0)):
    rows = ((9, -11, 0), (0, 2, -1), (9, 0, -11), (0, -1, 2), (0, 10, 0), (0, 0, 10))
    book = MarketBook(tuple(Account(cash, (btc, eth)) for cash, btc, eth in rows), insurance=insurance, frozen=True)
    btc = Exposure(100, (-1, 1, 0, 0, 0, 0), (100, 98, None, None, None, None), (0, 2, 0, 0, 0, 0))
    eth = Exposure(20, (0, 0, 1, -1, 0, 0), (None, None, 20, 22, None, None), (0, 0, 0, 2, 0, 0))
    return book, (btc, eth)


class JointReductions(unittest.TestCase):
    def test_one_opposite_lot_cannot_be_claimed_by_two_debtors(self):
        book = MarketBook((Account(9, (-10, 0)), Account(2, (-10, 0)), Account(0, (8, 0)),
                           Account(0, (12, 0))), frozen=True)
        exposures = (Exposure(100, (-1, -1, 1, 1), (100, 100, 92, 100), (0, 0, 8, 0)), inactive(4))
        baseline = terminal(book)
        choices = market_plans(book, 0, exposures[0], baseline)
        self.assertTrue(all(len(plan.pairs) <= 1 for plan in choices))
        first_debtor = max(plan.charged for plan in choices if plan.pairs and plan.pairs[0].debtor == 0)
        self.assertEqual(first_debtor, 1)
        best, = compare_joint(book, exposures, require_standalone=True)
        pair, = best.markets[0].pairs
        self.assertEqual((pair.debtor, pair.winner, pair.fills), (1, 2, ((1, 92),)))
        self.assertEqual((best.recovered, best.payout.cash), ((8, 0), (0, 0, 0, 11)))
        self.assertEqual(best.markets[0].remaining_lots, (-1, 0, 0, 1))

    def test_joint_feasibility_differs_from_individual_market_feasibility(self):
        book, exposures = linked_defaults()
        separate, = compare_joint(book, exposures, require_standalone=True)
        joint, = compare_joint(book, exposures, require_standalone=False)
        self.assertEqual((separate.charges, separate.payout.cash), ((0, 0), (0, 1, 0, 1, 8, 8)))
        self.assertEqual((joint.charges, joint.payout.cash), ((2, 2), (0, 0, 0, 0, 9, 9)))
        # Write off one fewer atom per market; charging two on each leg does not recover four.
        self.assertEqual((joint.recovered, joint.payout.insurance_spent), ((1, 1), (0, 0)))
        self.assertEqual(tuple(market.pairs[0].fills for market in joint.markets), (((1, 98),), ((1, 22),)))
        self.assertTrue(all(not any(market.remaining_lots) for market in joint.markets))
        self.assertEqual(joint.payout.benchmark.rates, (Fraction(9, 10), Fraction(9, 10)))

    def test_one_market_cannot_use_an_empty_other_leg_to_skip_protection(self):
        book, exposures = linked_defaults()
        baseline = terminal(book)
        btc = market_plans(book, 0, exposures[0], baseline)
        eth = market_plans(book, 1, exposures[1], baseline)
        for own, other in product(btc, eth):
            if bool(own.pairs) != bool(other.pairs):
                self.assertIsNone(evaluate(book, baseline, (own, other)))

    def test_joint_search_uses_d118_to_preserve_the_smallest_eth_payout(self):
        state = linked_creditors()
        btc = Exposure(state.mark, state.lots, state.entries, (0, 2, 0, 0, 0, 0))
        result, = compare_joint(state.book, (btc, inactive(6)), require_standalone=False)
        self.assertEqual((result.charges, result.payout.cash[3:]), ((2, 0), (3, 1, 1)))

    def test_shared_debtor_funds_both_markets_once_and_retains_fee_buckets(self):
        book = MarketBook((Account(3, (-5, -5)), Account(0, (5, 0)), Account(0, (0, 5))),
                          fees=(6, 4), frozen=True)
        profiles = (Exposure(100, (-1, 1, 0), (100, 97, None), (0, 3, 0)),
                    Exposure(20, (1, 0, -1), (20, None, 23), (0, 0, 3)))
        best, = compare_joint(book, profiles, require_standalone=False)
        self.assertEqual((best.charges, best.recovered), ((3, 3), (3, 3)))
        self.assertEqual(best.payout.benchmark.collections[0], (Fraction(3, 2), Fraction(3, 2)))
        self.assertEqual(best.payout.benchmark.debtor_writeoffs[0], (Fraction(1, 2), Fraction(1, 2)))
        self.assertEqual((sum(best.payout.cash), best.book.fees, best.book.vault), (3, (6, 4), 13))

    def test_insurance_and_incomparable_market_recoveries_remain_visible(self):
        book, exposures = linked_defaults(insurance=(1, 0))
        plans = compare_joint(book, exposures, require_standalone=False)
        self.assertEqual({(plan.recovered, plan.payout.cash[4:]) for plan in plans},
                         {((1, 0), (10, 8)), ((Fraction(109, 120), Fraction(119, 120)), (10, 9))})
        self.assertTrue(all(plan.payout.insurance_spent == (1, 0) for plan in plans))
        funded, profiles = linked_defaults(insurance=(2, 2))
        only, = compare_joint(funded, profiles, require_standalone=False)
        self.assertEqual((only.charges, only.payout.cash[4:]), ((0, 0), (10, 10)))

    def test_against_all_bipartite_matchings_with_two_one_lot_debtors_and_winners(self):
        # Independent oracle for this family: there are precisely two full
        # assignments. An edge can absorb the smaller of its two endpoint limits.
        for first, second, gain_a, gain_b in product(range(1, 4), repeat=4):
            debts, gains = (first, second), (gain_a, gain_b)
            book = MarketBook((Account(4 - first, (-4, 0)), Account(4 - second, (-4, 0)),
                               Account(0, (4, 0)), Account(0, (4, 0))), frozen=True)
            exposure = Exposure(100, (-1, -1, 1, 1), (100, 100, 100 - gain_a, 100 - gain_b),
                                (0, 0, gain_a, gain_b))
            expected = set()
            best_score = None
            for assigned in permutations(debts):
                charges = tuple(min(budget, gain) for budget, gain in zip(assigned, gains))
                score = (-sum(charges), sum(Fraction(charge * charge, gain) for charge, gain in zip(charges, gains)))
                if best_score is None or score < best_score:
                    best_score, expected = score, set()
                if score == best_score:
                    expected.add(charges)
            observed = compare_joint(book, (exposure, inactive(4)), require_standalone=True)
            self.assertEqual({plan.markets[0].winner_charges[2:] for plan in observed}, expected)
            self.assertTrue(all(plan.recovered == (-best_score[0], 0) for plan in observed))

    def test_native_terminal_controls_for_both_markets_and_each_half(self):
        book, _ = linked_defaults()
        expected = {(0, 0): (0, 1, 0, 1, 8, 8), (2, 0): (0, 0, 0, 1, 10, 7),
                    (0, 2): (0, 1, 0, 0, 7, 10), (2, 2): (0, 0, 0, 0, 9, 9)}
        commands = []
        for btc, eth in expected:
            # Write down the four adjusted claims directly. No candidate selector
            # or paired-close builder provides the expected Rust inputs.
            accounts = (Account(9, (-11 + btc, 0)), Account(0, (2 - btc, -1)),
                        Account(9, (0, -11 + eth)), Account(0, (-1, 2 - eth)), *book.accounts[4:])
            commands.append(frozen_book_command(MarketBook(accounts, frozen=True)))
        for line, cash in zip(run(commands), expected.values(), strict=True):
            native = decode(line)
            self.assertEqual((native['cash'], native['spent']), (cash, (0, 0)))


if __name__ == "__main__":
    unittest.main()
