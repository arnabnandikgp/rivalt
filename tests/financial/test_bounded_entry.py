"""Compare native production attribution and the fixed-width candidate; amounts in collateral atoms."""
from fractions import Fraction
from pathlib import Path
from typing import NamedTuple
import os
import subprocess
import unittest

from account_contract_reference import Account
from market_settlement_reference import MarketBook, collect, pay
from test_scalable_settlement import decode, frozen_book_command, run

SCALE = 10**9
MARK = 60_000
DRIVER = Path("target/debug/examples/bounded_entry_comparison").resolve()


class Ceilings(NamedTuple):
    cost: int
    exact_pay: int
    bounded_pay: int
    exact_charge: int
    bounded_charge: int


def fill(delta, price, mark=MARK, funding=0):
    return delta, abs(delta) * price, mark, funding


def reference_and_native(actions, available=None, *, intervals=False):
    """Independently value each fill in exact rational atoms and verify the compiled reference."""
    lots, entry, virtual, checkpoint = 0, Fraction(), Fraction(), 0
    expected, commands = [], []
    for delta, gross, mark, funding in actions:
        new = lots + delta
        if delta:
            virtual -= Fraction(lots * (funding-checkpoint), SCALE)
            checkpoint = funding
            virtual -= gross if delta > 0 else -gross
            if not new:
                entry = Fraction()
            elif new*lots <= 0:
                entry = Fraction(gross, abs(delta))
            elif abs(new) > abs(lots):
                entry = (entry * abs(lots) + gross) / abs(new)
        lots = new
        matched = abs(lots) if available is None else min(available, abs(lots))
        claim = virtual + lots * (mark-Fraction(funding-checkpoint, SCALE))
        open_gain = max(0, lots*(mark-entry))
        payable = int(max(0, claim-open_gain))
        room = mark-1 if lots>0 else 1_000_000-mark
        ticks = min(int(open_gain / abs(lots)), room) if lots else 0
        charge = min(int(max(0, claim)), matched*ticks)
        expected.append((lots, claim*SCALE, payable, charge, entry*abs(lots)*SCALE, mark, matched))
        commands.append(f"{delta} {gross} {mark} {funding} {matched}")
    driver = [DRIVER, "--bounds"] if intervals else [DRIVER]
    lines = subprocess.run(driver, input="\n".join(commands)+"\n", text=True,
                           capture_output=True, check=True).stdout.splitlines()
    assert len(lines) == len(expected)
    for line, (lots, claim, pay, charge, cost, mark, matched) in zip(lines, expected):
        fields = line.split()
        quantity, actual_claim, bounded_cost, exact_pay, bounded_pay, exact_charge, bounded_charge = map(int, fields[:7])
        assert (quantity, actual_claim, exact_pay, exact_charge) == (lots, claim, pay, charge)
        if lots >= 0:
            assert bounded_cost <= cost
        else:
            assert bounded_cost >= cost
        assert bounded_pay <= exact_pay and bounded_charge >= exact_charge
        ceilings = Ceilings(bounded_cost, exact_pay, bounded_pay, exact_charge, bounded_charge)
        yield ceilings, fields[7:], lots, claim, cost, mark, matched


def compare(actions, available=None):
    return [row[0] for row in reference_and_native(actions, available)]


def signed_book(rounds):
    # The cycling wallet goes fully flat each round. The maker carries 4 lots,
    # then 2 after the first storage refusal. One row is one successful route.
    trades = [(0, 4, MARK+1)]
    for number in range(1, rounds+1):
        if number == 34:
            trades.append((0, -2, MARK-2))
        size = 16_379 if number <= 33 else 16_381
        trades.extend(((1, size, MARK+2), (1, -size, MARK-2)))
    trades.extend(((0, -1, MARK-2), (0, -1, MARK-2)))
    return [(actor, delta, abs(delta)*price, (abs(delta)*price+4999)//5000) for actor, delta, price in trades]


def signed_member_actions(rounds, key):
    trades = signed_book(rounds)
    if path := os.environ.get("RIVALT_ENTRY_" + key + "_FILLS"):
        decoded = [tuple(map(int, row.split())) for row in Path(path).read_text().splitlines()]
        if decoded != trades:
            raise AssertionError("Generated history differs from finalized receipts")
        trades = decoded
    members = [[], [], []]
    for actor, delta, gross, _fee in trades:
        members[actor].append((delta, gross, MARK, 0))
        members[2].append((-delta, gross, MARK, 0))
    return members


class BoundedEntry(unittest.TestCase):
    def test_retained_maker_and_both_traders(self):
        for rounds, key, net, count, changed in [
            (65, "WALLET", 4_258_808, 134, 127),
            (69, "DIAGNOSTIC", 4_520_904, 142, 135),
        ]:
            members = signed_member_actions(rounds, key)
            self.assertEqual(len(members[2]), count)
            series = [compare(actions) for actions in members]
            self.assertEqual(series[2][-1], (0, net, net, 0, 0))
            self.assertEqual([results[-1] for results in series[:2]], [(0, 0, 0, 0, 0)]*2)
            for member, results in enumerate(series):
                with self.subTest(run=key, member=member):
                    self.assertTrue(all(row.exact_pay == row.bounded_pay for row in results))
                    increases = [row.bounded_charge - row.exact_charge for row in results]
                    self.assertEqual(sum(delta > 0 for delta in increases), changed if member == 2 else 0)
                    self.assertEqual(max(increases), 16_383 if member == 2 else 0)

    def test_splitting_a_reduction_delays_a_payable_atom_for_either_side(self):
        for side in (1, -1):
            exit_price = MARK+2*side
            opening = [(side*6, 6*MARK+2*side, exit_price, 0)]
            block = opening+[fill(-side*3, exit_price, exit_price)]
            split = opening+[fill(-side, exit_price, exit_price)]*3
            self.assertEqual(compare(block)[-1][1:3], (5, 5))
            self.assertEqual(compare(split)[-1][1:3], (5, 4))
            # Pay the interim entitlement out of ten collected atoms, then pay
            # the outstanding remainder after closing the last three lots.
            book = MarketBook((Account(10, (-10, 0)), Account(0, (10, 0))))
            funded = collect(book, 0, 0, 10)
            after_close = compare(split + [fill(-side*3, exit_price, exit_price)])[-1]
            for interim, total in zip(compare(split)[-1][1:3], after_close[1:3]):
                interim_book = pay(funded, 1, 0, interim)
                self.assertEqual(interim_book.accounts[1].cash, interim)
                final = pay(interim_book, 1, 0, total - interim)
                self.assertEqual((final.accounts[1].cash, final.accounts[1].claims, final.pools),
                                 (10, (0, 0), (0, 0)))
            for history in (block,split):
                self.assertEqual(compare(history+[fill(-side*3,exit_price,exit_price)])[-1],(0,10,10,0,0))

    def test_forced_close_can_move_an_atom_between_creditors(self):
        # Exact remaining long entry is MARK + 1/2**30. Its candidate entry is MARK.
        mark = MARK+2
        actions = [fill(1, MARK+1, mark)]+[fill(1,MARK,mark),fill(-1,MARK+1,mark)]*30
        cost, exact_pay, bounded_pay, exact_cap, bounded_cap = compare(actions)[-1]
        self.assertEqual((cost, exact_pay, bounded_pay, exact_cap, bounded_cap), (MARK*SCALE,29,29,1,2))
        # Single-market frozen example. Cash of 8 is assigned to BTC under both
        # plans. Choose the maximum available charge on the sole opposite lot.
        books = [MarketBook((Account(8,(-33+charge,0)),Account(0,(31-charge,0)),Account(0,(2,0))),frozen=True)
                 for charge in (exact_cap,bounded_cap)]
        results = [decode(row) for row in run([frozen_book_command(book) for book in books])]
        self.assertEqual([r["cash"] for r in results], [(0,8,0),(0,7,1)])
        self.assertEqual([r["spent"] for r in results], [(0,0),(0,0)])

    def test_flips_funding_and_width_boundaries(self):
        for side in (1,-1):
            # Three-lot aggregate fill at two prices flips one old lot into two
            # opposite lots. Only the proportional residual opens at the new basis.
            actions = [fill(side,MARK),(-3*side,3*MARK+1,MARK,SCALE//3),
                       fill(2*side,MARK+1,MARK,-SCALE//4)]
            opened, flipped, flat = compare(actions,available=1)
            numerator = (3*MARK+1)*2*SCALE
            self.assertEqual(flipped[0], (numerator+2)//3 if side==1 else numerator//3)
            self.assertEqual((opened[0],flat[0]),(MARK*SCALE,0))
        limit = 100_000_000
        for side in (1,-1):
            rows = compare([fill(side*limit,1_000_000,1_000_000),
                            fill(-side,1_000_000,1_000_000),
                            fill(-side*(limit-1),1_000_000,1_000_000)])
            self.assertEqual([r[0] for r in rows], [10**23,10**23-10**15,0])


if __name__ == "__main__":
    unittest.main()
