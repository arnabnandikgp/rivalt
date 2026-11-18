"""Literal payouts, committed order and rejection checks for the loss cutoff comparison."""
from dataclasses import replace
from itertools import permutations
import unittest

from account_contract_reference import InvalidTransition
from freeze_cutoff_model import (
    CLOSE, OBSERVE, POLICIES, PROVE, REOPEN, Emergency, Observation, PayGain, ProveDefault,
    SupplyValuation, Trade, replay, starting_book,
)
from test_scalable_settlement import decode, frozen_book_command, run


# Five roots: debtor, maker A, maker B, flat creditor, maker C.
HELD = ((0, 13, 7, 0, 0), 0, (0, 117, 103, 110, 100))
CLOSED = ((0, 0, 10, 0, 1), 9, (0, 123, 100, 107, 100))
REOPENED = ((0, 1, 10, 0, 0), 9, (0, 123, 100, 107, 100))


def same_time(*groups):
    return [(1, group) for group in groups]


def amounts(episode, debtor=None):
    plan = episode.payout(debtor)
    return plan.charges, plan.residual, plan.payout.cash


class FreezeCutoffTest(unittest.TestCase):
    def test_all_ordered_interleavings_against_native_terminal_payouts(self):
        commands, expected_cash = [], []
        for order in permutations((OBSERVE, PROVE, CLOSE, REOPEN)):
            observed, proved, closed, reopened = (order.index(op) for op in (OBSERVE, PROVE, CLOSE, REOPEN))
            if observed > proved or closed > reopened:
                continue
            for cutoff in POLICIES:
                boundary = proved if cutoff == "explicit-freeze" else observed
                expected = HELD if boundary < closed else CLOSED if boundary < reopened else REOPENED
                episode, outcomes = replay(starting_book(), same_time(*((op,) for op in order)), cutoff)
                self.assertEqual(episode.boundary, (boundary, 0))
                self.assertEqual(outcomes, tuple("committed" if i <= boundary else "frozen" for i in range(4)))
                self.assertEqual(amounts(episode), expected)
                commands.append(frozen_book_command(episode.payout().after.book))
                expected_cash.append(expected[2])
        self.assertEqual(len(commands), 18)
        for line, cash in zip(run(commands), expected_cash, strict=True):
            actual = decode(line)
            self.assertEqual((actual["cash"], actual["spent"]), (cash, (0, 0)))

    def test_explicit_atomic_observation_and_proof_matches_early_cutoff(self):
        operations = same_time((replace(OBSERVE, witness=None), PROVE), (CLOSE, REOPEN))
        immediate, outcomes = replay(starting_book(), operations, "explicit-freeze")
        self.assertEqual((immediate.boundary, outcomes), ((0, 1), ("committed", "frozen")))
        self.assertEqual(amounts(immediate), HELD)
        earlier, _ = replay(starting_book(), same_time((OBSERVE,), (CLOSE, REOPEN)), "at-observation")
        self.assertEqual((immediate.history, immediate.closeout_price), (earlier.history, earlier.closeout_price))

    def test_witness_coverage_with_omitted_and_solvent_witnesses(self):
        for witness in (None, 1, 2, 3, 4):
            tape = same_time((replace(OBSERVE, witness=witness),), (CLOSE, REOPEN), (PROVE,))
            late, _ = replay(starting_book(), tape, "at-observation")
            complete, _ = replay(starting_book(), tape, "full-scan")
            self.assertEqual((late.boundary, amounts(late)), ((2, 0), REOPENED))
            self.assertEqual((complete.boundary, amounts(complete)), ((0, 0), HELD))

    def test_recovered_price_before_keeper_proof(self):
        tape = same_time((OBSERVE,), (Observation(85, 12, witness=0),), (PROVE,))
        late, outcomes = replay(starting_book(), tape, "explicit-freeze")
        self.assertEqual((late.boundary, outcomes[-1]), (None, "default unproved"))
        debtor = late.history.market.book.accounts[0]
        self.assertEqual(debtor.cash + sum(debtor.claims), 10)
        with self.assertRaises(InvalidTransition):
            late.payout()
        for policy in ("at-observation", "full-scan"):
            earlier, _ = replay(starting_book(), tape, policy)
            self.assertEqual((earlier.closeout_price, amounts(earlier)), (100, HELD))

    def test_failed_proof_in_update_bundle_and_conditional_healthy_witness(self):
        start = starting_book()
        recovery = Observation(85, 12, witness=0)
        combined, failed = replay(start, same_time((recovery, PROVE)), "explicit-freeze")
        self.assertEqual((combined, failed), (start, ("default unproved",)))
        observed, accepted = replay(start, same_time((recovery,)), "at-observation")
        self.assertEqual((observed.boundary, observed.history.market.mark, accepted), (None, 85, ("committed",)))

    def test_committed_funding_is_included_before_testing_the_witness(self):
        # The short's two lots receive 20 at index +10, exactly offsetting the shock.
        observation = replace(OBSERVE, funding=10)
        for policy in POLICIES:
            episode, outcomes = replay(starting_book(), same_time((observation,), (PROVE,)), policy)
            account = episode.history.market.book.accounts[0]
            self.assertEqual((account.cash, account.claims[0], episode.boundary), (20, -20, None))
            self.assertEqual(outcomes[-1], "default unproved")

    def test_no_freeze_for_margin_deficit_alone_and_insurance_is_separate(self):
        start = starting_book()
        # At 90, debtor equity is zero and the two open lots require maintenance.
        for policy in POLICIES:
            solvent, outcomes = replay(start, same_time((Observation(90, 10, witness=0),), (PROVE,)), policy)
            self.assertEqual((solvent.boundary, outcomes[-1]), (None, "default unproved"))
            book = replace(start.history.market.book, insurance=(30, 0))
            insured = replace(start, history=replace(start.history, market=replace(start.history.market, book=book)))
            episode, _ = replay(insured, same_time((OBSERVE,), (PROVE,)), policy)
            result = episode.payout()
            self.assertEqual((result.charges, result.payout.insurance_spent), ((0,) * 5, (20, 0)))

    def test_failed_transaction_rolls_back_bind_price_and_partial_trades(self):
        start = starting_book()
        for policy in POLICIES:
            proof_in_batch = (OBSERVE, PROVE, CLOSE) if policy == "explicit-freeze" else (OBSERVE, CLOSE)
            episode, outcomes = replay(start, same_time(proof_in_batch, (CLOSE, Trade(1, 4, 0, 99))), policy)
            self.assertEqual(episode, start)
            self.assertEqual(outcomes[0], "frozen")
            self.assertNotEqual(outcomes[1], "committed")
        # A bad named witness cannot freeze or commit a purported witness check.
        episode, outcomes = replay(start, same_time((replace(OBSERVE, witness=-1),)), "at-observation")
        self.assertEqual((episode, outcomes), (start, ("unknown member",)))

    def test_backed_payment_before_shock_and_ordinary_rejection_after_shock(self):
        start = starting_book(collection=15)
        self.assertEqual(start.history.market.book.pools, (5, 0))
        for policy in POLICIES:
            # At 90 the debtor can cover its debts. F's early five atoms become funded.
            early, _ = replay(start, same_time((PayGain(3, 5),), (CLOSE, REOPEN), (OBSERVE,), (PROVE,)), policy)
            self.assertEqual(early.history.market.book.accounts[3].cash, 105)
            self.assertEqual(amounts(early)[2], (0, 122, 100, 108, 100))
            # Same five pool atoms, but the debtor is underfunded at 100.
            late, outcomes = replay(start, same_time((CLOSE, REOPEN), (OBSERVE,), (PayGain(3, 5),), (PROVE,)), policy)
            denial = "complete market backing certificate" if policy == "explicit-freeze" else "frozen"
            self.assertEqual(outcomes[2], denial)
            self.assertEqual(late.history.market.book.accounts[3].cash, 100)
            self.assertEqual(amounts(late), REOPENED)

    def test_source_emergency_binds_before_delayed_valuation(self):
        start = starting_book()
        start = replace(start, history=start.history.accrue(1))
        attempts = [(39, (Emergency(True),)), (40, (Emergency(False),)), (40, (PROVE,)),
                    (40, (Emergency(True),)), (41, (CLOSE, REOPEN)), (42, (Observation(125, 50, 7),)),
                    (43, (SupplyValuation(125, 42),))]
        for policy in POLICIES:
            pending, outcomes = replay(start, attempts, policy)
            self.assertEqual(outcomes, ("emergency unproved", "emergency unproved", "default unproved",
                                        "committed", "frozen", "frozen", "invalid valuation"))
            self.assertEqual((pending.boundary, pending.closeout_price), ((3, 0), None))
            with self.assertRaises(InvalidTransition):
                pending.payout()
            valued, settled = replay(start, attempts + [(44, (SupplyValuation(100, 50),)),
                                                        (45, (SupplyValuation(125, 50),))], policy)
            self.assertEqual((valued.history, valued.boundary), (start.history, pending.boundary))
            self.assertEqual((valued.closeout_price, valued.history.funding_index), (100, 1))
            self.assertEqual(settled[-2:], ("committed", "valuation unavailable"))
            with self.assertRaisesRegex(InvalidTransition, "emergency debtor"):
                valued.payout()
            self.assertEqual(amounts(valued, 0), ((0, 12, 6, 0, 0), 0, (0, 117, 103, 110, 100)))

    def test_nonzero_proving_member_is_bound_for_all_cutoffs(self):
        from payment_attribution_model import PaymentHistory
        from freeze_cutoff_model import Episode
        history = PaymentHistory.start("closed-first", (100, 1), 90).trade(0, 1, 1, 90)
        for policy in POLICIES:
            frozen, _ = replay(Episode(history, 10), same_time(
                (Observation(100, 12, witness=1),), (ProveDefault(1),)), policy)
            self.assertEqual(frozen.proving_member, 1)
            self.assertEqual(frozen.payout().payout.cash, (101, 0))
            with self.assertRaisesRegex(InvalidTransition, "different freeze witness"):
                frozen.payout(0)

    def test_malformed_observation_rolls_back_and_later_transactions_run(self):
        for policy in POLICIES:
            for bad in (Observation(None, 12), Observation(100, None), Observation(True, 12)):
                observed, outcomes = replay(starting_book(), same_time(
                    (Observation(85, 15), bad), (OBSERVE,), (PROVE,)), policy)
                self.assertEqual(outcomes[0], "invalid observation")
                self.assertEqual(amounts(observed), HELD)

    def test_expired_observation_does_not_create_a_cutoff(self):
        start = starting_book()
        for policy in POLICIES:
            episode, outcomes = replay(start, [(11, (Observation(100, 10, witness=0),)), (11, (CLOSE,)), (11, (PROVE,))], policy)
            self.assertEqual((episode, outcomes), (start, ("expired observation", "expired source", "default unproved")))


if __name__ == "__main__":
    unittest.main()
