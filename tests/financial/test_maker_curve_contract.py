"""Independent P29B contract checks; no production-program acceptance implied."""
import itertools
import random
import unittest
from dataclasses import replace

from maker_curve_reference import (
    Candidate, Curve, LAYOUTS, MAX_DEPTH, MAX_POSITION, Publication, Region,
    SCALE, allocations, best_route, capacity, fee, funding_quote, health, held_index, offsets, packet_size,
    Position, premium, quote,
)


def walk_quote(curve, anchor, side, lots, inventory, consumed):
    """Independent per-lot evaluator: does not use prefix/potential/quote."""
    regions = curve.asks if side == 0 else curve.bids
    prices = []
    for index in range(lots):
        start = 0
        for region in regions:
            if consumed + index < region.end:
                spread = region.offset + region.slope * (consumed + index - start)
                break
            start = region.end
        else:
            raise ValueError("depth")
        current = inventory - index if side == 0 else inventory + index
        next_inventory = current - 1 if side == 0 else current + 1
        before, after = abs(current - curve.target), abs(next_inventory - curve.target)
        skew = (min(before, after) // curve.step) * curve.tick
        if after < before:
            skew = -skew
        prices.append(anchor + spread + skew if side == 0 else anchor - spread - skew)
    return sum(prices), prices


def brute_route(candidates, side, lots, accepted, prior=0):
    """Separate Cartesian allocation oracle, deliberately not pair enumeration."""
    answers = []
    candidates = tuple(sorted(candidates, key=lambda maker: maker.instance))
    for sizes in itertools.product(range(lots + 1), repeat=len(candidates)):
        if sum(sizes) != lots or not 1 <= sum(size > 0 for size in sizes) <= 2:
            continue
        legs = tuple((maker, size) for maker, size in zip(candidates, sizes) if size)
        amounts = []
        try:
            for maker, size in legs:
                # Fixtures deliberately use generous position caps and positive prices.
                amount, _ = walk_quote(maker.curve, maker.anchor, side, size,
                                       maker.inventory, maker.consumed)
                amounts.append(amount)
        except ValueError:
            continue
        total = sum(amounts)
        charge = (prior + total + 4999) // 5000 - (prior + 4999) // 5000
        if not accepted(legs, amounts, charge):
            continue
        identity = tuple(maker.instance for maker, _ in legs)
        key = (total + charge if side == 0 else charge - total,
               len(legs), identity, -legs[0][1])
        answers.append((key, tuple((maker.instance, size) for maker, size in legs), total, charge))
    return min(answers)[1:] if answers else None


class PricingContract(unittest.TestCase):
    def setUp(self):
        self.curve = Curve((Region(3, 2, 1), Region(8, 8, 0)),
                           (Region(3, 3, 2), Region(8, 12, 0)), step=2, tick=2)

    def test_literal_golden_vectors(self):
        cases = [(0, 3, 0, 0, 317), (0, 4, 0, 0, 431),
                 (1, 3, 0, 0, 289), (0, 3, 3, 0, 313),
                 (1, 3, -3, 0, 293), (0, 1, -3, 3, 114)]
        for side, lots, inventory, consumed, expected in cases:
            with self.subTest(case=(side, lots, inventory, consumed)):
                self.assertEqual(quote(self.curve, 100, side, lots, inventory, consumed), expected)
                self.assertEqual(walk_quote(self.curve, 100, side, lots, inventory, consumed)[0], expected)

    def test_independent_lot_walk_at_all_small_boundaries(self):
        for side, inventory, consumed in itertools.product((0, 1), range(-8, 9), range(8)):
            for lots in range(1, 9 - consumed):
                walked, prices = walk_quote(self.curve, 100, side, lots, inventory, consumed)
                self.assertEqual(quote(self.curve, 100, side, lots, inventory, consumed), walked)
                self.assertEqual(prices, sorted(prices, reverse=bool(side)))

    def test_fragmented_fills_telescope_across_regions_and_inventory_zero(self):
        for side, inventory in itertools.product((0, 1), range(-8, 9)):
            for total in range(2, 9):
                for first in range(1, total):
                    after = inventory + (first if side else -first)
                    split = quote(self.curve, 100, side, first, inventory, 0)
                    split += quote(self.curve, 100, side, total - first, after, first)
                    self.assertEqual(split, quote(self.curve, 100, side, total, inventory, 0))

    def test_round_trip_cannot_extract_inventory_skew(self):
        for inventory, lots in itertools.product(range(-8, 9), range(1, 9)):
            bought = quote(self.curve, 100, 0, lots, inventory, 0)
            sold = quote(self.curve, 100, 1, lots, inventory - lots, 0)
            self.assertGreaterEqual(bought - sold, 0)

    def test_curves_reject_bad_regions_and_limits(self):
        for regions in ((Region(0, 0, 0),), (Region(4097, 0, 0),),
                        (Region(3, 10, 1), Region(5, 11, 0)),
                        (Region(2, 0, 1001),), (Region(2, 1_000_000, 1),),
                        tuple(Region(index + 1, index, 0) for index in range(9))):
            with self.assertRaises(ValueError):
                Curve(regions, ())
        for kwargs in ({"step": 0}, {"tick": 1001}, {"target": MAX_POSITION + 1}):
            with self.assertRaises(ValueError):
                replace(self.curve, **kwargs)

    def test_nonpositive_and_overflowing_marginal_prices_reject(self):
        with self.assertRaises(ValueError):
            quote(self.curve, 2, 1, 1, 0, 0)
        with self.assertRaises(ValueError):
            quote(self.curve, 1_000_000, 0, 1, 0, 0)
        with self.assertRaises(ValueError):
            quote(self.curve, 100, 0, 0, 0, 0)

    def test_capacity_one_sided_reduce_only_and_consumption(self):
        curve = replace(self.curve, bids=(), short_cap=2, long_cap=4)
        self.assertEqual(capacity(curve, 1, 0, 0), 0)
        self.assertEqual(capacity(curve, 0, -1, 0), 1)
        self.assertEqual(capacity(curve, 0, 0, 8), 0)
        self.assertEqual(capacity(replace(curve, reduce_only=True), 0, 3, 0), 3)
        self.assertEqual(capacity(replace(curve, reduce_only=True), 0, -1, 0), 0)
        # Shape replacement is allowed to shorten depth below existing consumption.
        short = replace(self.curve, asks=(Region(2, 3, 0),))
        self.assertEqual(capacity(short, 0, 0, 7), 0)

    def test_maximum_legal_arithmetic_is_bounded(self):
        curve = Curve((Region(MAX_DEPTH, 0, 0),), (Region(MAX_DEPTH, 0, 0),),
                      step=1, tick=0)
        self.assertEqual(quote(curve, 1_000_000, 0, 4096, MAX_POSITION, 0), 4_096_000_000)
        # Huge potential itself fits i128; invalid resulting prices still reject.
        with self.assertRaises(ValueError):
            quote(replace(curve, tick=1000, target=-MAX_POSITION),
                  1_000_000, 0, 4096, MAX_POSITION, 0)


class PublicationContract(unittest.TestCase):
    def publish(self, state=Publication(), **changes):
        args = dict(actor="updater", owner="owner", updater="updater", updater_expiry=900,
                    expected_control=state.control, expected_sequence=state.sequence,
                    anchor=100, slot=100, time=200)
        args.update(changes)
        return state.reprice(**args)

    def test_repricing_preserves_depth_shape_and_route_bindings(self):
        state = Publication(buy_consumed=13, sell_consumed=7)
        updated = self.publish(state)
        self.assertEqual((updated.buy_consumed, updated.sell_consumed), (13, 7))
        self.assertEqual(updated.binding(), state.binding())
        self.assertEqual(updated.sequence, 1)
        updated_again = self.publish(updated, anchor=102)
        self.assertEqual(updated_again.binding(), state.binding())
        self.assertEqual(updated_again.anchor, 102)

    def test_bad_authority_duplicate_reordered_and_expired_updater(self):
        state = self.publish()
        for changes in ({"actor": "stranger"}, {"expected_sequence": 0},
                        {"expected_sequence": 2}, {"expected_control": 2}, {"slot": 900}):
            with self.assertRaises(ValueError):
                self.publish(state, **changes)
        self.assertEqual(self.publish(state, actor="owner", slot=900).sequence, 2)

    def test_validity_has_exclusive_slot_and_time_deadlines(self):
        state = self.publish()
        self.assertTrue(state.valid(249, 205))
        for slot, time in ((250, 205), (249, 206), (99, 200), (100, 199)):
            self.assertFalse(state.valid(slot, time))
        self.assertFalse(Publication().valid(0, 0))
        self.assertFalse(replace(state, enabled=False).valid(101, 201))

    def test_shape_does_not_replenish_and_replenishment_breaks_binding(self):
        state = Publication(buy_consumed=8, sell_consumed=9)
        shaped = state.replace_shape()
        self.assertEqual((shaped.buy_consumed, shaped.sell_consumed), (8, 9))
        self.assertNotEqual(state.binding(), shaped.binding())
        replenished = state.replenish(1)
        self.assertEqual((replenished.buy_consumed, replenished.sell_consumed), (0, 9))
        self.assertNotEqual(state.binding(), replenished.binding())
        with self.assertRaises(ValueError):
            state.replenish(0)

    def test_sequence_overflow_fails_without_wrapping(self):
        with self.assertRaises(ValueError):
            self.publish(Publication(sequence=(1 << 64) - 1))
        with self.assertRaises(ValueError):
            Publication(depth=(1 << 64) - 1).replenish(3)


class AllocationContract(unittest.TestCase):
    def setUp(self):
        self.candidates = tuple(Candidate(index, f"capital-{index}",
            Curve((Region(8, spread, slope),), (Region(8, spread, slope),), tick=0), 1000)
            for index, spread, slope in ((0, 1, 4), (1, 4, 1), (2, 3, 2)))

    def test_golden_three_candidate_route(self):
        # Four lots: 1001+1005 from maker 0, 1003+1005 from maker 2.
        # Maker 0 + maker 1 costs 4015; the third candidate improves by one atom.
        self.assertEqual(best_route(self.candidates, 0, 4), (((0, 2), (2, 2)), 4014, 1))
        self.assertEqual(best_route(self.candidates, 1, 4), (((0, 2), (2, 2)), 3986, 1))

    def test_all_permutations_and_nonprefix_feasibility_match_cartesian_oracle(self):
        def accepted(legs, amounts, charge):
            # Models reservation/health holes; no monotone-prefix assumption.
            return all(size not in (2, 5) if maker.instance == 0 else True for maker, size in legs)
        for permutation in itertools.permutations(self.candidates):
            for side, lots in itertools.product((0, 1), range(1, 10)):
                self.assertEqual(best_route(permutation, side, lots, accepted, 4998),
                                 brute_route(permutation, side, lots, accepted, 4998))

    def test_random_exact_search_and_unequal_remaining_depth(self):
        rng = random.Random(2902)
        for _ in range(80):
            makers = tuple(replace(maker, inventory=rng.randrange(-4, 5),
                                   consumed=rng.randrange(4), anchor=1000 + rng.randrange(-5, 6),
                                   curve=replace(maker.curve, tick=rng.randrange(1, 4),
                                                 step=rng.randrange(1, 4)))
                           for maker in self.candidates)
            side, lots = rng.randrange(2), rng.randrange(1, 10)
            self.assertEqual(best_route(makers, side, lots),
                             brute_route(makers, side, lots, lambda *_: True))

    def test_aliases_and_bad_instance_reject(self):
        for makers in ((self.candidates[0], replace(self.candidates[1], capital="capital-0")),
                       (self.candidates[0], replace(self.candidates[1], instance=0)),
                       (replace(self.candidates[0], instance=3),)):
            with self.assertRaises(ValueError):
                best_route(makers, 0, 1)

    def test_singleton_ties_and_explicit_limit_after_reprice(self):
        flat = Curve((Region(8, 0, 0),), (Region(8, 0, 0),), tick=0)
        makers = tuple(replace(maker, curve=flat) for maker in self.candidates)
        self.assertEqual(best_route(makers, 0, 4), (((0, 4),), 4000, 1))
        repriced = tuple(replace(maker, anchor=1001) for maker in makers)
        self.assertIsNone(best_route(repriced, 0, 4,
                                    lambda legs, amounts, charge: sum(amounts) + charge <= 4001))

    def test_fee_prefix_and_full_root_admission(self):
        self.assertEqual((fee(4999), fee(5001), fee(5001) - fee(4999)), (1, 2, 1))
        self.assertEqual(fee(2000) + fee(2000), 2)  # two independent transactions
        self.assertEqual(fee(4000), 1)  # one route or the stored-order prefix total
        neutral = Position(1, -100 * SCALE, 100, 100)
        positive = Position(1, 1_000_000 * SCALE, 100, 100)
        self.assertEqual(health(20, (neutral, positive))[:2], (20 * SCALE, 20 * SCALE))
        # A second market loss of one scaled unit breaks exact boundary admission.
        negative = Position(0, -1, 100, 100)
        equity, initial, _ = health(10, (neutral, negative))
        self.assertLess(equity, initial)
        self.assertLess(health(10, (replace(neutral, funding_delta=1),))[0], initial)
        self.assertLess(health(10, (neutral,), reserved=1)[0], health(10, (neutral,), reserved=1)[1])
        self.assertLess(health(9, (neutral,))[0], initial)  # aggregate taker fee

    def test_maximum_enumeration_bound(self):
        for quantity in (1, 4096, 4097, 4608):
            count = sum(1 for _ in allocations(self.candidates, quantity))
            self.assertLessEqual(count, 12_291)
        self.assertEqual(sum(1 for _ in allocations(self.candidates, 4097)), 12_291)

    def test_funding_quantity_rounding_and_signed_truncation(self):
        self.assertEqual(premium(10_000, 600, 5_994_000, 6_012_000), 5 * SCALE)
        self.assertEqual(premium(10_000, 600, 5_988_000, 6_006_000), -5 * SCALE)
        self.assertEqual(premium(10_000, 600, 6_000_000, 7_000_000), 50 * SCALE)
        with self.assertRaises(ValueError):
            premium(10_001, 599, 5_994_000, 6_012_000)
        with self.assertRaises(ValueError):
            premium(10_000, 600, 6_000_001, 6_000_000)


class WireAndResourceContract(unittest.TestCase):
    def test_layout_sizes_and_offsets_are_frozen(self):
        expected = {"LiquidityRegistry": 173, "MakerRegistration": 333,
                    "MakerCurve": 691, "MakerPrice": 83}
        self.assertEqual({name: offsets(name)[1] for name in LAYOUTS}, expected)
        self.assertEqual(offsets("MakerPrice")[0]["sequence"], 50)
        self.assertEqual(offsets("MakerRegistration")[0]["buy_consumed"], 315)

    def test_historical_v0_size_model_not_current_transport_acceptance(self):
        # Route: conservative 32 unique keys, 32 ix references, <=256 bytes data.
        self.assertGreater(packet_size(32, ((32, 256),)), 1232)
        self.assertLessEqual(packet_size(10, ((32, 256),), 8, 14), 1232)
        # Funding full coverage: <=32 keys/references, <=64-byte data.
        self.assertLessEqual(packet_size(10, ((32, 64),), 8, 14), 1232)
        # Shape gateway: 16 keys, 16 references, <=512-byte args incl discriminator.
        self.assertLessEqual(packet_size(8, ((16, 512),), 4, 4), 1232)
        self.assertEqual(packet_size(11, ((18, 512),), 4, 3, signatures=3), 1179)
        # Cheap reprice: signer/config/price/event-authority/program/compute.
        self.assertLessEqual(packet_size(6, ((5, 32),)), 512)


class FundingContract(unittest.TestCase):
    def setUp(self):
        self.curve = Curve((Region(600, 10, 0),), (Region(600, 10, 0),), tick=0)
        self.makers = tuple(Candidate(index, f"capital-{index}", self.curve, 10_000)
                            for index in range(3))
        self.publications = (Publication(sequence=1, anchor=10_000, slot=10, time=20),) * 3

    def test_complete_coverage_even_when_third_maker_is_not_selected(self):
        bid, ask, rate = funding_quote(self.makers, self.publications, 10_000, 11, 21)
        self.assertEqual((bid, ask, rate), ((((0, 600),), 5_994_000, 0),
                                           (((0, 600),), 6_006_000, 0), 0))
        with self.assertRaises(ValueError):
            funding_quote(self.makers[:2], self.publications[:2], 10_000, 11, 21)
        bad = (*self.publications[:2], replace(self.publications[2], enabled=False))
        with self.assertRaises(ValueError):
            funding_quote(self.makers, bad, 10_000, 11, 21)
        with self.assertRaises(ValueError):
            funding_quote(self.makers, self.publications, 10_000, 11, 26)

    def test_one_sided_and_zero_capital_capacity_are_explicit(self):
        makers = (replace(self.makers[0], curve=replace(self.curve, bids=())),
                  replace(self.makers[1], curve=replace(self.curve, asks=())),
                  replace(self.makers[2], curve=replace(self.curve, long_cap=0, short_cap=0)))
        bid, ask, _ = funding_quote(makers, self.publications, 10_000, 11, 21)
        self.assertEqual((bid[0], ask[0]), (((1, 600),), ((0, 600),)))
        # A financial execution predicate can reject every trade without
        # removing these same published prices from D74 funding.
        self.assertIsNone(best_route(makers, 0, 600, lambda *_: False))

    def test_published_funding_preserves_independent_price_band(self):
        outside = tuple(replace(maker, anchor=12_000) for maker in self.makers)
        with self.assertRaises(ValueError):
            funding_quote(outside, self.publications, 10_000, 11, 21)

    def test_structural_truncation_keeps_accrued_funding_and_reprice_is_causal(self):
        self.assertEqual(held_index(100, 3600, 10, 16, 13), 103)
        # Materialize first, then turn off the old future interval.
        new_base = held_index(100, 3600, 10, 16, 13)
        self.assertEqual(held_index(new_base, 3600, 10, 10, 15), 103)
        # Pure repricing doesn't change the old premium/endpoint.
        self.assertEqual(held_index(100, 3600, 10, 16, 99), 106)
        self.assertEqual(held_index(100, -1, 10, 16, 13), 100)  # trunc toward zero


if __name__ == "__main__":
    unittest.main()
