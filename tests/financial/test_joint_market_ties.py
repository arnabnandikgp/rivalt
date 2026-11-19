"""Complete-search and native terminal controls for a linked eight-account default."""
from fractions import Fraction
import unittest

from account_contract_reference import Account, InvalidTransition
from bounded_default_search import FrozenSearch
from frozen_plan_selection import FrozenIdentity, IncomparableFinancialProfiles, select_joint
from joint_reduction_model import Exposure, compare_joint
from market_settlement_reference import MarketBook
from test_scalable_settlement import decode, frozen_book_command, run


def mirror_book():
    rows = ((7, -11, 0), (7, 0, -11), (0, 3, 0), (0, 0, 3),
            (0, 4, -4), (0, -4, 4), (0, 8, 0), (0, 0, 8))
    book = MarketBook(tuple(Account(cash, (btc, eth)) for cash, btc, eth in rows),
                      insurance=(1, 1), frozen=True)
    btc = Exposure(100, (-2, 0, 1, 0, 1, 0, 0, 0), (100, None, 97, None, 96, None, None, None),
                   (0, 0, 3, 0, 4, 0, 0, 0))
    eth = Exposure(100, (0, -2, 0, 1, 0, 1, 0, 0), (None, 100, None, 97, None, 96, None, None),
                   (0, 0, 0, 3, 0, 4, 0, 0))
    return book, (btc, eth)


class JointMarketTies(unittest.TestCase):
    def test_full_search_preserves_the_two_distinct_creditor_outcomes(self):
        book, exposures = mirror_book()
        identity = FrozenIdentity(bytes(32), 1, tuple(range(8)))
        search = FrozenSearch(book, exposures, identity, bytes([44]) * 32)
        self.assertEqual((search.radices, search.size), ((4, 4, 4, 4), 256))
        self.assertEqual(sum(search.candidate(i) is not None for i in range(search.size)), 70)
        finalists = compare_joint(book, exposures)
        self.assertCountEqual(finalists, [search.candidate(54), search.candidate(99)])
        for proposed, alternate, deviations, cash in (
            (54, 99, (Fraction(25, 84), Fraction(12, 7)), (0, 0, 1, 0, 0, 0, 7, 8)),
            (99, 54, (Fraction(12, 7), Fraction(25, 84)), (0, 0, 0, 1, 0, 0, 8, 7)),
        ):
            plan = search.candidate(proposed)
            self.assertEqual(plan.recovered, (3, 3))
            self.assertEqual(tuple(m.deviation for m in plan.markets), deviations)
            self.assertEqual(plan.payout.cash, cash)
            self.assertEqual(plan.payout.insurance_spent, (1, 1))
            self.assertEqual(sum(q for market in plan.markets for pair in market.pairs for q, _ in pair.fills), 3)
            audit = search.begin(proposed)
            while audit.status == "pending":
                audit = search.advance(audit, audit.next_ordinal, 9)
            self.assertEqual((audit.status, audit.challenger), ("incomparable", alternate))
            with self.assertRaises(InvalidTransition):
                search.verified_plan(audit)
        with self.assertRaises(IncomparableFinancialProfiles):
            select_joint(book, exposures, identity)

    def test_native_settlement_of_literal_adjusted_claims(self):
        book, _ = mirror_book()
        # Derive obligations directly from the three 1-lot trades, without the
        # planner's charge vectors. Both markets conserve claims independently.
        variants = [
            (book, (0, 0, 2, 2, 0, 0, 6, 6)),
        ]
        for btc, eth, expected in [
            ((-8,0,1,0,3,-4,8,0), (0,-8,0,0,-4,4,0,8), (0,0,1,0,0,0,7,8)),
            ((-8,0,0,0,4,-4,8,0), (0,-8,0,1,-4,3,0,8), (0,0,0,1,0,0,8,7)),
        ]:
            rows = tuple(Account(account.cash, claims) for account, claims in
                         zip(book.accounts, zip(btc, eth, strict=True), strict=True))
            variants.append((MarketBook(rows, insurance=(1, 1), frozen=True), expected))
        outputs = run([frozen_book_command(variant) for variant, _ in variants])
        for (_, cash), line in zip(variants, outputs, strict=True):
            native = decode(line)
            self.assertEqual((native["cash"], native["spent"], sum(cash)), (cash, (1, 1), 16))


if __name__ == "__main__":
    unittest.main()
