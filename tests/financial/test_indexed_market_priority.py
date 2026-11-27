"""An asymmetric book has two distinct, protected maximal-recovery allocations."""
import unittest
from indexed_default_certificate import competing_certificate
from test_joint_market_ties import mirror_book
from test_market_indexed_default import frozen


def asymmetric_book():
    reference, legs = mirror_book()
    # BTC's flat winner also owns a SOL claim backed by a separate funded SOL debtor.
    rows = [(a.cash, [*a.claims, 2 if member == 6 else 0])
            for member, a in enumerate(reference.accounts)] + [(2, [0, 0, -2])]
    book = frozen(rows, reserves=[1, 1, 0])
    positions = [[(leg.lots[i], leg.unpaid_gains[i], 100 - leg.entries[i] if leg.lots[i] > 0 else 0)
                  if i < len(leg.lots) else (0, 0, 0) for leg in legs] + [(0, 0, 0)] for i in range(9)]
    return book, positions


class FrozenMarketPriorityTests(unittest.TestCase):
    def test_frozen_market_order_resolves_only_the_two_protected_finalists(self):
        book, positions = asymmetric_book()
        for episode, selected, wallets in [(1, 15, [0,0,1,0,0,0,9,8,0]), (2, 12, [0,0,0,1,0,0,10,7,0])]:
            proof = competing_certificate(book, positions, [(0,0,[2,4]),(1,1,[3,5])],
                                          bytes(32), episode, list(range(100,109)))
            self.assertEqual((proof['totalPlans'], proof['protectedPlans']), (100, 70))
            self.assertEqual((proof['selected'], proof['cash']), (selected, wallets))
            self.assertEqual((proof['charges'], proof['spent']), ([3,3,0], [1,1,0]))
            self.assertEqual(sum(sum(m['lots']) for m in proof['splits']), 3)

    def test_an_unused_third_market_cannot_override_an_existing_market_symmetry(self):
        book, positions = asymmetric_book()
        book['rows'][6]['claims'][2] = '0'
        book['rows'][8]['claims'][2] = '0'
        with self.assertRaises(AssertionError):
            competing_certificate(book, positions, [(0,0,[2,4]),(1,1,[3,5])], bytes(32))


if __name__ == '__main__':
    unittest.main()
