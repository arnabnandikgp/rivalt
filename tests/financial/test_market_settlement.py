from dataclasses import replace
from fractions import Fraction
import unittest
from account_contract_reference import Account, InvalidTransition
from market_settlement_reference import MarketBook, FrozenCursor, collect, pay, net_flat, payment_eligible


class MarketSettlementContract(unittest.TestCase):
    def test_unrelated_insolvent_market_does_not_block_backed_payment(self):
        book = MarketBook((Account(100, (-100, 0)), Account(0, (100, 0)),
                           Account(0, (0, -100)), Account(0, (0, 100))))
        self.assertTrue(payment_eligible(book, 0))
        self.assertFalse(payment_eligible(book, 1))
        result = pay(collect(book, 0, 0, 100), 1, 0, 100)
        self.assertEqual(tuple(account.cash for account in result.accounts), (0, 100, 0, 0))
        self.assertEqual(result.vault, book.vault)

    def test_shared_debtor_cannot_pay_favourite_market_first(self):
        book = MarketBook((Account(100, (-80, -80)), Account(0, (80, 0)), Account(0, (0, 80))))
        self.assertFalse(payment_eligible(book, 0))
        self.assertFalse(payment_eligible(book, 1))
        with self.assertRaises(InvalidTransition):
            collect(book, 0, 0, 80)

    def test_payment_cannot_race_an_existing_shortfall(self):
        book = MarketBook((Account(0, (50, 0)), Account(0, (50, 0)), Account(0, (-50, 0))), pools=(50, 0))
        with self.assertRaises(InvalidTransition):
            pay(book, 0, 0, 50)

    def test_funded_netting_moves_backing_and_keeps_cash(self):
        book = MarketBook((Account(7, (100, -100)), Account(0, (0, 100))), pools=(100, 0))
        result = net_flat(book, 0, 0, 60)
        self.assertEqual(result.pools, (40, 60))
        self.assertEqual(result.accounts[0], Account(7, (40, -40)))
        self.assertEqual(result.vault, book.vault)
        self.assertTrue(payment_eligible(result, 1) is False)  # remaining debtor underfunded
        result = net_flat(result, 0, 0, 40)
        result = pay(result, 1, 1, 100)
        self.assertEqual(result.accounts, (Account(7, (0, 0)), Account(100, (0, 0))))

    def test_unfunded_netting_does_not_erase_liabilities(self):
        book = MarketBook((Account(0, (100, -100)), Account(0, (-100, 0)), Account(0, (0, 100))))
        with self.assertRaises(InvalidTransition):
            net_flat(book, 0, 0, 100)
        self.assertEqual(book.accounts[0].claims, (100, -100))

    def test_netting_authority_flatness_and_live_orders(self):
        book = MarketBook((Account(0, (1, -1)), Account(0, (0, 1))), pools=(1, 0))
        for arguments in ({'owner_signed': False}, {'cross': False}, {'flat': False}, {'live_orders': True}):
            with self.subTest(arguments=arguments), self.assertRaises(InvalidTransition):
                net_flat(book, 0, 0, 1, **arguments)

    def test_fractions_survive_normal_collection_payment_netting(self):
        half = Fraction(1, 2)
        book = MarketBook((Account(3, (-1-half, 0)), Account(0, (1+half, 0))))
        result = pay(collect(book, 0, 0, 1), 1, 0, 1)
        self.assertEqual(tuple(account.claims[0] for account in result.accounts), (-half, half))
        with self.assertRaises(InvalidTransition):
            collect(result, 0, 0, 1)
        mixed = MarketBook((Account(2, (1+half, -1-half)), Account(0, (-half, half)),
                            Account(0, (0, 1))), pools=(1, 0))
        # An unfunded fractional BTC debtor blocks the purported BTC certificate.
        with self.assertRaises(InvalidTransition):
            net_flat(mixed, 0, 0, 1)

    def test_reserve_and_fees_never_back_normal_gain_payment(self):
        book = MarketBook((Account(0, (100, 0)), Account(0, (-100, 0))), insurance=(100, 100), fees=(50, 50))
        with self.assertRaises(InvalidTransition):
            pay(book, 0, 0, 100)

    def test_frozen_normal_operations_reject(self):
        book = MarketBook((Account(1, (-1, 0)), Account(0, (1, 0))), frozen=True)
        with self.assertRaises(InvalidTransition):
            collect(book, 0, 0, 1)
        with self.assertRaises(InvalidTransition):
            pay(book, 1, 0, 1)

    def test_all_page_sizes_restarts_and_once_only_completion(self):
        members = tuple(str(index) for index in range(64))
        for size in (1, 2):
            cursor = FrozenCursor(members, 9)
            while cursor.stage < cursor.PASSES:
                old = cursor
                page = members[cursor.next:cursor.next + size]
                cursor = cursor.page(9, cursor.stage, page)
                # Replace reconstructs persisted values, rather than keeping an
                # invisible worker progress variable across each page boundary.
                cursor = replace(cursor)
                with self.assertRaises(InvalidTransition):
                    cursor.page(9, old.stage, page)
            self.assertEqual(cursor.recover(authorized=True, reconciled=True, sources_ready=True), 10)

    def test_omission_foreign_order_epoch_and_early_recovery_reject(self):
        cursor = FrozenCursor(('a', 'b', 'c'), 4)
        for epoch, stage, supplied in ((3, 0, ('a',)), (4, 1, ('a',)), (4, 0, ('b',)),
                                       (4, 0, ('a', 'a')), (4, 0, ('a', 'x')), (4, 0, ())):
            with self.assertRaises(InvalidTransition):
                cursor.page(epoch, stage, supplied)
        for authorized in (False, True):
            with self.assertRaises(InvalidTransition):
                cursor.recover(authorized=authorized, reconciled=True, sources_ready=True)


if __name__ == '__main__':
    unittest.main()
