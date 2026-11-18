"""Reference continuation, binding and outcomes against independent tiny frozen books."""
from dataclasses import asdict, replace
from tempfile import TemporaryDirectory
from pathlib import Path
import json
import unittest

from account_contract_reference import InvalidTransition
from bounded_default_search import Audit, FrozenSearch
from default_plan_certificate import ThreeLotBook
from frozen_plan_selection import FrozenIdentity, select_joint
from test_default_plan_certificate import tie_book
from test_joint_reductions import linked_defaults
from test_scalable_settlement import decode, frozen_book_command, run


def search(case, epoch=0):
    book, exposures = case
    freeze = FrozenIdentity(bytes(range(32)), epoch, tuple(range(len(book.accounts))))
    return FrozenSearch(book, exposures, freeze, bytes.fromhex("ab" * 32))


class BoundedDefaultSearch(unittest.TestCase):
    def test_one_comparison_at_a_time_matches_both_markets_and_native_cash(self):
        book, exposures = linked_defaults()
        space = search((book, exposures))
        self.assertEqual((space.radices, space.size), ((3, 3), 9))
        self.assertEqual([i for i in range(space.size) if space.candidate(i)], [0, 4, 8])
        for proposed, status, challenger in ((0, "outscored", 4), (4, "outscored", 8), (8, "verified", None)):
            audit = space.begin(proposed)
            while audit.status == "pending":
                with self.assertRaises(InvalidTransition):
                    space.verified_plan(audit)
                audit = space.advance(audit, audit.next_ordinal, 1)
            self.assertEqual((audit.status, audit.challenger), (status, challenger))
            if challenger is not None:
                with self.assertRaises(InvalidTransition):
                    space.verified_plan(audit)
                continue
            result = space.verified_plan(audit)
            self.assertEqual(result, select_joint(book, exposures, space.identity))
            self.assertEqual(result.payout.cash, (0, 0, 0, 0, 9, 9))
            self.assertEqual(decode(run([frozen_book_command(result.book)])[0])['cash'], result.payout.cash)

    def test_restart_restores_only_the_trusted_committed_prefix(self):
        original = search(linked_defaults())
        with TemporaryDirectory() as directory:
            path = Path(directory) / "controller.json"
            audit = original.begin(8)
            for chunk in (1, 3, 2, 3):
                path.write_text(json.dumps(asdict(audit)))
                restored = Audit(**json.loads(path.read_text()))
                space = search(linked_defaults())
                expected = restored.next_ordinal
                audit = space.advance(restored, expected, chunk)
                self.assertEqual(audit.next_ordinal, expected + chunk)
                self.assertEqual(space.advance(restored, expected, chunk), audit)
                with self.assertRaises(InvalidTransition):
                    space.advance(audit, expected, chunk)
            self.assertEqual(audit.status, "verified")
            with self.assertRaises(InvalidTransition):
                original.advance(audit, audit.next_ordinal, 1)

    def test_bindings_cover_proposal_membership_oracle_and_gain_attribution(self):
        book, exposures = linked_defaults()
        original = search((book, exposures))
        audit = original.advance(original.begin(8), 0, 3)
        other_exposures = (replace(exposures[0], unpaid_gains=(0, 1, 0, 0, 0, 0)), exposures[1])
        for space in (search((book, other_exposures)), search((replace(book, insurance=(1, 0)), exposures)),
                      search((book, exposures), 1),
                      FrozenSearch(book, exposures, original.identity, bytes(32)),
                      FrozenSearch(book, exposures, replace(original.identity, venue=bytes(32)), bytes.fromhex("ab"*32)),
                      FrozenSearch(book, exposures, replace(original.identity, member_ids=(0, 1, 2, 3, 4, 9)),
                                   bytes.fromhex("ab"*32))):
            with self.assertRaises(InvalidTransition):
                space.advance(audit, 3, 3)
        with self.assertRaises(InvalidTransition):
            original.advance(replace(audit, proposal=4), 3, 3)
        with self.assertRaises(InvalidTransition):
            original.advance(audit, 3, 0)
        for ordinal in (2, -1, 9):
            with self.assertRaises(InvalidTransition):
                original.begin(ordinal)

    def test_worse_exact_tie_cannot_finalize(self):
        book, exposures = tie_book()
        identity = FrozenIdentity(bytes(range(32)), 1, (2, 7, 10, 44))
        space = FrozenSearch(book, exposures, identity, bytes(32))
        # Two ten-atom gains, but the bankrupt debtor owns only one short lot.
        self.assertEqual(space.radices, (11, 11))
        for ordinal, verdict in ((10, "verified"), (110, "outscored")):
            audit = space.advance(space.begin(ordinal), 0, space.size)
            self.assertEqual(audit.status, verdict)
            if verdict == "verified":
                confirmed = space.verified_plan(audit)
                self.assertEqual(confirmed.payout.cash, (0, 0, 0, 10))

    def test_joint_enumeration_matches_all_charges_on_the_one_debtor_family(self):
        for gains in ((2, 2, 2), (3, 3, 4), (4, 5, 6)):
            case = ThreeLotBook(sum(gains), gains)
            book, profiles = case.frozen()
            space = search((book, profiles))
            self.assertEqual(space.candidate(space.size - 1), select_joint(book, profiles, space.identity))
            audit = space.advance(space.begin(space.size - 1), 0, space.size)
            self.assertEqual(space.verified_plan(audit).recovered, (sum(gains), 0))

    def test_large_reference_counts_are_bounds_on_work_in_this_algorithm(self):
        case = ThreeLotBook(17, (5, 5, 5, 5, 6, 8))
        space = search(case.frozen())
        # For each of two debtors the charge digits have bases 6,6,6,6,7,9.
        self.assertEqual(space.size, (6**4 * 7 * 9)**2)
        audit = space.advance(space.begin(0), 0, 1)
        self.assertEqual((audit.status, audit.next_ordinal), ("pending", 1))


if __name__ == "__main__":
    unittest.main()
