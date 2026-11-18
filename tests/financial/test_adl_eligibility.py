"""Independent tiny-book outcomes for the successor loss-allocation research."""
from dataclasses import replace
from fractions import Fraction
from itertools import product
import unittest

from account_contract_reference import Account, InvalidTransition
from adl_eligibility_model import EligiblePosition, freeze, maker_history, proportional_charges, resolve
from market_settlement_reference import MarketBook, collect, pay
from settlement_liquidation_model import MarketSnapshot
from test_scalable_settlement import SCALE, command, decode, independent_input, run


def snapshot(cash, claims, lots, entries, insurance=0):
    accounts = tuple(Account(balance, (claim, 0)) for balance, claim in zip(cash, claims, strict=True))
    return MarketSnapshot(MarketBook(accounts, insurance=(insurance, 0), frozen=True), lots, 100, entries)


def scarce_lots():
    # One other short has zero debt. Only one of the two longs can pair with the debtor.
    return snapshot((4, 100, 100, 100), (-10, 3, 7, 0), (-1, 1, 1, -1), (100, 97, 93, 100))


def split_accounts(split):
    # Each long lot has exactly one eligible atom. Splitting A preserves aggregate inventory/capital.
    if split:
        return snapshot((3, 50, 50, 100), (-4, 1, 1, 2), (-4, 1, 1, 2), (100, 99, 99, 99))
    return snapshot((3, 100, 100), (-4, 2, 2), (-4, 2, 2), (100, 99, 99))


class EligibilityTest(unittest.TestCase):
    def test_two_makers_same_capacity(self):
        state = freeze(maker_history(), 100)
        equal = resolve(state, 0)
        self.assertEqual(equal.charges, (0, 0, 5, 5, 0))
        self.assertEqual(equal.fills, ((2, 1, 95), (3, 1, 95)))
        self.assertEqual(equal.after.lots, (-2, 0, 1, 1, 0))
        self.assertEqual(equal.payout.cash, (0, 160, 115, 115, 100))
        ordered = resolve(state, 0, allocation="ordinal")
        self.assertEqual((ordered.charges, ordered.fills), ((0, 0, 10, 0, 0), ((2, 1, 90),)))
        self.assertEqual(ordered.payout.cash, (0, 160, 110, 120, 100))
        self.assertEqual(ordered.payout.insurance_spent, (10, 0))

    def test_close_and_reopen_around_freeze(self):
        held = maker_history()
        closed = held.trade(4, 2, 2, 99)
        reopened = closed.trade(2, 4, 2, 99)
        self.assertEqual((held.book, held.lots), (reopened.book, reopened.lots))
        self.assertEqual((held.entries[2], reopened.entries[2]), (90, 99))
        exited = resolve(freeze(closed, 100), 0)
        self.assertEqual((exited.charges, exited.payout.cash),
                         ((0, 0, 0, 9, 1), (0, 160, 118, 111, 101)))
        frozen = freeze(reopened, 100)
        result = resolve(frozen, 0)
        self.assertEqual(result.caps, (0, 0, 2, 20, 0))
        self.assertEqual((result.charges, result.payout.cash), ((0, 0, 1, 9, 0), (0, 160, 119, 111, 100)))
        with self.assertRaises(InvalidTransition):
            frozen.trade(4, 2, 2, 100)
        self.assertEqual(resolve(frozen, 0), result)

    def test_two_reentries_leave_residual_for_flat_creditor(self):
        changed = maker_history()
        for maker in (2, 3):
            changed = changed.trade(4, maker, 2, 99).trade(maker, 4, 2, 99)
        result = resolve(freeze(changed, 100), 0)
        self.assertEqual((result.charges, result.residual), ((0, 0, 2, 2, 0), 6))
        # 90 remaining atoms / 96 claims. Whole payouts on 60,18,18 are 56,17,17.
        self.assertEqual(result.payout.cash, (0, 156, 117, 117, 100))

    def test_debtor_lots_are_shared_across_makers(self):
        proportional = resolve(scarce_lots(), 0)
        ordinal = resolve(scarce_lots(), 0, allocation="ordinal")
        self.assertEqual((proportional.fills, proportional.residual), (((2, 1, 94),), 0))
        self.assertEqual((ordinal.fills, ordinal.residual), (((1, 1, 97),), 3))
        self.assertEqual(ordinal.payout.cash, (0, 100, 104, 100))
        self.assertEqual(proportional.payout.cash, (0, 103, 101, 100))

    def test_splitting_a_root_can_move_a_rounding_charge(self):
        original = resolve(split_accounts(False), 0)
        split = resolve(split_accounts(True), 0)
        self.assertEqual(original.charges, (0, 1, 0))
        self.assertEqual(split.charges, (0, 0, 0, 1))
        self.assertEqual(original.payout.cash, (0, 101, 102))
        self.assertEqual(split.payout.cash, (0, 51, 51, 101))

    def test_partial_reduction_weighted_entry_and_sign_flip(self):
        # A moves from +2 at 90 to +3 at 277/3, reduces one lot and flips to -1.
        state = maker_history().trade(2, 4, 1, 97)
        self.assertEqual(state.entries[2], Fraction(277, 3))
        state = state.trade(4, 2, 1, 99)
        self.assertEqual((state.entries[2], state.entries[4]), (Fraction(277, 3), None))
        state = state.trade(4, 2, 3, 99)
        self.assertEqual((state.lots[2], state.entries[2], state.entries[4]), (-1, 99, 99))

    def test_fractional_prices_claim_cap_and_mirror(self):
        state = snapshot((0, 100, 100), (-4, Fraction(7, 2), Fraction(1, 2)),
                         (3, -2, -1), (99, Fraction(203, 2), 110))
        result = resolve(state, 0)
        # Short A's average is 101.5. Only one whole tick per lot is available.
        # B has a half-atom unpaid claim even though its short has gained ten.
        self.assertEqual((result.caps, result.fills, result.residual), ((0, 2, 0), ((1, 2, 101),), 2))
        self.assertEqual(result.payout.cash, (0, 100, 100))
        long = replace(state, lots=tuple(-lots for lots in state.lots),
                       entries=tuple(200 - entry for entry in state.entries))
        mirrored = resolve(long, 0)
        self.assertEqual((mirrored.charges, mirrored.payout.cash), (result.charges, result.payout.cash))
        self.assertEqual(mirrored.fills, ((1, 2, 99),))

    def test_payment_attribution_is_missing_from_aggregate_claim(self):
        # At 90 A owns ten atoms of closed gain and ten of open gain. A single
        # payment of ten reduces its aggregate claim, without earmarking either kind.
        book = MarketBook((Account(20, (-20, 0)), Account(100, (20, 0)), Account(100, (0, 0))))
        state = MarketSnapshot(book, (-2, 1, 1), 90, (80, 80, 90))
        paid = state.apply_cash(pay(collect(book, 0, 0, 10), 1, 0, 10))
        default = freeze(paid, 100)
        self.assertEqual(default.book.accounts[1], Account(110, (20, 0)))
        # Paying the closed component first would leave twenty open atoms at 100.
        result = resolve(default, 0, unpaid_open=(0, 20, 10))
        self.assertEqual((result.caps, result.charges), ((0, 20, 10), (0, 13, 7)))
        # Paying the open component first leaves only the subsequent ten-atom gain
        # eligible. The same ledger and the same lots then justify different charges.
        open_paid_first = resolve(default, 0, unpaid_open=(0, 10, 10))
        self.assertEqual((open_paid_first.charges, open_paid_first.payout.cash), ((0, 10, 10), (0, 120, 100)))
        self.assertEqual(result.payout.cash, (0, 117, 103))

    def test_capacity_excludes_opposite_lots_beyond_the_debtor_size(self):
        state = snapshot((0, 100, 100, 100), (-30, 20, 10, 0), (-1, 4, 1, -4),
                         (100, 95, 90, 100))
        self.assertEqual(resolve(state, 0).caps, (0, 5, 10, 0))

    def test_empty_eligibility_and_funded_insurance(self):
        flat_debtor = snapshot((4, 100, 100), (-10, 3, 7), (0, 1, -1), (None, 90, 110))
        result = resolve(flat_debtor, 0)
        self.assertEqual((result.charges, result.residual), ((0, 0, 0), 6))
        covered = replace(flat_debtor, book=replace(flat_debtor.book, insurance=(9, 0)))
        self.assertEqual((resolve(covered, 0).payout.insurance_spent, resolve(covered, 0).residual), ((6, 0), 0))
        with self.assertRaises(InvalidTransition):
            resolve(replace(flat_debtor, entries=None), 0)
        for invalid in ((0, 1), (0, 1, -1)):
            with self.assertRaises(InvalidTransition):
                resolve(flat_debtor, 0, unpaid_open=invalid)
        with self.assertRaises(InvalidTransition):
            resolve(replace(flat_debtor, book=replace(flat_debtor.book, frozen=False)), 0)
        cross = replace(flat_debtor.book, accounts=(Account(4, (-10, -4)), Account(100, (3, 4)), Account(100, (7, 0))))
        with self.assertRaises(InvalidTransition):
            resolve(replace(flat_debtor, book=cross), 0)

    def test_allocation_against_exhaustive_feasible_vectors(self):
        # Compare directly to exact ideal shares of the chosen total. Literal capacities
        # deliberately vary independently of gain per lot to include unpaid-claim caps.
        for gains in product((1, 3), repeat=3):
            for caps in ((1, 2, 3), (4, 3, 1)):
                eligible = [EligiblePosition(index, gain, cap) for index, (gain, cap) in enumerate(zip(gains, caps))]
                for loss, lots in product((1, 3, 5), (1, 2, 4)):
                    feasible = []
                    for charges in product(*(range(cap + 1) for cap in caps)):
                        total = sum(charges)
                        used = sum(-(-charge // gain) for charge, gain in zip(charges, gains))
                        if total <= loss and used <= lots:
                            deviation = sum((charge - Fraction(total * cap, sum(caps))) ** 2 / cap
                                            for charge, cap in zip(charges, caps))
                            feasible.append(((-total, deviation, used, tuple(-charge for charge in charges)), charges))
                    self.assertEqual(tuple(proportional_charges(eligible, loss, lots)), min(feasible)[1])

    def test_native_terminal_cash_on_adjusted_inputs(self):
        held = maker_history()
        reopened = held.trade(4, 2, 2, 99).trade(2, 4, 2, 99)
        both = reopened.trade(4, 3, 2, 99).trade(3, 4, 2, 99)
        fixtures = (
            (freeze(held, 100), "ordinal", (0, 160, 110, 120, 100), 10),
            (freeze(held, 100), "proportional", (0, 160, 115, 115, 100), 10),
            (freeze(reopened, 100), "proportional", (0, 160, 119, 111, 100), 10),
            (freeze(both, 100), "proportional", (0, 156, 117, 117, 100), 10),
            (scarce_lots(), "ordinal", (0, 100, 104, 100), 0),
            (scarce_lots(), "proportional", (0, 103, 101, 100), 0),
            (split_accounts(False), "proportional", (0, 101, 102), 0),
            (split_accounts(True), "proportional", (0, 51, 51, 101), 0),
        )
        commands = []
        for state, rule, _, _ in fixtures:
            book = resolve(state, 0, allocation=rule).after.book
            rows = tuple((account.cash, tuple(int(claim * SCALE) for claim in account.claims)) for account in book.accounts)
            _, _, proposals, orders = independent_input(rows, book.pools, book.insurance)
            commands.append(command(rows, book.pools, book.insurance, book.fees, proposals, orders))
        for line, (_, _, cash, spent) in zip(run(commands), fixtures, strict=True):
            actual = decode(line)
            self.assertEqual((actual["cash"], actual["spent"]), (cash, (spent, 0)))


if __name__ == "__main__":
    unittest.main()
