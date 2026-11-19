"""Complete-search and native terminal controls for a linked eight-account default."""
from dataclasses import replace
from fractions import Fraction
import unittest

from account_contract_reference import Account, InvalidTransition
from bounded_default_search import FrozenSearch
from frozen_plan_selection import FrozenIdentity, IncomparableFinancialProfiles, _break_exact_ties, select_joint
from joint_reduction_model import Exposure, compare_joint
from market_settlement_reference import MarketBook
from mirrored_reductions import exact_market_mirror
from settlement_liquidation_model import terminal
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
        for proposed, deviations, cash in (
            (54, (Fraction(25, 84), Fraction(12, 7)), (0, 0, 1, 0, 0, 0, 7, 8)),
            (99, (Fraction(12, 7), Fraction(25, 84)), (0, 0, 0, 1, 0, 0, 8, 7)),
        ):
            plan = search.candidate(proposed)
            self.assertEqual(plan.recovered, (3, 3))
            self.assertEqual(tuple(m.deviation for m in plan.markets), deviations)
            self.assertEqual(plan.payout.cash, cash)
            self.assertEqual(plan.payout.insurance_spent, (1, 1))
            self.assertEqual(sum(q for market in plan.markets for pair in market.pairs for q, _ in pair.fills), 3)
        # Independent SHA-256 vectors: the first distinguishing winner is
        # member 3 in episode 1 and member 2 in episode 2. Larger charge wins.
        for epoch, selected, rejected in ((1, 54, 99), (2, 99, 54)):
            identity = replace(identity, episode=epoch)
            space = FrozenSearch(book, exposures, identity, bytes([44])*32)
            result = select_joint(book, exposures, identity)
            self.assertEqual(result, space.candidate(selected))
            self.assertEqual(result, _break_exact_ties(finalists[::-1], identity, book, exposures, space.baseline))
            for proposed in (selected, rejected):
                audit = space.begin(proposed)
                while audit.status == "pending":
                    audit = space.advance(audit, audit.next_ordinal, 9)
                if proposed == selected:
                    self.assertEqual((audit.status, audit.next_ordinal), ("verified", 256))
                    self.assertEqual(space.verified_plan(audit), result)
                else:
                    self.assertEqual((audit.status, audit.challenger), ("outscored", selected))
                    with self.assertRaises(InvalidTransition):
                        space.verified_plan(audit)

    def test_unequal_frozen_inputs_fail_closed_even_when_final_scores_still_trade_places(self):
        book, exposures = mirror_book()
        identity = FrozenIdentity(bytes(32), 1, tuple(range(8)))
        for original, frozen_exposures in (
            (replace(book, fees=(1, 0)), exposures),
            (replace(book, accounts=(*book.accounts[:-1], Account(1, (0, 8)))), exposures),
            (book, (replace(exposures[0], entries=(101, *exposures[0].entries[1:])), exposures[1])),
        ):
            space = FrozenSearch(original, frozen_exposures, identity, bytes(32))
            with self.assertRaises(IncomparableFinancialProfiles):
                select_joint(original, frozen_exposures, identity)
            for proposal in (54, 99):
                audit = space.advance(space.begin(proposal), 0, space.size)
                self.assertEqual(audit.status, "incomparable")

    def test_member_totals_cannot_mask_an_unmatched_fill_or_cash_receipt(self):
        book, exposures = mirror_book()
        baseline = terminal(book)
        first, second = compare_joint(book, exposures)
        self.assertTrue(exact_market_mirror(book, exposures, baseline, first, second))
        market = second.markets[0]
        fake_pair = replace(market.pairs[0], debtor=1)
        new_market = replace(market, pairs=(fake_pair, *market.pairs[1:]))
        changed_pairs = replace(second, markets=(new_market, second.markets[1]))
        changed_cash = replace(second, payout=replace(second.payout, cash=first.payout.cash))
        for changed in (changed_pairs, changed_cash):
            self.assertFalse(exact_market_mirror(book, exposures, baseline, first, changed))

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
