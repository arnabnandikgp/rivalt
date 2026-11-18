"""Independent literal expectations and matched native current-policy settlements."""
from dataclasses import replace
from fractions import Fraction
import unittest

from account_contract_reference import Account, InvalidTransition
from market_settlement_reference import MarketBook, collect, pay
from settlement_liquidation_model import (
    MarketSnapshot, compare_open_priority, cross_default, ordinary_close, shortfall, takeover, terminal,
)
from test_scalable_settlement import decode, frozen_book_command, run


def book_from_claims(claims):
    return MarketBook(tuple(Account(0, pair) for pair in claims), frozen=True)


def mixed_cross_debt():
    return MarketBook((Account(30, (-50, 20)), Account(20, (0, -20)), Account(0, (50, 0))),
                      frozen=True)


def fractional_debt():
    return MarketBook((Account(1, (-Fraction(3, 2), 0)), Account(0, (Fraction(9, 10), 0)),
                       Account(0, (Fraction(3, 5), 0))), insurance=(0, 7), frozen=True)


class SettlementPolicyComparison(unittest.TestCase):
    def test_open_maker_close_collection_and_price_reversal(self):
        stages = ordinary_close()
        for name, cash, claims, pool in (
            ("closed", (100, 100, 100), (20, -20, 0), 0),
            ("collected", (100, 80, 100), (20, 0, 0), 20),
            ("paid", (120, 80, 100), (0, 0, 0), 0),
        ):
            state = stages[name]
            self.assertEqual(state.lots, (0, -1, 1))
            self.assertEqual(tuple(a.cash for a in state.book.accounts), cash)
            self.assertEqual(tuple(a.claims[0] for a in state.book.accounts), claims)
            self.assertEqual((state.book.pools[0], state.book.vault), (pool, 300))
        with self.assertRaises(InvalidTransition):
            pay(stages["closed"].book, 0, 0, 20)
        with self.assertRaises(InvalidTransition):
            collect(stages["paid"].book, 1, 0, 20)
        reversed_price = stages["paid"].reprice(80)
        self.assertEqual(tuple(a.claims[0] for a in reversed_price.book.accounts), (0, 20, -20))
        self.assertEqual(reversed_price.book.accounts[0].cash, 120)

    def test_payment_timing_and_frozen_price(self):
        # Both branches start fully backed at 80. Deferring a payment changes which
        # claims are still unpaid when a later price move triggers the default.
        book = MarketBook((Account(80, (-80, 0)), Account(0, (60, 0)), Account(20, (20, 0))),
                          insurance=(10, 0))
        start = MarketSnapshot(book, (-1, 0, 1), 80)
        early = start.apply_cash(pay(collect(book, 0, 0, 20), 1, 0, 20))
        for state, expected in ((start, (0, 54, 56)), (early, (0, 55, 55))):
            marked = state.reprice(100)
            frozen = replace(marked, book=replace(marked.book, frozen=True))
            result = compare_open_priority(frozen, 0, 2, 60)
            self.assertEqual(result.baseline.cash, expected)
            self.assertEqual(result.candidate.cash, (0, 60, 50))
            for action in (lambda: frozen.reprice(90), lambda: frozen.trade(2, 0, 1, 100),
                           lambda: pay(frozen.book, 1, 0, 1)):
                with self.assertRaises(InvalidTransition):
                    action()

    def test_covered_and_partially_covered_adl(self):
        full = shortfall(40)
        self.assertEqual((full.baseline.cash, full.candidate.cash), ((0, 54, 36), (0, 60, 30)))
        self.assertEqual((full.charge, full.fills, full.after_pair.lots), (10, ((1, 90),), (0, 0, 0)))
        limited = shortfall(6)
        self.assertEqual((limited.charge, limited.fills), (6, ((1, 94),)))
        # Remaining weights are 60:34, so four units divide 120/47 and 68/47.
        self.assertEqual(limited.candidate.benchmark.creditor_impairments,
                         ((0, 0), (Fraction(120, 47), 0), (Fraction(68, 47), 0)))
        self.assertEqual(limited.candidate.cash, (0, 57, 33))
        self.assertEqual(limited.candidate.insurance_spent, (10, 0))

    def test_no_opposite_exposure_empty_and_sufficient_insurance(self):
        no_pair = shortfall(0, flat=True, insurance=0)
        self.assertEqual((no_pair.charge, no_pair.fills, no_pair.candidate.cash), (0, (), (0, 48, 32)))
        insured = shortfall(40, insurance=27)
        self.assertEqual((insured.charge, insured.candidate.insurance_spent, insured.candidate.cash),
                         (0, (20, 0), (0, 60, 40)))

    def test_short_winner_and_integer_prices(self):
        book = shortfall(40).before.book
        result = compare_open_priority(MarketSnapshot(book, (4, 0, -4), 100), 0, 2, 103)
        self.assertEqual(result.fills, ((2, 102), (2, 103)))
        self.assertEqual((result.charge, result.after_pair.lots), (10, (0, 0, 0)))
        self.assertEqual(result.candidate.cash, (0, 60, 30))

    def test_epoch_and_whole_account_eligibility(self):
        state = shortfall(40).before
        with self.assertRaises(InvalidTransition):
            compare_open_priority(replace(state, book=replace(state.book, frozen=False)), 0, 2, 60)
        with self.assertRaises(InvalidTransition):
            collect(replace(cross_default(), frozen=False), 0, 0, 60)
        with self.assertRaises(InvalidTransition):
            compare_open_priority(MarketSnapshot(cross_default(), (-1, 1, 0), 100), 0, 1, 60)

    def test_cross_market_collections_and_no_foreign_insurance(self):
        plan = terminal(cross_default((15, 20)))
        self.assertEqual(plan.benchmark.collections[0], (60, 30))
        self.assertEqual(plan.insurance_spent, (15, 10))
        self.assertEqual(plan.cash, (0, 75, 40))
        self.assertEqual(plan.benchmark.debtor_writeoffs[0], (5, 0))
        self.assertEqual(terminal(cross_default()).cash, (0, 60, 30))

    def test_same_cycle_with_and_without_external_creditor(self):
        cycle = terminal(book_from_claims(((100, -100), (-100, 100))))
        self.assertEqual((cycle.benchmark.rates, cycle.cash), ((1, 1), (0, 0)))
        external = terminal(book_from_claims(((100, -100), (-100, 60), (0, 40))))
        self.assertEqual(external.benchmark.rates, (0, 0))
        self.assertEqual(external.benchmark.creditor_impairments[2], (0, 40))

    def test_collectible_opposite_claim_and_fractional_creditors(self):
        linked = terminal(mixed_cross_debt())
        self.assertEqual(linked.cash, (0, 0, 50))
        self.assertEqual(linked.insurance_spent, (0, 0))
        rounded = terminal(fractional_debt())
        self.assertEqual(rounded.benchmark.rates[0], Fraction(2, 3))
        self.assertEqual(rounded.benchmark.cash_entitlements, (0, Fraction(3, 5), Fraction(2, 5)))
        self.assertEqual((rounded.cash, rounded.insurance_spent), ((0, 1, 0), (0, 0)))

    def test_receiver_fee_progress_and_rollback(self):
        start = MarketSnapshot(MarketBook((Account(45, (0, 0)), Account(100, (0, 0)),
                                            Account(100, (0, 0)))), (10, 0, -10), 100)
        partial, fee = takeover(start, 0, 1, 2, 100, consent=True)
        self.assertEqual((partial.lots, fee), ((8, 2, -10), 1))
        self.assertEqual(tuple(a.cash for a in partial.book.accounts), (44, 101, 100))
        for price, consent in ((96, True), (100, False), (40, True)):
            with self.assertRaises(InvalidTransition):
                takeover(start, 0, 1, 1, price, consent=consent)
        small = replace(start, book=replace(start.book, accounts=(start.book.accounts[0],
                        Account(0, (0, 0)), start.book.accounts[2])))
        with self.assertRaises(InvalidTransition):
            takeover(small, 0, 1, 2, 100, consent=True)
        self.assertEqual(start.book.accounts[0].cash, 45)

    def test_native_frozen_payouts(self):
        # Native verifier receives proposed rates/orders and independently validates them.
        # Includes candidate-adjusted claims only as new frozen inputs to the current kernel.
        cases = [(shortfall(40).before.book, (0, 54, 36), (10, 0)),
                 (shortfall(40).after_pair.book, (0, 60, 30), (10, 0)),
                 (shortfall(6).after_pair.book, (0, 57, 33), (10, 0)),
                 (cross_default(), (0, 60, 30), (0, 0)),
                 (cross_default((15, 20)), (0, 75, 40), (15, 10)),
                 (mixed_cross_debt(), (0, 0, 50), (0, 0)),
                 (fractional_debt(), (0, 1, 0), (0, 0)),
                 (book_from_claims(((100, -100), (-100, 60), (0, 40))), (0, 0, 0), (0, 0))]
        commands = []
        for book, _, _ in cases:
            commands.append(frozen_book_command(book))
        for line, (_, cash, insurance) in zip(run(commands), cases):
            got = decode(line)
            self.assertEqual((got["cash"], got["spent"]), (cash, insurance))


if __name__ == "__main__":
    unittest.main()
