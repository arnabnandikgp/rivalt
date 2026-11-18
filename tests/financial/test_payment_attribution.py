"""Independent ledgers and executable native comparisons for two payment conventions."""
from dataclasses import replace
from fractions import Fraction
from itertools import product
from pathlib import Path
import subprocess
import unittest

from account_contract_reference import Account, InvalidTransition
from adl_eligibility_model import resolve
from market_settlement_reference import MarketBook
from payment_attribution_model import PaymentHistory, histories, mixed_profit
from settlement_liquidation_model import MarketSnapshot
from test_scalable_settlement import SCALE, decode, frozen_book_command, run


# In each row: charges to A/B/C, residual, final cash of A/B/flat creditor/C.
# D's cash is exhausted in every case. All ordinary payments are already included.
EXPECTED = {
    "mixed payment": (
        ((13, 7, 0), 0, (117, 103, 110, 100)),
        ((10, 10, 0), 0, (120, 100, 110, 100))),
    "longs receive funding": (
        ((16, 8, 0), 0, (116, 104, 110, 100)),
        ((10, 10, 0), 4, (120, 102, 108, 100))),
    "partial close, longs pay funding": (
        ((14, 12, 6), 0, (134, 104, 120, 102)),
        ((9, 15, 8), 0, (139, 101, 120, 100))),
    "partial close, longs receive funding": (
        ((19, 19, 10), 0, (133, 105, 120, 102)),
        ((10, 20, 10), 8, (138, 103, 117, 102))),
    "close and reopen": (
        ((1, 10, 0), 9, (123, 100, 107, 100)),
        ((1, 10, 0), 9, (123, 100, 107, 100))),
}
RULES = ("closed-first", "open-first")


class PaymentAttributionTest(unittest.TestCase):
    def test_complete_histories_against_expected_cash_and_native_terminal(self):
        native_commands, expected_cash = [], []
        closed, opened = (histories(rule) for rule in RULES)
        self.assertEqual(set(closed), set(EXPECTED))
        for label, outcomes in EXPECTED.items():
            self.assertEqual(closed[label].market, opened[label].market, label)
            for history, (charges, residual, cash) in zip((closed[label], opened[label]), outcomes, strict=True):
                result = history.resolve_at(100)
                self.assertEqual(result.charges, (0, *charges[:2], 0, charges[2]), label)
                self.assertEqual((result.residual, result.payout.cash), (residual, (0, *cash)), label)
                native_commands.append(frozen_book_command(result.after.book))
                expected_cash.append((0, *cash))
        for line, expected in zip(run(native_commands), expected_cash, strict=True):
            native = decode(line)
            self.assertEqual((native["cash"], native["spent"]), (expected, (0, 0)))

    def test_components_and_funded_cash_at_mixed_payment(self):
        for rule, expected in zip(RULES, ((10, 0), (0, 10)), strict=True):
            original = mixed_profit(rule)
            self.assertEqual(original.components(1), (10, 10))
            backed = original.collect_loss(0, 10)
            paid = backed.pay_gain(1, 10)
            self.assertEqual(paid, backed.pay_gain(1, 4).pay_gain(1, 6))
            self.assertEqual(paid.components(1), expected)
            self.assertEqual(paid.market.book.accounts[1].cash, 110)
            self.assertEqual((paid.market.book.pools, paid.market.book.vault), ((0, 0), 430))
            with self.assertRaises(InvalidTransition):
                paid.pay_gain(1, 1)

    def test_partial_close_prorates_already_paid_gain_and_flip_releases_it(self):
        base = mixed_profit("open-first", 3).collect_loss(0, 10).pay_gain(1, 10)
        partial = base.trade(4, 1, 1, 88)  # sell one of three below the independent mark
        self.assertEqual(partial.paid_open[1], Fraction(20, 3))
        self.assertEqual(partial.components(1), (Fraction(40, 3), Fraction(104, 3)))
        increased = partial.trade(1, 4, 1, 89)
        self.assertEqual((increased.paid_open[1], increased.market.entries[1]), (Fraction(20, 3), 83))
        flipped = increased.trade(4, 1, 4, 92)
        self.assertEqual((flipped.market.lots[1], flipped.paid_open[1], flipped.components(1)), (-1, 0, (2, 55)))

    def test_reversal_and_collection_do_not_reissue_paid_open_profit(self):
        paid = mixed_profit("open-first").collect_loss(0, 10).pay_gain(1, 10)
        below = paid.reprice(70)
        self.assertEqual(below.components(1), (-20, 10))
        collected = below.collect_loss(1, 8)
        self.assertEqual(collected.components(1), (-20, 18))
        recovered = collected.reprice(90)
        self.assertEqual((recovered.components(1), recovered.market.book.accounts[1].cash), ((0, 18), 102))

    def test_partial_close_before_versus_after_payment(self):
        # Two surviving lots before the sale, one afterwards. Isolate timing at the same price.
        for rule, amount, expected_paid in (("open-first", 10, (5, 10)), ("closed-first", 30, (5, 0))):
            backed = mixed_profit(rule, 2).collect_loss(0, amount)
            pay_first = backed.pay_gain(1, amount).trade(4, 1, 1, 90)
            close_first = backed.trade(4, 1, 1, 90).pay_gain(1, amount)
            self.assertEqual(pay_first.market, close_first.market)
            self.assertEqual((pay_first.paid_open[1], close_first.paid_open[1]), expected_paid)

    def test_fractional_matched_lots_bound(self):
        # 20 of open price P&L over two lots, of which 11 has been paid. Only
        # 4.5 remains attributable to one lot; an integer charge on it is at most 4.
        for debtor_lots, expected_charge, expected_fills in (
                (-1, 4, ((1, 1, 96),)), (-2, 9, ((1, 1, 96), (1, 1, 95)))):
            book = MarketBook((Account(0, (-9, 0)), Account(111, (9, 0)), Account(100, (0, 0))))
            third_lots = -2 - debtor_lots
            market = MarketSnapshot(book, (debtor_lots, 2, third_lots), 100, (90, 90, 100 if third_lots else None))
            history = PaymentHistory(market, "open-first", (0, 11, 0))
            result = history.resolve_at(100)
            self.assertEqual((result.charges[1], result.fills, result.residual),
                             (expected_charge, expected_fills, 9 - expected_charge))
            ordered = resolve(replace(market, book=replace(book, frozen=True)), 0,
                              allocation="ordinal", unpaid_open=(0, 9, 0))
            self.assertEqual(ordered, result)

    def test_funding_checkpoints_against_native_accrual(self):
        history = mixed_profit("open-first", 2).collect_loss(0, 20).pay_gain(1, 20).trade(4, 1, 1, 90)
        # Longs are charged 1.5, then the index moves back to -0.5; replay is idempotent.
        # Frozen integer ledger at 90 before funding: -40,20,0,20,0.
        indices = (Fraction(3, 2), Fraction(-1, 2), Fraction(-1, 2))
        expected_claims = ((-34, Fraction(37, 2), -3, 20, Fraction(-3, 2)),
                           (-42, Fraction(41, 2), 1, 20, Fraction(1, 2)),
                           (-42, Fraction(41, 2), 1, 20, Fraction(1, 2)))
        commands, expected_virtuals = [], []
        for endpoint, expected in zip(indices, expected_claims, strict=True):
            updated = history.accrue(endpoint)
            actual = tuple(account.claims[0] for account in updated.market.book.accounts)
            self.assertEqual(actual, expected)
            self.assertEqual((updated.components(1)[0], updated.paid_open), (0, history.paid_open))
            for lots, account, claim in zip(history.market.lots, history.market.book.accounts, expected, strict=True):
                base_value = account.claims[0] - lots * 90
                commands.append(f"fund {lots} {int(base_value*SCALE)} {int(history.funding_index*SCALE)} {int(endpoint*SCALE)}")
                expected_virtuals.append(int((claim - lots * 90) * SCALE))
            history = updated
        driver = Path("target/debug/reference-driver").resolve()
        native = subprocess.run([driver], input="\n".join(commands) + "\n", capture_output=True, text=True, check=True)
        self.assertEqual(list(map(int, native.stdout.splitlines())), expected_virtuals)

    def test_positive_funding_is_payable_while_open_without_price_profit(self):
        for rule in RULES:
            state = PaymentHistory.start(rule, (100, 100), 80).trade(1, 0, 1, 80).accrue(-3)
            self.assertEqual(state.components(1), (0, 3))
            paid = state.collect_loss(0, 3).pay_gain(1, 3)
            self.assertEqual((paid.components(1), paid.paid_open[1]), ((0, 0), 0))
            self.assertEqual(paid.reprice(83).components(1), (3, 0))
            with self.assertRaises(InvalidTransition):
                replace(paid, market=replace(paid.market, book=replace(paid.market.book, frozen=True))).accrue(-4)

    def test_same_history_ordering_over_signed_funding_and_reentry(self):
        reductions = ((0, False), (1, False), (1, True), (2, False), (2, True))
        for payment, (sold, reopen), index, mark in product((1, 10, 22, 30), reductions, (-2, 0, 2), (85, 97, 101)):
            pair = []
            for rule in RULES:
                state = mixed_profit(rule, 2).collect_loss(0, payment).pay_gain(1, payment)
                if sold:
                    state = state.trade(4, 1, sold, 89)
                state = state.accrue(index).reprice(mark)
                if reopen:
                    state = state.trade(1, 4, sold, mark)
                pair.append(state)
            self.assertEqual(pair[0].market, pair[1].market)
            for member, account in enumerate(pair[0].market.book.accounts):
                closed_open, closed_fixed = pair[0].components(member)
                open_open, open_fixed = pair[1].components(member)
                self.assertGreaterEqual(closed_open, open_open)
                self.assertEqual((closed_open + closed_fixed, open_open + open_fixed), (account.claims[0],) * 2)


if __name__ == "__main__":
    unittest.main()
