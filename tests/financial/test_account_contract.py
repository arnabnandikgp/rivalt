"""Literal P22B expectations and bounded exact checks; no production-code imports."""

import unittest
from fractions import Fraction
from itertools import product

from account_contract_reference import (
    Account, CommonLedger, InvalidTransition, accrue_claim, apportion_atoms, collect,
    common_default, flat_net, funded_withdraw, market_default_example, pay, risk_equity,
)


class FundedExitContract(unittest.TestCase):
    def test_positive_profit_has_no_margin_credit(self):
        self.assertEqual(risk_equity(1000, (300, -200)), 800)

    def test_reserved_boundary_and_rejected_overspend(self):
        ledger = CommonLedger((Account(1000, (0, -200)), Account(0, (0, 200))))
        result = funded_withdraw(ledger, 0, 200, (0, -200), 500, 100)
        self.assertEqual(result.accounts[0].cash, 800)
        with self.assertRaises(InvalidTransition):
            funded_withdraw(ledger, 0, 201, (0, -200), 500, 100)
        self.assertEqual(ledger.accounts[0].cash, 1000)

    def test_untouched_market_funding_must_be_included(self):
        # A 3-lot ETH position owes 20 atoms/lot since its stored checkpoint.
        pending_debit = 3 * (Fraction(25) - 5)
        ledger = CommonLedger((Account(100, (0, -pending_debit)), Account(0, (0, pending_debit))))
        self.assertEqual(funded_withdraw(ledger, 0, 40, (0, -60)).accounts[0].cash, 60)
        with self.assertRaises(InvalidTransition):
            funded_withdraw(ledger, 0, 41, (0, -60))
        with self.assertRaises(InvalidTransition):
            funded_withdraw(ledger, 0, 100, (0, 0))

    def test_fraction_remains_with_owner(self):
        ledger = CommonLedger((Account(20, (-Fraction(3, 10), Fraction(3, 10))),))
        result = funded_withdraw(ledger, 0, 19, ledger.accounts[0].claims)
        self.assertEqual(result.accounts[0].claims, (Fraction(-3, 10), Fraction(3, 10)))
        with self.assertRaises(InvalidTransition):
            funded_withdraw(ledger, 0, 20, ledger.accounts[0].claims)

    def test_other_insolvency_does_not_change_after_funded_exit(self):
        ledger = CommonLedger((Account(100, (0, 0)), Account(0, (-100, 0)), Account(0, (100, 0))))
        before = common_default(ledger)
        result = funded_withdraw(ledger, 0, 90, (0, 0))
        after = common_default(result)
        self.assertEqual(before[0], (100, 0, 0))
        self.assertEqual(after[0], (10, 0, 0))
        self.assertEqual(before[1:], after[1:])

    def test_missing_dependency_vector_rejects(self):
        with self.assertRaises(InvalidTransition):
            risk_equity(100, (0,))

    def test_float_inputs_are_not_settlement_values(self):
        with self.assertRaises(InvalidTransition):
            Account(1, (0.1, -0.1))
        with self.assertRaises(InvalidTransition):
            risk_equity(1, (0.1, 0))

    def test_relevant_changed_liability_rejects_old_amount(self):
        before = CommonLedger((Account(100, (-20, 0)), Account(0, (20, 0))))
        after = CommonLedger((Account(100, (-21, 0)), Account(0, (21, 0))))
        funded_withdraw(before, 0, 80, (-20, 0))
        with self.assertRaises(InvalidTransition):
            funded_withdraw(after, 0, 80, (-21, 0))

    def test_all_held_funding_corners_survive_withdrawal(self):
        ledger = CommonLedger((Account(110, (-60, 60)), Account(0, (60, -60))))
        # Both diagonal snapshots are solvent at C_after=100, but their adverse
        # mixed corner (-60,-60) is not. A current-only cash check would miss it.
        self.assertEqual(risk_equity(100, (-60, 60)), 40)
        self.assertEqual(risk_equity(100, (60, -60)), 40)
        with self.assertRaises(InvalidTransition):
            funded_withdraw(ledger, 0, 10, (-60, 60),
                            funding_endpoint_claims=((-60, 60), (60, -60)))
        funded = CommonLedger((Account(140, (-60, 60)), Account(0, (60, -60))))
        result = funded_withdraw(funded, 0, 10, (-60, 60),
                                 funding_endpoint_claims=((-60, 60), (60, -60)))
        self.assertEqual(result.accounts[0].cash, 130)

    def test_incomplete_funding_window_rejects(self):
        ledger = CommonLedger((Account(10, (0, 0)),))
        with self.assertRaises(InvalidTransition):
            funded_withdraw(ledger, 0, 1, (0, 0), funding_endpoint_claims=((0, 0),))

    def test_materialized_prefix_must_not_revert_after_hold_expires(self):
        after_five_seconds = accrue_claim(3, 0, 0, 5)
        self.assertEqual(after_five_seconds, -15)
        # Persisting the consumed prefix keeps the debit after hold expiry.
        self.assertEqual(accrue_claim(3, after_five_seconds, 5, 5), -15)
        # This is the counterexample, not an allowed rollback transition:
        self.assertEqual(accrue_claim(3, after_five_seconds, 5, 0), 0)

    def test_signed_funding_and_split_accrual_retain_fractional_ownership(self):
        first = accrue_claim(3, 0, 0, Fraction(1, 10))
        split = accrue_claim(3, first, Fraction(1, 10), Fraction(3, 10))
        whole = accrue_claim(3, 0, 0, Fraction(3, 10))
        self.assertEqual(split, Fraction(-9, 10))
        self.assertEqual(split, whole)
        self.assertEqual(accrue_claim(0, split, Fraction(3, 10), -2), Fraction(-9, 10))
        # Preserve funding history, not a numeric max(F): negative premiums are valid.
        self.assertEqual(accrue_claim(3, 0, 0, Fraction(-1, 10)), Fraction(3, 10))

    def test_exhaustive_admitted_exits_preserve_full_negative_claim_backing(self):
        admitted = rejected = 0
        # 23,328 cases, including thirds of atoms. This is a finite model check,
        # not a general proof of oracle, concurrency or integer-overflow safety.
        for cash, first, second, required, amount in product(
                range(6), range(-4, 5), range(-4, 5), range(4), range(1, 13)):
            claims = (Fraction(first, 3), Fraction(second, 3))
            ledger = CommonLedger((Account(cash, claims), Account(0, tuple(-value for value in claims))))
            should_admit = amount <= cash and cash - amount >= required + sum(max(-claim, 0) for claim in claims)
            if not should_admit:
                with self.assertRaises(InvalidTransition):
                    funded_withdraw(ledger, 0, amount, claims, reserved=required)
                rejected += 1
                continue
            result = funded_withdraw(ledger, 0, amount, claims, reserved=required)
            self.assertGreaterEqual(result.accounts[0].cash, sum(max(-claim, 0) for claim in claims))
            self.assertEqual(result.accounts[1], ledger.accounts[1])
            self.assertEqual((result.pool, result.insurance, result.fees), (0, 0, 0))
            self.assertEqual(result.allocated, ledger.allocated - amount)
            admitted += 1
        self.assertEqual(admitted + rejected, 23_328)
        self.assertGreater(admitted, 0)
        self.assertGreater(rejected, 0)


class ProfitAndDefaultContract(unittest.TestCase):
    def test_collection_payment_and_exit_are_distinct(self):
        ledger = CommonLedger((Account(100, (-40, 0)), Account(0, (40, 0))))
        with self.assertRaises(InvalidTransition):
            pay(ledger, 1, 0, 40)
        funded = collect(ledger, 0, 0, 40)
        self.assertEqual((funded.accounts[1].cash, funded.pool), (0, 40))
        paid = pay(funded, 1, 0, 40)
        self.assertEqual((paid.accounts[1].cash, paid.pool, paid.allocated), (40, 0, 100))
        exited = funded_withdraw(paid, 1, 40, (0, 0))
        self.assertEqual(exited.allocated, 60)

    def test_unrelated_market_loss_changes_payout_under_common_default(self):
        accounts = (Account(100, (-100, 0)), Account(0, (100, 0)),
                    Account(0, (0, -100)), Account(0, (0, 100)))
        self.assertEqual(common_default(CommonLedger(accounts))[0], (0, 50, 0, 50))
        self.assertEqual(market_default_example(accounts)[0], (0, 100, 0, 0))

    def test_shared_debtor_cannot_pay_full_claims_in_both_markets(self):
        accounts = (Account(100, (-80, -80)), Account(0, (80, 0)), Account(0, (0, 80)))
        self.assertEqual(common_default(CommonLedger(accounts))[0], (0, 50, 50))
        self.assertEqual(market_default_example(accounts)[0], (0, 50, 50))

    def test_payment_timing_changes_remaining_creditors(self):
        ledger = CommonLedger((Account(0, (50, 0)), Account(0, (50, 0)), Account(0, (-50, 0))), pool=50)
        self.assertEqual(common_default(ledger)[0], (25, 25, 0))
        paid = pay(ledger, 0, 0, 50)
        self.assertEqual(common_default(paid)[0], (50, 0, 0))
        # The unsafe policy change would be permitting the payment, not this exit.
        # V2's complete-cohort gain certificate rejects the insolvent pre-state.
        exited = funded_withdraw(paid, 0, 50, (0, 0))
        self.assertEqual(common_default(exited)[0], (0, 0, 0))
        self.assertEqual(exited.accounts[1:], paid.accounts[1:])

    def test_insurance_and_fees_have_distinct_owners(self):
        ledger = CommonLedger((Account(20, (-100, 0)), Account(100, (60, 0)), Account(100, (40, 0))),
                              insurance=30, fees=7)
        self.assertEqual(common_default(ledger), ((0, 130, 120), (0, 30, 20), 30))
        self.assertEqual(ledger.allocated, 257)

    def test_exact_fractional_default_and_stable_atom_tie(self):
        ledger = CommonLedger((Account(0, (-Fraction(3, 5), 0)),
                               Account(0, (Fraction(4, 5), 0)), Account(0, (Fraction(4, 5), 0))), pool=1)
        self.assertEqual(common_default(ledger), ((0, 1, 0), (0, 1, 0), 0))
        self.assertEqual(apportion_atoms(1, (Fraction(1, 2), Fraction(1, 2))), (1, 0))

    def test_simple_market_example_refuses_to_fake_general_default(self):
        with self.assertRaises(InvalidTransition):
            market_default_example((Account(0, (100, -100)), Account(0, (-100, 100))))


class CrossMarketNettingContract(unittest.TestCase):
    def test_common_setoff_conserves_total_but_not_separate_market_identities(self):
        ledger = CommonLedger((Account(0, (100, -100)), Account(0, (-100, 0)), Account(0, (0, 100))))
        netted = flat_net(ledger, 0)
        self.assertEqual(netted.accounts[0].claims, (0, 0))
        self.assertEqual(tuple(sum(account.claims[market] for account in netted.accounts)
                               for market in range(2)), (-100, 100))
        self.assertEqual(netted.allocated, 0)
        with self.assertRaises(InvalidTransition):
            market_default_example(netted.accounts)

    def test_funded_setoff_can_reallocate_real_pool_cash(self):
        # Source BTC debtor has already paid 100; it is not a free pool injection.
        ledger = CommonLedger((Account(0, (100, -100)), Account(0, (0, 100))), pool=100)
        paid = pay(ledger, 0, 0, 100)
        collected = collect(paid, 0, 1, 100)
        self.assertEqual(collected.accounts[0], Account(0, (0, 0)))
        self.assertEqual(tuple(sum(account.claims[market] for account in collected.accounts)
                               for market in range(2)), (0, 100))
        self.assertEqual(collected.allocated, 100)

    def test_a_complete_closed_cycle_can_cancel_without_creating_cash(self):
        # Simultaneous multi-account clearing is mathematically possible. It is
        # NOT the existing single-owner netting instruction or an implemented path.
        ledger = CommonLedger((Account(0, (100, -100)), Account(0, (-100, 100))))
        netted = flat_net(flat_net(ledger, 0), 1)
        self.assertEqual(netted.accounts, (Account(0, (0, 0)), Account(0, (0, 0))))
        self.assertEqual(tuple(sum(account.claims[market] for account in netted.accounts)
                               for market in range(2)), (0, 0))
        self.assertEqual(netted.allocated, 0)

    def test_fractional_netting_keeps_remaining_entitlement(self):
        ledger = CommonLedger((Account(0, (Fraction(7, 10), -Fraction(3, 10))),
                               Account(0, (-Fraction(4, 10), 0))))
        self.assertEqual(flat_net(ledger, 0).accounts[0].claims, (Fraction(2, 5), 0))


if __name__ == "__main__":
    unittest.main(verbosity=2)
