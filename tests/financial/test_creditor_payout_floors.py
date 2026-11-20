"""Independent atom allocations for D117 and matched controls through native Rust."""
from fractions import Fraction
from itertools import product
from math import ceil, floor
import unittest

from account_contract_reference import Account, InvalidTransition
from clearing_network_reference import InfeasiblePayoutFloor, clear_atom_cohort
from cross_market_adl_model import compare, market_losses
from market_settlement_reference import MarketBook
from settlement_liquidation_model import MarketSnapshot, paired_reduction, terminal
from test_scalable_settlement import decode, frozen_book_command, run


def linked_creditors():
    book = MarketBook((Account(5, (-10, 0)), Account(0, (2, 0)), Account(0, (8, -9)),
                       Account(0, (0, 5)), Account(0, (0, 3)), Account(0, (0, 1))), frozen=True)
    return MarketSnapshot(book, (-1, 1, 0, 0, 0, 0), 100, (98, 98, None, None, None, None))


def fractional_debtors():
    book = MarketBook((Account(1, (-4, -2)), Account(0, (3, 0)), Account(2, (-3, -2)),
                       Account(0, (4, 0)), Account(0, (0, 4))), frozen=True)
    return MarketSnapshot(book, (-1, 1, 0, 0, 0), 100, (97, 97, None, None, None))


class CreditorPayoutFloors(unittest.TestCase):
    def test_single_market_residual_rounding_can_move_an_atom_between_flat_creditors(self):
        original = MarketBook((Account(3, (-6, 0)), Account(0, (2, 0)),
                               Account(0, (1, 0)), Account(0, (3, 0))), frozen=True)
        before = MarketSnapshot(original, (-1, 1, 0, 0), 100, (101, 99, None, None))
        after, fills = paired_reduction(before, 0, 1, 1, 1)
        self.assertEqual(fills, ((1, 99),))
        for book, expected in [(original, (0, 1, 1, 1)), (after.book, (0, 1, 0, 2))]:
            self.assertEqual(terminal(book).cash, expected)
            self.assertEqual(decode(run([frozen_book_command(book)])[0])['cash'], expected)
        self.assertEqual(terminal(after.book).benchmark.cash_entitlements[2], Fraction(3, 5))
        # Applying an extra same-market floor would change who receives the atom.
        alternative = clear_atom_cohort(after.book.accounts, creditor_floors={(2, 0): 1, (3, 0): 1})
        self.assertEqual(alternative.cash, (0, 0, 1, 2))

    def test_larger_market_payout_can_reduce_one_creditors_cash(self):
        state = linked_creditors()
        full, _ = paired_reduction(state, 0, 1, 2, 2)
        before, after = terminal(state.book), terminal(full.book)
        self.assertEqual((before.benchmark.rates[1], after.benchmark.rates[1]), (Fraction(4, 9), Fraction(5, 9)))
        self.assertEqual((before.cash[3:], after.cash[3:]), ((2, 1, 1), (3, 2, 0)))
        self.assertEqual((market_losses(before), market_losses(after)), ((5, 5), (3, 4)))
        self.assertEqual(before.insurance_spent, after.insurance_spent)

    def test_two_feasible_policies_protect_each_creditor(self):
        state = linked_creditors()
        canonical = compare(state, 0, (0, 2, 0, 0, 0, 0), ordinary_rounding_only=True)
        protected = compare(state, 0, (0, 2, 0, 0, 0, 0))
        self.assertEqual((canonical.charges, canonical.payout.cash), ((1,), (0, 1, 0, 2, 1, 1)))
        self.assertEqual((protected.charges, protected.payout.cash), ((2,), (0, 0, 0, 3, 1, 1)))
        self.assertEqual((canonical.lots, protected.lots), (1, 1))
        self.assertEqual((canonical.payout.insurance_spent, protected.payout.insurance_spent), ((0, 0), (0, 0)))
        self.assertEqual(protected.payout.claim_cash_movements[2], (5, -5))

    def test_freeze_retains_each_debtors_fractional_ownership_until_joint_rounding(self):
        state = fractional_debtors()
        result = compare(state, 0, (0, 3, 0, 0, 0), pin_cash=True, protect_eth=True)
        self.assertEqual(result.charges, (3,))
        owned = result.payout.benchmark.collections
        self.assertEqual((owned[0], owned[2]), ((Fraction(2, 3), Fraction(1, 3)), (Fraction(6, 5), Fraction(4, 5))))
        self.assertEqual(result.payout.cash, (0, 0, 0, 2, 1))
        self.assertEqual(result.payout.claim_cash_movements, ((-1, 0), (0, 0), (-1, -1), (2, 0), (0, 1)))
        self.assertEqual((result.book.pools, state.book.vault), ((0, 0), 3))
        self.assertEqual(result.payout.benchmark.rates, (Fraction(7, 15), Fraction(17, 60)))

    def test_unchanged_eth_rate_insurance_and_total_can_hide_a_transfer(self):
        # The two positive ETH claims are 1.5 and 5.5. Both 1/6 and 2/5
        # pay exactly seven. The second creditor has a separate BTC debt.
        rows = ((3, -8, 3), (2, 4, -3), (2, 4, -7), (1, 3, -4), (1, -3, 11))
        book = MarketBook(tuple(Account(cash, (btc, Fraction(eth_twice, 2)))
                                for cash, btc, eth_twice in rows), frozen=True)
        state = MarketSnapshot(book, (-1, 1, 0, 0, 0), 100, (99, 99, None, None, None))
        charged, _ = paired_reduction(state, 0, 1, 1, 1)
        for line, candidate, expected in zip(run([frozen_book_command(book), frozen_book_command(charged.book)]),
                                             (book, charged.book), ((1, 6), (2, 5)), strict=True):
            plan = terminal(candidate)
            native = decode(line)
            self.assertEqual((plan.benchmark.rates[1], native['spent']), (1, (0, 0)))
            self.assertEqual(tuple(native['movements'][index][1] for index in (0, 4)), expected)
            self.assertEqual(plan.claim_cash_movements, native['movements'])
        result = compare(state, 0, (0, 1, 0, 0, 0), pin_cash=True, protect_eth=True)
        self.assertEqual(result.charges, (1,))
        self.assertEqual(tuple(result.payout.claim_cash_movements[i][1] for i in (0, 4)), (1, 6))

    def test_lower_bounds_must_be_fundable_together_and_respect_the_claim(self):
        rows = (Account(1, (0, -3)), *(Account(0, (0, 1)) for _ in range(3)))
        with self.assertRaisesRegex(InfeasiblePayoutFloor, "funded together"):
            clear_atom_cohort(rows, creditor_floors={(1, 1): 1, (2, 1): 1})
        with self.assertRaisesRegex(InfeasiblePayoutFloor, "exceeds"):
            clear_atom_cohort(rows, creditor_floors={(1, 1): 2})
        with self.assertRaisesRegex(InvalidTransition, "invalid creditor"):
            clear_atom_cohort(rows, creditor_floors={(0, 1): 1})

    def test_frozen_collections_cannot_overdraw_or_lose_cash(self):
        rows = fractional_debtors().book.accounts
        original = terminal(fractional_debtors().book).benchmark.collections
        for invalid in ((0, 0), (2, -1), (Fraction(3, 4), Fraction(3, 4))):
            with self.assertRaisesRegex(InvalidTransition, "allocation exceeds"):
                clear_atom_cohort(rows, frozen_collections=(invalid, *original[1:]))

    def test_atom_floors_against_enumeration_of_all_three_creditor_payouts(self):
        # Independent feasibility oracle: try every floor/ceil triple and keep
        # those that conserve available cash and protect every previous payout.
        for claims in product(range(1, 6), repeat=3):
            debt = sum(claims)
            creditors = tuple(Account(0, (0, claim)) for claim in claims)
            for available in range(debt):
                baseline = clear_atom_cohort((Account(available, (0, -debt)), *creditors))
                owed = tuple(Fraction(claim * (available + 1), debt) for claim in claims)
                choices = tuple({floor(ideal), ceil(ideal)} for ideal in owed)
                allowed = {allocation for allocation in product(*choices)
                           if sum(allocation) == available + 1 and
                           all(paid >= minimum for paid, minimum in zip(allocation, baseline.cash[1:]))}
                floors = {(index, 1): cash for index, cash in enumerate(baseline.cash) if index}
                rows = (Account(available + 1, (0, -debt)), *creditors)
                if allowed:
                    self.assertIn(clear_atom_cohort(rows, creditor_floors=floors).cash[1:], allowed)
                else:
                    with self.assertRaises(InfeasiblePayoutFloor):
                        clear_atom_cohort(rows, creditor_floors=floors)

    def test_native_ordinary_rounding_and_fractional_controls(self):
        state = linked_creditors()
        partial, _ = paired_reduction(state, 0, 1, 2, 1)
        full, _ = paired_reduction(state, 0, 1, 2, 2)
        fractions = fractional_debtors()
        after, _ = paired_reduction(fractions, 0, 1, 3, 3)
        books = (state.book, partial.book, full.book, fractions.book, after.book)
        expected = ((0, 1, 0, 2, 1, 1), (0, 1, 0, 2, 1, 1), (0, 0, 0, 3, 2, 0),
                    (0, 1, 0, 1, 1), (0, 0, 0, 1, 2))
        for line, cash in zip(run([frozen_book_command(book) for book in books]), expected, strict=True):
            result = decode(line)
            self.assertEqual((result['cash'], result['spent']), (cash, (0, 0)))


if __name__ == "__main__":
    unittest.main()
