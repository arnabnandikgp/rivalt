"""Independent exact golden cases for the P22B rational clearing benchmark.

These do not qualify a whole-atom program. Literal and closed-form expectations
are separate from the branch solver; no Rust/SDK implementation is imported.
"""

from fractions import Fraction
from itertools import permutations
import unittest

from account_contract_reference import Account, InvalidTransition
from clearing_network_reference import clear_atom_cohort, clear_rational_cohort


class ClearingNetworkContract(unittest.TestCase):
    def test_unrelated_market_does_not_share_a_blanket_haircut(self):
        accounts = (Account(100, (-100, 0)), Account(0, (100, 0)),
                    Account(0, (0, -100)), Account(0, (0, 100)))
        result = clear_rational_cohort(accounts, fees=(9, 11))
        self.assertEqual(result.cash_entitlements, (0, 100, 0, 0))
        self.assertEqual(result.rates, (1, 0))
        self.assertEqual(result.insurance_spent, (0, 0))
        self.assertEqual(result.creditor_impairments, ((0, 0), (0, 0), (0, 0), (0, 100)))

    def test_shared_debtor_and_market_insurance_match_the_selected_example(self):
        accounts = (Account(100, (-80, -80)), Account(0, (80, 0)), Account(0, (0, 80)))
        result = clear_rational_cohort(accounts, insurance=(20, 10), fees=(60, 0))
        self.assertEqual(result.collections, ((50, 50), (0, 0), (0, 0)))
        self.assertEqual(result.cash_entitlements, (0, 70, 60))
        self.assertEqual(result.rates, (Fraction(7, 8), Fraction(3, 4)))
        self.assertEqual(result.insurance_spent, (20, 10))
        self.assertEqual(result.debtor_writeoffs, ((10, 20), (0, 0), (0, 0)))

    def test_unfunded_source_profit_does_not_erase_destination_loss(self):
        accounts = (Account(0, (100, -100)), Account(0, (-100, 0)), Account(0, (0, 100)))
        result = clear_rational_cohort(accounts)
        self.assertEqual(result.cash_entitlements, (0, 0, 0))
        self.assertEqual(result.link_payments, (0,))
        self.assertEqual(result.creditor_impairments, ((100, 0), (0, 0), (0, 100)))
        self.assertEqual(result.debtor_writeoffs, ((0, 100), (100, 0), (0, 0)))

    def test_partial_source_recovery_reaches_destination_creditor(self):
        accounts = (Account(0, (100, -100)), Account(40, (-100, 0)), Account(0, (0, 100)))
        result = clear_rational_cohort(accounts, insurance=(10, 20))
        self.assertEqual(result.rates, (Fraction(1, 2), Fraction(7, 10)))
        self.assertEqual(result.link_payments, (50,))
        self.assertEqual(result.cash_entitlements, (0, 0, 70))
        self.assertEqual(result.insurance_spent, (10, 20))
        self.assertEqual(result.debtor_writeoffs, ((0, 30), (50, 0), (0, 0)))

    def test_fully_funded_pool_transfer_does_not_need_insurance(self):
        accounts = (Account(0, (100, -100)), Account(0, (0, 100)))
        result = clear_rational_cohort(accounts, pools=(100, 0), insurance=(7, 13))
        self.assertEqual(result.link_payments, (100,))
        self.assertEqual(result.cash_entitlements, (0, 100))
        self.assertEqual(result.insurance_spent, (0, 0))
        self.assertFalse(result.has_fractional_cash_effects)

    def test_cashless_closed_cycle_cancels_without_consuming_insurance(self):
        accounts = (Account(0, (100, -100)), Account(0, (-100, 100)))
        for insurance in ((0, 0), (30, 0), (0, 40), (30, 40)):
            with self.subTest(insurance=insurance):
                result = clear_rational_cohort(accounts, insurance=insurance)
                self.assertEqual(result.rates, (1, 1))
                self.assertEqual(result.link_payments, (100, 100))
                self.assertEqual(result.insurance_spent, (0, 0))
                self.assertEqual(result.cash_entitlements, (0, 0))
                self.assertEqual(result.creditor_impairments, ((0, 0), (0, 0)))

    def test_netting_is_capped_at_own_remaining_debt(self):
        accounts = (Account(0, (20, -5)), Account(0, (-20, 5)))
        without = clear_rational_cohort(accounts)
        self.assertEqual(without.rates, (Fraction(1, 4), 1))
        self.assertEqual(without.link_payments, (5, 5))
        self.assertEqual(without.cash_entitlements, (0, 0))
        self.assertEqual(without.creditor_impairments, ((15, 0), (0, 0)))
        insured = clear_rational_cohort(accounts, insurance=(10, 99))
        self.assertEqual(insured.rates, (Fraction(3, 4), 1))
        self.assertEqual(insured.link_payments, (5, 5))
        self.assertEqual(insured.cash_entitlements, (10, 0))
        self.assertEqual(insured.insurance_spent, (10, 0))

    def test_cycle_with_external_creditors_uses_both_complete_market_cohorts(self):
        accounts = (Account(0, (100, -100)), Account(0, (-100, 100)),
                    Account(0, (50, 0)), Account(0, (0, 50)),
                    Account(10, (-50, 0)), Account(0, (0, -50)))
        result = clear_rational_cohort(accounts)
        self.assertEqual(result.rates, (Fraction(3, 25), Fraction(2, 25)))
        self.assertEqual(result.link_payments, (12, 8))
        self.assertEqual(result.cash_entitlements, (0, 0, 6, 4, 0, 0))
        self.assertEqual(result.creditor_impairments, ((88, 0), (0, 92), (44, 0),
                                                       (0, 46), (0, 0), (0, 0)))

    def test_closed_form_family_matches_every_small_funded_cycle(self):
        # Solve the symmetric two-equation system on paper:
        # (k+e)*r_btc - k*r_eth = b_btc, and vice versa.
        # This 378-case oracle does not use solver segments or fixed-point loops.
        checked = 0
        for linked_claim in range(1, 8):
            for external_claim in range(1, 5):
                for btc_cash in range(external_claim + 1):
                    for eth_cash in range(external_claim + 1):
                        accounts = (Account(0, (linked_claim, -linked_claim)),
                                    Account(0, (-linked_claim, linked_claim)),
                                    Account(0, (external_claim, 0)), Account(0, (0, external_claim)),
                                    Account(btc_cash, (-external_claim, 0)),
                                    Account(eth_cash, (0, -external_claim)))
                        denominator = external_claim * (2 * linked_claim + external_claim)
                        expected = (Fraction((linked_claim + external_claim) * btc_cash +
                                             linked_claim * eth_cash, denominator),
                                    Fraction(linked_claim * btc_cash +
                                             (linked_claim + external_claim) * eth_cash, denominator))
                        result = clear_rational_cohort(accounts)
                        self.assertEqual(result.rates, expected)
                        self.assertEqual(result.cash_entitlements,
                                         (0, 0, external_claim * expected[0],
                                          external_claim * expected[1], 0, 0))
                        checked += 1
        self.assertEqual(checked, 378)

    def test_near_closed_cycle_does_not_depend_on_an_iteration_timeout(self):
        linked_claim = 1_000_000_000_000
        accounts = (Account(0, (linked_claim, -linked_claim)),
                    Account(0, (-linked_claim, linked_claim)),
                    Account(0, (1, 0)), Account(0, (0, 1)),
                    Account(1, (-1, 0)), Account(0, (0, -1)))
        result = clear_rational_cohort(accounts)
        self.assertEqual(result.rates, (Fraction(1_000_000_000_001, 2_000_000_000_001),
                                        Fraction(1_000_000_000_000, 2_000_000_000_001)))
        self.assertEqual(sum(result.cash_entitlements), 1)
        self.assertLessEqual(result.segment_pairs, 9)

    def test_fractional_source_claims_keep_exact_owner_entitlements(self):
        accounts = (Account(0, (Fraction(7, 10), -Fraction(3, 10))),
                    Account(1, (-Fraction(7, 10), 0)), Account(0, (0, Fraction(3, 10))))
        result = clear_rational_cohort(accounts)
        self.assertEqual(result.cash_entitlements, (Fraction(2, 5), Fraction(3, 10), Fraction(3, 10)))
        self.assertEqual(result.link_payments, (Fraction(3, 10),))
        self.assertEqual(result.insurance_spent, (0, 0))
        self.assertTrue(result.has_fractional_cash_effects)

    def test_integer_inputs_can_require_non_executable_fractional_insurance(self):
        # This is the reason rational success cannot close the atom-finalization gate.
        accounts = (Account(0, (2, -1)), Account(0, (1, 0)),
                    Account(0, (-3, 0)), Account(0, (0, 1)))
        result = clear_rational_cohort(accounts, insurance=(1, 1))
        self.assertEqual(result.rates, (Fraction(1, 3), 1))
        self.assertEqual(result.insurance_spent, (1, Fraction(1, 3)))
        self.assertEqual(result.cash_entitlements, (0, Fraction(1, 3), 0, 1))
        self.assertTrue(result.has_fractional_cash_effects)
        self.assertEqual(sum(result.cash_entitlements), Fraction(4, 3))
        # Naively flooring only I while keeping the ideal payout would create cash.
        rounded_insurance = tuple(value.numerator // value.denominator for value in result.insurance_spent)
        self.assertEqual(sum(result.cash_entitlements) - sum(rounded_insurance), Fraction(1, 3))

    def test_registry_order_does_not_change_exact_economic_entitlement(self):
        accounts = (Account(0, (3, -2)), Account(1, (-3, 0)), Account(0, (0, 2)))
        # BTC recovers one of three atoms. That entire atom services the cross
        # account's two-atom ETH debt; only the ETH creditor receives cash.
        expected_cash = (0, 0, 1)
        for order in permutations(range(3)):
            result = clear_rational_cohort(tuple(accounts[index] for index in order))
            self.assertEqual(result.cash_entitlements, tuple(expected_cash[index] for index in order))
            self.assertEqual(result.rates, (Fraction(1, 3), Fraction(1, 2)))

    def test_zero_claim_account_retains_funded_cash_and_reserves(self):
        result = clear_rational_cohort((Account(42, (0, 0)),), insurance=(3, 5), fees=(7, 11))
        self.assertEqual(result.rates, (1, 1))
        self.assertEqual(result.cash_entitlements, (42,))
        self.assertEqual(result.insurance_spent, (0, 0))
        self.assertEqual(result.links, ())

    def test_swapping_market_labels_does_not_change_account_entitlements(self):
        accounts = (Account(1, (5, -4)), Account(0, (-2, 3)),
                    Account(1, (-3, 0)), Account(0, (0, 1)))
        original = clear_rational_cohort(accounts, insurance=(1, 2), fees=(7, 11))
        swapped = clear_rational_cohort(tuple(Account(account.cash, account.claims[::-1])
                                              for account in accounts), insurance=(2, 1), fees=(11, 7))
        self.assertEqual(swapped.cash_entitlements, original.cash_entitlements)
        self.assertEqual(swapped.rates, original.rates[::-1])
        self.assertEqual(swapped.insurance_spent, original.insurance_spent[::-1])

    def test_maximum_cohort_and_capped_branch_budget(self):
        accounts = []
        for amount in range(1, 33):
            positive, negative = (amount, amount + 1) if amount % 2 else (amount + 1, amount)
            accounts.extend((Account(0, (positive, -negative)), Account(0, (-positive, negative))))
        result = clear_rational_cohort(tuple(accounts))
        self.assertEqual(len(result.cash_entitlements), 64)
        self.assertEqual(sum(result.cash_entitlements), 0)
        self.assertLessEqual(result.segment_pairs, 1156)
        with self.assertRaises(InvalidTransition):
            clear_rational_cohort(tuple(accounts) + (Account(0, (0, 0)),))

    def test_incomplete_or_fabricated_market_ledger_rejects(self):
        for clear in (clear_rational_cohort, clear_atom_cohort):
            for accounts, pools in (((Account(0, (100, -100)),), (0, 0)),
                                    ((Account(0, (0, 0)),), (1, 0)), ((), (0, 0))):
                with self.subTest(model=clear.__name__, accounts=accounts, pools=pools), \
                        self.assertRaises(InvalidTransition):
                    clear(accounts, pools=pools)
            for insurance in ((0.5, 0), [1, 1], (True, 1)):
                with self.subTest(model=clear.__name__, insurance=insurance), self.assertRaises(InvalidTransition):
                    clear((Account(0, (0, 0)),), insurance=insurance)


class AtomFinalizationContract(unittest.TestCase):
    def test_fractional_insurance_counterexample_gets_a_conserved_whole_atom_plan(self):
        accounts = (Account(0, (2, -1)), Account(0, (1, 0)),
                    Account(0, (-3, 0)), Account(0, (0, 1)))
        result = clear_atom_cohort(accounts, insurance=(1, 1))
        self.assertEqual(result.cash, (0, 0, 0, 1))
        self.assertEqual(result.insurance_spent, (1, 0))
        self.assertEqual(result.effective_insurance_budgets, (1, 0))
        self.assertEqual(result.insurance_passes, 2)
        self.assertEqual(result.claim_cash_movements, ((1, -1), (0, 0), (0, 0), (0, 1)))
        self.assertEqual(result.rounding_adjustments,
                         ((Fraction(1, 3), -Fraction(1, 3)), (-Fraction(1, 3), 0),
                          (0, 0), (0, Fraction(1, 3))))

    def test_independent_market_rounding_cannot_take_the_other_markets_pool(self):
        accounts = (Account(0, (Fraction(1, 2), 0)), Account(0, (Fraction(1, 2), 0)),
                    Account(0, (0, Fraction(1, 2))), Account(0, (0, Fraction(1, 2))))
        result = clear_atom_cohort(accounts, pools=(1, 1))
        self.assertEqual(result.cash, (1, 0, 1, 0))
        self.assertEqual(result.claim_cash_movements, ((1, 0), (0, 0), (0, 1), (0, 0)))
        self.assertEqual(tuple(sum(row[market] for row in result.rounding_adjustments)
                               for market in range(2)), (0, 0))

    def test_larger_remainder_wins_a_single_unlinked_market_atom(self):
        accounts = (Account(0, (Fraction(2, 5), 0)), Account(0, (Fraction(3, 5), 0)))
        result = clear_atom_cohort(accounts, pools=(1, 0))
        self.assertEqual(result.cash, (0, 1))
        self.assertEqual(result.rounding_adjustments, ((-Fraction(2, 5), 0), (Fraction(2, 5), 0)))

    def test_cashless_fractional_cycle_never_creates_a_cash_payout(self):
        accounts = (Account(0, (Fraction(3, 5), -Fraction(3, 5))),
                    Account(0, (-Fraction(3, 5), Fraction(3, 5))))
        result = clear_atom_cohort(accounts, insurance=(7, 11))
        self.assertEqual(result.cash, (0, 0))
        self.assertEqual(result.insurance_spent, (0, 0))
        self.assertEqual(result.insurance_passes, 1)

    def test_integral_selected_policy_examples_do_not_change(self):
        accounts = (Account(100, (-80, -80)), Account(0, (80, 0)), Account(0, (0, 80)))
        result = clear_atom_cohort(accounts, insurance=(20, 10), fees=(60, 0))
        self.assertEqual(result.cash, (0, 70, 60))
        self.assertEqual(result.insurance_spent, (20, 10))
        self.assertEqual(result.rounding_adjustments, ((0, 0),) * 3)
        self.assertEqual(result.augmentations, 0)

    def test_unpaid_opposite_profit_cannot_release_cash_that_covers_own_loss(self):
        accounts = (Account(100, (100, -100)), Account(0, (-100, 0)), Account(0, (0, 100)))
        result = clear_atom_cohort(accounts)
        self.assertEqual(result.benchmark.collections, ((0, 100), (0, 0), (0, 0)))
        self.assertEqual(result.cash, (0, 0, 100))
        self.assertEqual(result.insurance_spent, (0, 0))
        self.assertEqual(result.claim_cash_movements, ((0, -100), (0, 0), (0, 100)))

    def test_healthy_funded_cash_is_not_a_rounding_reserve(self):
        accounts = (Account(100, (0, 0)), Account(0, (Fraction(2, 5), 0)),
                    Account(0, (Fraction(3, 5), 0)))
        result = clear_atom_cohort(accounts, pools=(1, 0), insurance=(9, 13), fees=(7, 11))
        self.assertEqual(result.cash, (100, 0, 1))
        self.assertEqual(result.insurance_spent, (0, 0))
        self.assertEqual(result.claim_cash_movements[0], (0, 0))

    def test_fractional_debts_and_receivables_have_explicit_zero_sum_adjustments(self):
        accounts = (Account(0, (Fraction(7, 10), -Fraction(3, 10))),
                    Account(1, (-Fraction(7, 10), 0)), Account(0, (0, Fraction(3, 10))))
        result = clear_atom_cohort(accounts)
        self.assertEqual(result.cash, (0, 1, 0))
        self.assertTrue(all(type(amount) is int for amount in result.cash))
        for market in range(2):
            self.assertEqual(sum(row[market] for row in result.rounding_adjustments), 0)
        for actual, ideal in zip(result.cash, result.benchmark.cash_entitlements):
            self.assertLess(abs(actual - ideal), 1)

    def test_sub_atom_debts_do_not_authorize_rounding_up_funded_cash_collection(self):
        accounts = (Account(1, (-Fraction(1, 2), 0)), Account(1, (-Fraction(1, 2), 0)),
                    Account(0, (1, 0)))
        result = clear_atom_cohort(accounts)
        self.assertEqual(result.cash, (1, 1, 0))
        self.assertEqual(result.benchmark.collections, ((0, 0),) * 3)
        self.assertEqual(result.benchmark.creditor_impairments, ((0, 0), (0, 0), (1, 0)))
        self.assertEqual(result.benchmark.debtor_writeoffs,
                         ((Fraction(1, 2), 0), (Fraction(1, 2), 0), (0, 0)))

    def test_fractional_reserve_coupling_terminates_after_both_markets_clip(self):
        accounts = (Account(2, (0, 0)), Account(2, (Fraction(2, 5), Fraction(1, 5))),
                    Account(1, (-Fraction(3, 5), Fraction(3, 5))),
                    Account(2, (Fraction(1, 5), -Fraction(4, 5))))
        # Full recovery first needs ETH insurance 3/5 (floor to zero). At the
        # next rates (1,1/4), BTC needs 9/20 (floor to zero). The third evaluation
        # has rates (0,0), uses no I and retains all cash below whole debt units.
        first = clear_rational_cohort(accounts, insurance=(1, 1), whole_cash_collection=True)
        second = clear_rational_cohort(accounts, insurance=(1, 0), whole_cash_collection=True)
        self.assertEqual(first.insurance_spent, (0, Fraction(3, 5)))
        self.assertEqual(second.rates, (1, Fraction(1, 4)))
        self.assertEqual(second.insurance_spent, (Fraction(9, 20), 0))
        result = clear_atom_cohort(accounts, insurance=(1, 1))
        self.assertEqual(result.insurance_passes, 3)
        self.assertEqual(result.effective_insurance_budgets, (0, 0))
        self.assertEqual(result.insurance_spent, (0, 0))
        self.assertEqual(result.cash, (2, 2, 1, 2))

    def test_every_small_cyclic_history_has_a_bounded_conserved_atom_plan(self):
        checked = 0
        for linked in range(1, 8):
            for external in range(1, 5):
                for btc_cash in range(external + 1):
                    for eth_cash in range(external + 1):
                        accounts = (Account(0, (linked, -linked)), Account(0, (-linked, linked)),
                                    Account(0, (external, 0)), Account(0, (0, external)),
                                    Account(btc_cash, (-external, 0)), Account(eth_cash, (0, -external)))
                        result = clear_atom_cohort(accounts)
                        self.assertEqual(sum(result.cash), btc_cash + eth_cash)
                        self.assertEqual(result.cash[:2], (0, 0))
                        self.assertEqual(result.insurance_spent, (0, 0))
                        self.assertLessEqual(result.insurance_passes, 3)
                        self.assertLessEqual(result.augmentations, 18)
                        for market in range(2):
                            self.assertEqual(sum(row[market] for row in result.rounding_adjustments), 0)
                        checked += 1
        self.assertEqual(checked, 378)

    def test_maximum_cohort_preserves_cashless_flow_and_augmentation_bound(self):
        accounts = []
        for amount in range(1, 33):
            positive, negative = (amount, amount + 1) if amount % 2 else (amount + 1, amount)
            accounts.extend((Account(0, (positive, -negative)), Account(0, (-positive, negative))))
        result = clear_atom_cohort(tuple(accounts))
        self.assertEqual(result.cash, (0,) * 64)
        self.assertEqual(result.insurance_spent, (0, 0))
        self.assertLessEqual(result.augmentations, 192)


if __name__ == "__main__":
    unittest.main(verbosity=2)
