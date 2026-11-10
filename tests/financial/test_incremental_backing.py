"""Independent explicit-corner checks of the maintained-summary design."""

from itertools import product
from random import Random
import unittest

from incremental_backing_candidate import Backing, Region, Root, SCALE


def independently_bad(root, region, market):
    # Enumerate every combination rather than using the implementation's
    # sign-selected affine minimum. Region minima may be more conservative than
    # the current point; that can withhold a payout, never grant stale credit.
    claims = []
    for prices in product(*[(bounds[0], bounds[1]) for bounds in region.markets]):
        for funding in product(*[(bounds[2], bounds[3]) for bounds in region.markets]):
            claims.append(tuple(root.fixed[index] + root.quantities[index]*(prices[index]*SCALE-funding[index])
                                for index in range(2)))
    may_owe = any(row[market] < 0 for row in claims)
    greatest_debt = max(sum(max(-claim, 0) for claim in row) for row in claims)
    return may_owe and root.cash*SCALE < greatest_debt


class IncrementalBackingCandidate(unittest.TestCase):
    def test_scan_progress_with_mutations_and_fresh_in_region_observations(self):
        region = Region(((9, 11, -SCALE, SCALE), (19, 21, -SCALE, SCALE)))
        roots = {identity: Root(500, (1, -1), (-10*SCALE, 20*SCALE)) for identity in range(128)}
        roots.update({identity+128: Root(500, (-1, 1), (10*SCALE, -20*SCALE)) for identity in range(128)})
        backing = [Backing(roots, region, market) for market in range(2)]
        rng = Random(510003)
        comparisons = 0
        for identity in roots:
            for proof in backing:
                proof.scan(identity)
            # Change already-scanned and not-yet-scanned roots between EVERY
            # page. Some changes make a debtor unbacked; then repair it. No
            # scanned coverage can disappear, and bad contributions cannot hide.
            for _ in range(3):
                changed = rng.randrange(256)
                old = roots[changed]
                roots[changed] = Root(rng.choice((0, 1, 500)), old.quantities, old.fixed)
                for proof in backing:
                    previous_count = len(proof.scanned)
                    proof.mutate({changed: roots[changed]})
                    self.assertEqual(len(proof.scanned), previous_count)
                    self.assertEqual(proof.bad, sum(independently_bad(roots[key], region, proof.market)
                                                    for key in proof.scanned))
                    comparisons += 1
        for identity, old in list(roots.items()):
            roots[identity] = Root(500, old.quantities, old.fixed)
        for proof in backing:
            proof.mutate(roots)
            self.assertTrue(proof.ready(0, (10, 20), (0, 0), current_sources_valid=True))
            self.assertFalse(proof.ready(0, (10, 20), (0, 0), current_sources_valid=False))
            self.assertFalse(proof.ready(0, (12, 20), (0, 0), current_sources_valid=True))
            self.assertFalse(proof.ready(1, (10, 20), (0, 0), current_sources_valid=True))
        print(f"{comparisons} independent backing-summary comparisons; 256-row scan completes amid mutations")

    def test_losing_sibling_market_and_mixed_funding_corner(self):
        region = Region(((0, 0, -60*SCALE, 60*SCALE), (0, 0, -60*SCALE, 60*SCALE)))
        root = Root(100, (1, -1), (0, 0))
        for market in range(2):
            proof = Backing({0: root}, region, market)
            proof.scan(0)
            self.assertEqual(proof.bad, 1)  # Mixed corner owes 120, not diagonal zero.
        region = Region(((0, 0, 0, 0), (0, 0, 0, 0)))
        shared = Root(100, (0, 0), (-60*SCALE, -60*SCALE))
        unrelated = Root(0, (0, 0), (0, -100*SCALE))
        self.assertTrue(independently_bad(shared, region, 0))
        self.assertFalse(independently_bad(unrelated, region, 0))
        proof = Backing({0: shared, 1: unrelated}, region, 0)
        proof.scan(0)
        proof.scan(1)
        self.assertEqual(proof.bad, 1)


if __name__ == "__main__":
    unittest.main()
