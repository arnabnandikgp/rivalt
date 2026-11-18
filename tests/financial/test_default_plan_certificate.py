"""Independent literal, exhaustive and native controls for score verification."""
from dataclasses import replace
from fractions import Fraction
from itertools import combinations, combinations_with_replacement
import unittest

from account_contract_reference import Account, InvalidTransition
from default_plan_certificate import AssignmentProof, ThreeLotBook, exact_primary_recovery, verify
from frozen_plan_selection import FrozenIdentity, _break_exact_ties, select_joint
from joint_reduction_model import Exposure, compare_joint
from market_settlement_reference import MarketBook
from test_joint_reductions import inactive
from test_scalable_settlement import decode, frozen_book_command, run


def tie_book():
    book = MarketBook((Account(10, (-20, 0)), Account(0, (0, 0)),
                       Account(0, (10, 0)), Account(0, (10, 0))), frozen=True)
    btc = Exposure(100, (-1, -1, 1, 1), (100, 100, 90, 90), (0, 0, 10, 10))
    return book, (btc, inactive(4))


class DefaultPlanCertificate(unittest.TestCase):
    def test_lot_match_score_through_funded_flat_creditor_and_native_settlement(self):
        case = ThreeLotBook(15, (4, 5, 6) * 30)
        witness = AssignmentProof(tuple((index // 3, gain) for index, gain in enumerate(case.gains)))
        result = verify(case, witness)
        original, _ = case.frozen()
        self.assertEqual((result.recovered, result.proportional_deviation, result.forced_lots), (450, 0, 90))
        self.assertTrue(result.recovery_proved and result.sharing_proved)
        self.assertEqual((len(original.accounts), original.vault, result.book.vault), (121, 300, 300))
        for line, flat in zip(run([frozen_book_command(book) for book in (original, result.book)]), (120, 300)):
            native = decode(line)
            self.assertEqual((native['cash'][-1], sum(native['cash']), native['spent']), (flat, 300, (0, 0)))

    def test_gain_residues_prove_a_partial_optimum_and_integer_sharing(self):
        case = ThreeLotBook(16, (5, 5, 5, 5, 5, 7))
        proof = AssignmentProof(((0, 5), (0, 5), (0, 5), (1, 5), (1, 5), (1, 6)))
        result = verify(case, proof)
        self.assertEqual((case.recovery_bound(), exact_primary_recovery(case)), (31, (31, 10)))
        self.assertEqual((result.recovered, result.recovery_proved, result.sharing_proved), (31, True, True))
        # Same 31 recovered, but reducing a five-atom winner's charge first is less proportional.
        unequal = verify(case, replace(proof, assignments=(*proof.assignments[:3], (1, 4), (1, 5), (1, 7))))
        self.assertTrue(unequal.recovery_proved)
        self.assertFalse(unequal.sharing_proved)
        self.assertGreater(unequal.proportional_deviation, result.proportional_deviation)
        self.assertEqual(decode(run([frozen_book_command(result.book)])[0])['cash'][-1], 19)

    def test_feasible_and_optimal_plan_can_need_more_than_the_linear_bound(self):
        case = ThreeLotBook(17, (5, 5, 5, 5, 6, 8))
        proof = AssignmentProof(((0, 5), (0, 5), (1, 5), (1, 5), (0, 6), (1, 7)))
        result = verify(case, proof)
        self.assertEqual((result.recovered, result.recovery_proved, result.sharing_proved), (33, False, True))
        self.assertEqual((case.recovery_bound(), exact_primary_recovery(case)), (34, (33, 10)))

    def test_bound_against_all_splits_of_small_admissible_six_winner_books(self):
        for budget in range(12, 25):
            gains = range(budget // 4 + 1, (budget + 1) // 2)
            for values in combinations_with_replacement(gains, 6):
                if sum(values) != 2 * budget:
                    continue
                case = ThreeLotBook(budget, values)
                # With two debtors the best recovery loses precisely the
                # distance of the closest three-winner sum from the budget.
                optimum = 2 * budget - min(abs(sum(triple) - budget) for triple in combinations(values, 3))
                self.assertEqual(exact_primary_recovery(case), (optimum, 10))
                self.assertLessEqual(optimum, case.recovery_bound())

    def test_submission_requires_whole_position_and_per_debtor_budgets(self):
        case = ThreeLotBook(15, (4, 5, 6) * 2)
        witness = [(i // 3, gain) for i, gain in enumerate(case.gains)]
        for invalid in (witness[:-1], [(2, 1), *witness[1:]], [(0, 5), *witness[1:]],
                        [(0, Fraction(1, 2)), *witness[1:]], [(0, 1)] * 6):
            with self.assertRaises(InvalidTransition):
                verify(case, AssignmentProof(tuple(invalid)))

    def test_certificate_score_matches_the_full_joint_planner_in_its_domain(self):
        case = ThreeLotBook(12, (4, 4, 4))
        book, exposures = case.frozen()
        chosen, = compare_joint(book, exposures)
        result = verify(case, AssignmentProof(((0, 4),) * 3))
        self.assertEqual((chosen.recovered[0], chosen.markets[0].deviation, chosen.book),
                         (result.recovered, result.proportional_deviation, result.book))

    def test_episode_order_selects_the_same_winner_after_retry_and_submission_reorder(self):
        book, exposures = tie_book()
        plans = compare_joint(book, exposures)
        self.assertEqual(len(plans), 2)
        self.assertEqual({(plan.recovered, plan.markets[0].deviation) for plan in plans}, {((10, 0), 5)})
        identity = FrozenIdentity(bytes(range(32)), 0, (2, 7, 10, 44))
        for epoch, order, cash in ((0, [2, 7, 44, 10], (0, 0, 10, 0)), (1, [2, 7, 10, 44], (0, 0, 0, 10))):
            freeze = replace(identity, episode=epoch)
            self.assertEqual([freeze.member_ids[i] for i in freeze.order()], order)
            selected = select_joint(book, exposures, freeze)
            self.assertEqual(_break_exact_ties(list(reversed(plans)), freeze), selected)
            self.assertEqual(selected.payout.cash, cash)
            self.assertEqual(decode(run([frozen_book_command(selected.book)])[0])['cash'], cash)

    def test_identity_must_be_complete_and_canonical(self):
        with self.assertRaises(InvalidTransition):
            FrozenIdentity(bytes(32), 4, (7, 7))
        book, exposures = tie_book()
        for ids in ((2, 7, 10), (2, 7, 44, 10)):
            with self.assertRaises(InvalidTransition):
                select_joint(book, exposures, FrozenIdentity(bytes(32), 4, ids))


if __name__ == "__main__":
    unittest.main()
