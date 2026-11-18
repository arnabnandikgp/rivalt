"""Independent literal distribution and bounded cross-market forced-close checks."""
from dataclasses import replace
from fractions import Fraction
import unittest

from account_contract_reference import Account, InvalidTransition
from cross_market_adl_model import compare, linked_winner, market_losses, pin_own_cash, shared_cash
from market_settlement_reference import MarketBook
from settlement_liquidation_model import MarketSnapshot, terminal
from test_scalable_settlement import decode, frozen_book_command, run


def choose(case, *, pin=True, protect=True):
    state, gains = case
    return compare(state, 0, gains, pin_cash=pin, protect_eth=protect)


class CrossMarketAttribution(unittest.TestCase):
    def test_same_btc_close_changes_the_destination_of_six_own_cash_atoms(self):
        state, _ = shared_cash()
        self.assertEqual(terminal(state.book).benchmark.collections[0], (60, 30))
        rerun, pinned = choose(shared_cash(), pin=False, protect=False), choose(shared_cash())
        self.assertEqual((rerun.charges, pinned.charges), ((20,), (20,)))
        # After the close the face debts are 60/40. Re-splitting 90 gives 54/36.
        self.assertEqual(rerun.payout.cash, (0, 0, 54, 36))
        self.assertEqual(pinned.payout.cash, (0, 0, 60, 30))
        self.assertEqual((market_losses(rerun.payout), market_losses(pinned.payout)), ((6, 4), (0, 10)))

    def test_cross_trader_gain_is_a_recovery_source_for_an_eth_creditor(self):
        unrestricted = choose(linked_winner(), protect=False)
        guarded = choose(linked_winner())
        # 60/100 of the initial 40 BTC claim supplies 24 to ETH. After the
        # twenty-atom close, 60/80 of a twenty-atom claim supplies only 15.
        self.assertEqual((unrestricted.charges, unrestricted.payout.cash), ((20,), (0, 0, 45, 15)))
        self.assertEqual((guarded.charges, guarded.payout.cash), ((0,), (0, 0, 36, 24)))

    def test_eth_insurance_can_hide_the_transfer_from_creditor_payouts(self):
        case = linked_winner(eth_insurance=25)
        unguarded, guarded = choose(case, protect=False), choose(case)
        self.assertEqual(unguarded.payout.cash[3], guarded.payout.cash[3])
        self.assertEqual((unguarded.payout.insurance_spent, guarded.payout.insurance_spent), ((0, 25), (0, 16)))
        self.assertEqual((unguarded.charges, guarded.charges), ((20,), (0,)))

    def test_guard_allows_partial_recovery_and_a_fully_funded_cross_winner(self):
        state, gains = linked_winner()
        partial = replace(state, book=replace(state.book, accounts=(
            state.book.accounts[0], Account(0, (40, -20)), state.book.accounts[2], Account(0, (0, 20)))))
        # 60(40-x)/(100-x) >= 20 precisely when x <= 10.
        result = choose((partial, gains))
        self.assertEqual((result.charges, result.payout.cash), ((10,), (0, 0, 40, 20)))
        funded = choose(linked_winner(winner_cash=40))
        self.assertEqual((funded.charges, funded.payout.cash), ((20,), (0, 15, 45, 40)))

    def test_searches_across_winners_for_largest_feasible_recovery(self):
        state, _ = linked_winner()
        pair = MarketSnapshot(state.book, (-2, 1, 1, 0), 100, (80, 90, 90, None))
        case = pair, (0, 10, 10, 0)
        self.assertEqual(choose(case, protect=False).charges, (10, 10))
        # To retain ETH's 24 atoms, 60(40-a)/(100-a-b) >= 24, so 3a <= 2b.
        self.assertEqual(choose(case).charges, (6, 10))

    def test_second_debtor_does_not_increase_the_first_debtors_charge_budget(self):
        book = MarketBook((Account(8, (-10, 0)), Account(0, (20, 0)), Account(0, (-10, 0))), frozen=True)
        state = MarketSnapshot(book, (-1, 2, -1), 100, (90, 90, 90))
        self.assertEqual(market_losses(terminal(book)), (12, 0))
        self.assertEqual(choose((state, (0, 20, 0))).charges, (2,))

    def test_fractional_ownership_is_preserved_or_the_intermediate_is_refused(self):
        book = MarketBook((Account(1, (-2, -2)), Account(1, (-2, -2)), Account(0, (4, 4))), frozen=True)
        pinned = pin_own_cash(book)
        self.assertEqual(pinned.pools, (1, 1))
        self.assertEqual(pinned.accounts[0].claims, (Fraction(-3, 2), Fraction(-3, 2)))
        self.assertEqual(terminal(book).cash, terminal(pinned).cash)
        fractional = MarketBook((Account(1, (-2, -1)), Account(0, (2, 1))), frozen=True)
        with self.assertRaisesRegex(InvalidTransition, "fractional intermediate pools"):
            pin_own_cash(fractional)

    def test_no_collection_from_unfunded_reciprocal_claims(self):
        book = MarketBook((Account(0, (100, -100)), Account(0, (-100, 100))), frozen=True)
        self.assertEqual(pin_own_cash(book), book)
        self.assertEqual((terminal(book).cash, market_losses(terminal(book))), ((0, 0), (0, 0)))

    def test_complete_terminal_cash_and_insurance_match_native_program_kernel(self):
        fixtures = (
            (choose(shared_cash(), pin=False, protect=False), (0, 0, 54, 36), (0, 0)),
            (choose(shared_cash()), (0, 0, 60, 30), (0, 0)),
            (choose(linked_winner(), protect=False), (0, 0, 45, 15), (0, 0)),
            (choose(linked_winner()), (0, 0, 36, 24), (0, 0)),
            (choose(linked_winner(eth_insurance=25), protect=False), (0, 0, 45, 40), (0, 25)),
            (choose(linked_winner(eth_insurance=25)), (0, 0, 36, 40), (0, 16)),
            (choose(linked_winner(winner_cash=40)), (0, 15, 45, 40), (0, 0)),
        )
        commands = [frozen_book_command(pin_own_cash(item.book, item.payout.benchmark.collections))
                    for item, _, _ in fixtures]
        for line, (_, cash, insurance) in zip(run(commands), fixtures, strict=True):
            result = decode(line)
            self.assertEqual((result['cash'], result['spent']), (cash, insurance))


if __name__ == "__main__":
    unittest.main()
