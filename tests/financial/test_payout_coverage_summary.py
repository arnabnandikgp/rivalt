"""BTC/ETH design comparison. No authority, payout instruction or SBF cost is modeled.

Clearing would have to supply each admitted account's before/after state exactly
once. The summary retains counters only. The exhaustive reference alone sees the
population at query time. Cash shares below are a sufficient proof of debt
coverage, never new restrictions on a trader's positions or collateral.
"""
from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from itertools import product
from random import Random
import unittest

from incremental_backing_candidate import Region, Root, SCALE
from test_incremental_backing import independently_bad
from test_maintained_backing import bounds, csv, row, run


@dataclass
class Warnings:
    count: int = 0
    member_xor: int = 0

    def update(self, member, delta):
        self.count += delta
        self.member_xor ^= member
        assert self.count >= 0 and (self.count or self.member_xor == 0)


class CoverageSummary:
    def __init__(self, marks):
        # Ordered funding-adjusted prices, in scaled quote atoms per lot.
        self.marks = tuple(tuple(price * SCALE for price in axis) for axis in marks)
        self.fixed_shortfalls = [Warnings(), Warnings()]
        # One independent price axis per exposure, for each payout market
        # and direction. There is no Cartesian table of BTC/ETH prices.
        self.breaches = {
            (target, market, side): [Warnings() for _ in self.marks[market]]
            for target, market, side in product(range(2), range(2), (-1, 1))
        }
        self.exposures = {key: Warnings() for key in self.breaches}

    def _record(self, member, root, delta):
        # Reserve exactly the flat debts first. Share the remaining cash
        # equally across open positions, without rounding either share.
        fixed_debt = sum(max(0, -fixed) for lots, fixed in zip(root.quantities, root.fixed)
                         if lots == 0)
        available = root.cash * SCALE - fixed_debt
        open_count = sum(lots != 0 for lots in root.quantities)
        for target in range(2):
            if root.quantities[target] == 0 and root.fixed[target] >= 0:
                continue
            if available < 0:
                self.fixed_shortfalls[target].update(member, delta)
                continue
            for market, (lots, fixed) in enumerate(zip(root.quantities, root.fixed)):
                if lots == 0:
                    continue
                key = (target, market, 1 if lots > 0 else -1)
                self.exposures[key].update(member, delta)
                for index, mark in enumerate(self.marks[market]):
                    if (fixed + lots * mark) * open_count < -available:
                        self.breaches[key][index].update(member, delta)

    def replace(self, member, before=None, after=None):
        if before is not None:
            self._record(member, before, -1)
        if after is not None:
            self._record(member, after, 1)

    def warnings(self, target, region):
        yield self.fixed_shortfalls[target]
        for market, (low, high, funding_low, funding_high) in enumerate(region.markets):
            marks = self.marks[market]
            # Rounding the effective price outwards can withhold a safe payment.
            long_index = bisect_right(marks, low * SCALE - funding_high) - 1
            short_index = bisect_left(marks, high * SCALE - funding_low)
            for side, index in ((1, long_index), (-1, short_index)):
                key = (target, market, side)
                yield (self.breaches[key][index] if 0 <= index < len(marks)
                       else self.exposures[key])

    def exceptions(self, target, region):
        # Only a singleton's XOR identifies every member in that bucket.
        # Refuse ambiguous counts even when the XOR resembles a real ID.
        members = set()
        for warning in self.warnings(target, region):
            if warning.count > 1:
                return None
            if warning.count:
                members.add(warning.member_xor)
        return members

    def covers(self, target, region, supplied):
        required = self.exceptions(target, region)
        if required is None or required != supplied.keys():
            return False
        for root in supplied.values():
            claims = region.minimum_claims(root)
            if claims[target] < 0 and sum(max(-claim, 0) for claim in claims) > root.cash * SCALE:
                return False
        return True


MARKS = (tuple(range(60, 141, 10)), tuple(range(160, 241, 10)))


def account(cash, lots, fixed):
    return Root(cash, lots, tuple(value * SCALE for value in fixed))


def at(btc, eth, funding=(0, 0)):
    return Region(((btc, btc, *funding), (eth, eth, *funding)))


class PayoutCoverageComparison(unittest.TestCase):
    def test_idle_cross_debtor_and_empty_join(self):
        summary = CoverageSummary(MARKS)
        # Zero lots on ETH, but a fixed ETH debt of 40 survives.
        charlie = account(40, (1, 0), (-100, -40))
        summary.replace(0, after=charlie)
        empty = account(0, (0, 0), (0, 0))
        summary.replace(1, after=empty)
        self.assertTrue(summary.covers(1, at(100, 200), {}))
        self.assertEqual(summary.exceptions(1, at(70, 200)), {0})
        self.assertFalse(summary.covers(1, at(70, 200), {0: charlie}))
        self.assertFalse(summary.covers(1, at(70, 200), {}))
        summary.replace(1, before=empty)
        repaired = account(70, (1, 0), (-100, -40))
        summary.replace(0, before=charlie, after=repaired)
        self.assertTrue(summary.covers(1, at(70, 200), {}))
        # Fractional funding makes the same exact-boundary cash insufficient.
        self.assertFalse(summary.covers(1, at(70, 200, (0, 1)), {0: repaired}))

    def test_healthy_accounts_can_be_refused(self):
        cases = (
            # Loss 60 on BTC, zero on ETH, 80 cash. Equal 40/40 shares fail.
            (account(80, (2, 1), (-200, -200)), at(70, 200), 0),
            # A solvent one-lot long at 99 is checked at grid price 90.
            (account(1, (1, 0), (-100, 0)), at(99, 200), 0),
            # BTC is profitable here, but a BTC long could owe at other prices.
            (account(2, (1, 0), (-100, -3)), at(130, 200), 0),
        )
        for root, region, target in cases:
            with self.subTest(root=root):
                summary = CoverageSummary(MARKS)
                summary.replace(7, after=root)
                self.assertFalse(independently_bad(root, region, target))
                self.assertFalse(summary.covers(target, region, {}))
                self.assertTrue(summary.covers(target, region, {7: root}))
                self.assertFalse(summary.covers(target, region, {8: root}))
                # A second warning on the same axis blocks both safe accounts.
                summary.replace(9, after=root)
                self.assertIsNone(summary.exceptions(target, region))
                self.assertFalse(summary.covers(target, region, {7: root, 9: root}))
                summary.replace(7, before=root)
                self.assertTrue(summary.covers(target, region, {9: root}))

    def test_population_churn_and_user_count_independent_reads(self):
        # 500 matched pairs. Both markets have zero net lots and fixed claims.
        # Vary financial membership, then change ONE pair's financial state.
        healthy = account(1000, (1, -1), (-100, 200))
        other_side = account(1000, (-1, 1), (100, -200))
        summary = CoverageSummary(MARKS)
        counts = dict(safe=0, unsafe=0, without_recheck=0, withheld=0)
        regions = [at(btc, eth) for btc, eth in product((60, 85, 100, 115), (170, 200, 237))]
        regions += [at(100, 200, (-SCALE//2, SCALE//2)), at(59, 241)]
        for pairs in (6, 500):
            roots = {member: (other_side if member % 2 else healthy) for member in range(2*pairs)}
            for member, root in roots.items():
                summary.replace(member, after=root)
            changed = healthy
            for cash in (0, 20, 50, 1000):
                candidate = Root(cash, healthy.quantities, healthy.fixed)
                summary.replace(0, before=changed, after=candidate)
                changed = candidate
                roots[0] = candidate
                for region, target in product(regions, range(2)):
                    # Identical roots have identical reference outcomes; all
                    # three distinct rows occur at BOTH tested populations.
                    safe = not any(independently_bad(root, region, target)
                                   for root in (healthy, changed, other_side))
                    required = summary.exceptions(target, region)
                    supplied = {member: roots[member] for member in required or ()}
                    covered = summary.covers(target, region, supplied)
                    self.assertFalse(covered and not safe, (cash, region, target))
                    counts['safe' if safe else 'unsafe'] += 1
                    counts['without_recheck'] += safe and required != set()
                    counts['withheld'] += safe and not covered
            for member, root in roots.items():
                summary.replace(member, before=root)
            self.assertTrue(all(item == Warnings() for item in summary.fixed_shortfalls))
            self.assertTrue(all(item == Warnings() for item in summary.exposures.values()))
            self.assertTrue(all(item == Warnings() for axis in summary.breaches.values() for item in axis))
        self.assertTrue(0 < counts['withheld'] < counts['safe'])
        self.assertGreater(counts['unsafe'], 0)
        self.assertLess(counts['withheld'], counts['without_recheck'])
        print(f"12/1000-member controls: {counts['safe']} reference-safe, "
              f"{counts['without_recheck']} withheld by counters alone, {counts['withheld']} "
              f"withheld after singleton recheck, {counts['unsafe']} unsafe, zero unsafe accepted")

    def test_varied_books_against_native_and_independent_coverage(self):
        # Paired lots and fixed claims reconcile to zero in each market.
        # Only debtor coverage is compared. A pool of zero cannot pay a gain.
        rng = Random(412011)
        requests, expected = [], []
        for _ in range(64):
            summary = CoverageSummary(MARKS)
            roots = {}
            for member in range(0, 8, 2):
                lots = tuple(rng.randint(-2, 2) for _ in range(2))
                fixed = tuple(-quantity * price * SCALE + rng.randint(-20, 20) * SCALE
                              + rng.randint(-1, 1) for quantity, price in zip(lots, (100, 200)))
                roots[member] = Root(rng.randrange(150), lots, fixed)
                roots[member+1] = Root(rng.randrange(150), tuple(-value for value in lots),
                                       tuple(-value for value in fixed))
            for member, root in roots.items():
                summary.replace(member, after=root)
            btc, eth = rng.randrange(70, 130), rng.randrange(170, 230)
            region = Region(((btc-1, btc+1, -SCALE//2, SCALE//2), (eth-2, eth+2, -1, 1)))
            wire = ';'.join(csv(row(root.cash, root.quantities, root.fixed)) for root in roots.values())
            scans = ';'.join(f'scan:{member}' for member in roots)
            for target in (0, 1):
                requests.append(f'sequence|{target}|{bounds(region.markets)}|{wire}|{scans}|0')
                safe = not any(independently_bad(root, region, target) for root in roots.values())
                required = summary.exceptions(target, region)
                covered = summary.covers(target, region, {key: roots[key] for key in required or ()})
                self.assertFalse(covered and not safe)
                expected.append(safe)
        native = [answer.split(';')[-1].split(',')[-1] for answer in run(requests)]
        self.assertEqual(native, [str(int(safe)) for safe in expected])
        self.assertTrue(any(expected) and not all(expected))


if __name__ == '__main__':
    unittest.main()
