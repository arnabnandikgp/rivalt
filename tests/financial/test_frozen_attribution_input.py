"""Actual terminal cash controls and independent Fraction-based payment histories."""
from dataclasses import replace
from fractions import Fraction
from random import Random
import unittest

from account_contract_reference import InvalidTransition
from frozen_attribution_input import Fill, Origin, Payment, SCALE, freeze_prefix, pack_survivor, unpack_survivor, verified_survivor
from payment_attribution_model import PaymentHistory
from test_scalable_settlement import decode, frozen_book_command, run

ORIGIN = Origin(bytes(range(32)), 47, 2, 0, 13)


def near_tick(first, cycles):
    history = PaymentHistory.start('closed-first', (4, 0, 0), 100)
    history = history.trade(2, 0, 1, 99).trade(0, 2, 1, 103)
    history = history.trade(1, 0, 1, first)
    events = [Fill(1, first)]
    for step in range(cycles):
        sale = first+2 if step == 0 else 100
        history = history.trade(1, 0, 1, 100).trade(0, 1, 1, sale)
        events.extend((Fill(1, 100), Fill(-1, sale)))
    return history.reprice(102), events


class FrozenInputs(unittest.TestCase):
    def test_same_frozen_rows_and_different_whole_payouts(self):
        rows, commands, heads = [], [], []
        for first, cap in ((99, 2), (101, 1)):
            history, events = near_tick(first, 128)
            rows.append((history.market.book, history.market.lots))
            head = freeze_prefix(ORIGIN, events)
            heads.append(head)
            result = verified_survivor(ORIGIN, head, 1, events)
            self.assertEqual(result.entry_cost, 100+Fraction(first-100,2**128))
            self.assertEqual(result.entry_cost.denominator.bit_length(),129)
            self.assertEqual(result.entry_cost, history.market.entries[1])
            self.assertEqual(result.charge_cap(102, 4*SCALE, 1),cap)
            terminal = history.resolve_at(102)
            self.assertEqual(terminal.charges, (0,cap,0))
            commands.append(frozen_book_command(terminal.after.book))
        self.assertEqual(rows[0],rows[1])
        self.assertNotEqual(heads[0],heads[1])
        self.assertEqual([decode(line)['cash'] for line in run(commands)], [(0,1,3),(0,2,2)])

    def test_check_entire_history_and_origin(self):
        _, events = near_tick(99,3)
        head = freeze_prefix(ORIGIN,events)
        for invalid in (events[:-1], [*events,events[0]], list(reversed(events)),
                        [*events[:2],Fill(-1,102),*events[3:]]):
            with self.assertRaises(InvalidTransition):
                verified_survivor(ORIGIN,head,1,invalid)
        for other in (replace(ORIGIN,venue=bytes(32)),replace(ORIGIN,market=1),replace(ORIGIN,member=48),
                      replace(ORIGIN,activation=3),replace(ORIGIN,generation=14)):
            with self.assertRaises(InvalidTransition):
                verified_survivor(other,head,1,events)
        with self.assertRaises(InvalidTransition):
            verified_survivor(ORIGIN,head,2,events)

    def test_closed_first_replay_matches_full_ledger_through_signed_funding(self):
        # Replay only the investigated member's fills and backed payments. Full ledger
        # generation computes the mark and pre-payment claim independently each time.
        rng = Random(122)
        count = payments = 0
        for trial in range(50):
            history = PaymentHistory.start('closed-first',(100_000,100_000),100)
            events = []
            for step in range(20):
                mark = rng.randrange(90,111)
                history = history.reprice(mark).accrue(Fraction(rng.randrange(-4,5),2))
                delta = rng.choice((-3,-2,-1,1,2,3))
                price = rng.randrange(90,111)
                buyer, seller = (1,0) if delta > 0 else (0,1)
                history = history.trade(buyer,seller,abs(delta),price)
                events.append(Fill(delta,price))
                claim = history.market.book.accounts[1].claims[0]
                if claim >= 1 and history.market.book.accounts[0].cash > 0:
                    payment = min(int(claim), history.market.book.accounts[0].cash, rng.randrange(1,7))
                    history = history.collect_loss(0,payment).pay_gain(1,payment)
                    events.append(Payment(mark,int(claim*SCALE),payment))
                    payments += 1
                lots = history.market.lots[1]
                state = verified_survivor(ORIGIN,freeze_prefix(ORIGIN,events),lots,events)
                self.assertEqual(unpack_survivor(pack_survivor(state)),state)
                self.assertEqual(state.entry_cost, lots*(history.market.entries[1] or 0))
                self.assertEqual(state.unpaid_basis-state.entry_cost, history.paid_open[1])
                positive_claim = max(0,history.market.book.accounts[1].claims[0])
                gross = state.entry_cost if not lots else lots*(mark-history.market.entries[1])
                unpaid = max(0, history.components(1)[0])
                for matched in range(abs(lots)+1):
                    expected = min(int(positive_claim), matched*(max(0,gross)//abs(lots)),
                                   matched*unpaid//abs(lots)) if lots else 0
                    self.assertEqual(state.charge_cap(mark,int(positive_claim*SCALE),matched),expected)
                count += 1
        self.assertEqual(count,1000)
        self.assertGreater(payments,200)
        print(f'{count} history prefixes and {payments} payments')

    def test_checkpoint_restores_exact_result_without_archive(self):
        for cycles in (1, 32, 128, 1024):
            history, events = near_tick(101,cycles)
            head = freeze_prefix(ORIGIN,events)
            state = verified_survivor(ORIGIN,head,1,events)
            encoded = pack_survivor(state)
            fresh = unpack_survivor(encoded)
            self.assertEqual((fresh.charge_cap(102,4*SCALE,1),fresh.entry_cost),
                             (1, history.market.entries[1]))
            self.assertEqual(fresh.apply(Fill(1,100)),state.apply(Fill(1,100)))
            for corrupt in (encoded[:-1], encoded+b'0', encoded[:8]+bytes([2])+encoded[9:]):
                with self.assertRaises(InvalidTransition):
                    unpack_survivor(corrupt)
            print(f'{cycles} partial closes: checkpoint {len(encoded)}, event data {sum(len(e.encode()) for e in events)} bytes')

    def test_reversal_requires_both_price_and_unpaid_bounds(self):
        # Paid-open attribution can turn negative marked profit into a signed fixed claim.
        events = [Fill(-3,110), Payment(100,30*SCALE,14),Fill(1,101),Fill(-1,104)]
        state = verified_survivor(ORIGIN,freeze_prefix(ORIGIN,events),-3,events)
        self.assertEqual(state.entry_cost, -324)
        self.assertEqual(state.unpaid_basis-state.entry_cost, Fraction(28,3))
        self.assertEqual([state.charge_cap(100,50*SCALE,n) for n in range(4)], [0,4,9,14])
        events.append(Fill(5,99))
        flipped = verified_survivor(ORIGIN,freeze_prefix(ORIGIN,events),2,events)
        self.assertEqual((flipped.entry_cost,flipped.unpaid_basis), (198,198))


if __name__ == '__main__':
    unittest.main()
