"""Independent exact-fraction oracle for the fixed-width clearing implementation."""
from fractions import Fraction
from pathlib import Path
from random import Random
import subprocess
import unittest

from account_contract_reference import Account
from market_settlement_reference import MarketBook
from test_authenticated_entry_replay import positions
from test_bounded_entry import MARK, SCALE, fill, signed_member_actions
from test_entry_bounds import evaluate, opposite_histories
from test_scalable_settlement import decode, frozen_book_command, run


def check(actions, available=None):
    states = positions(actions)[1:]
    commands = []
    for action, state in zip(actions, states):
        matched = abs(state.lots) if available is None else min(abs(state.lots), available)
        commands.append(" ".join(map(str, (*action, matched))))
    output = subprocess.run([Path("target/debug/examples/entry_cost_decisions").resolve()],
                            input="\n".join(commands)+"\n", capture_output=True, text=True, check=True)
    rows = [tuple(map(int, line.split())) for line in output.stdout.splitlines()]
    assert len(rows) == len(actions)
    for state, (lots, claim, ordinary, forced, lower, upper, reference) in zip(states, rows):
        assert (lots, claim) == (state.lots, state.claim)
        assert lower <= state.entry*SCALE*reference <= upper and 0 <= upper-lower <= 2*reference
        assert reference >= abs(lots)
        if lots == 0:
            assert (lower, upper, reference) == (0, 0, 0)
        matched = abs(lots) if available is None else min(available, abs(lots))
        def decisions(per_lot):
            return evaluate(per_lot*abs(lots), lots, claim, state.mark, matched)
        exact = decisions(state.entry*SCALE)
        ends = [decisions(Fraction(total, reference or 1)) for total in (lower, upper)]
        assert (ordinary, forced) == tuple(map(min, zip(*ends)))
        assert ordinary <= exact.ordinary <= ordinary+1
        assert forced <= exact.forced <= forced+matched
    return rows


class FixedEntry(unittest.TestCase):
    def test_retained_signed_books(self):
        for rounds, key in [(65, "WALLET"), (69, "DIAGNOSTIC")]:
            for actions in signed_member_actions(rounds, key):
                check(actions)

    def test_rounding_and_frozen_receipts(self):
        mark = MARK+2
        for offset, old in [(-1, (27, 8)), (1, (28, 4))]:
            history = opposite_histories(offset)
            self.assertEqual(check(history)[-1][2:4], old)
            history = history[:-4]+[(26,26*MARK+9,mark,0),(-22,22*MARK+6,mark,0),
                                    (3,3*MARK+1,mark,0),(-5,5*MARK+1,mark,0),fill(1,MARK-1,mark)]
            state = positions(history)[-1]
            self.assertEqual(evaluate(state.entry*SCALE*abs(state.lots), state.lots,
                                      state.claim, mark, abs(state.lots)), old)
            ordinary, charge = check(history)[-1][2:4]
            self.assertEqual((ordinary, charge), (27, 4))
            book = MarketBook((Account(8,(-38+charge,0)), Account(0,(36-charge,0)),
                               Account(0,(2,0))), frozen=True)
            settled = decode(run([frozen_book_command(book)])[0])
            self.assertEqual((settled["cash"],settled["spent"]), ((0,8,0),(0,0)))

    def test_buying_after_a_reduction(self):
        # Six lots cost ten atoms. Retain five, then add two for four atoms.
        actions = [(6,10,2,0),(-1,2,2,0),(2,4,2,0)]
        lower, upper, quantity = check(actions)[-1][4:]
        self.assertEqual(quantity,7)
        self.assertEqual((lower,upper), (37*SCALE//3,(37*SCALE+2)//3))
        self.assertEqual(positions(actions)[-1].entry*quantity, Fraction(37,3))

    def test_split_reductions_and_flip(self):
        for side in (-1, 1):
            mark = MARK+2*side
            open_fill = (6*side, 6*MARK+2*side, mark, 0)
            single = check([open_fill, fill(-3*side,mark,mark)])[-1]
            sliced = check([open_fill]+[fill(-side,mark,mark)]*3)
            self.assertEqual(single,sliced[-1])
            self.assertEqual(sliced[0][4:],sliced[-1][4:])
            flip = (-7*side, 7*MARK+1, mark, 0)
            reversed_position = check([open_fill, flip])[-1]
            self.assertEqual(reversed_position[4:], ((7*MARK+1)*SCALE,)*2+(7,))

    def test_funding_limits_partial_matches_and_churn(self):
        rng = Random(179)
        for available in (0, 1, None):
            actions = []
            for _ in range(350):
                delta = rng.choice([-7,-3,-1,0,1,4,7])
                gross = abs(delta)*(MARK+rng.randint(-5,5))+(rng.randrange(abs(delta)) if delta else 0)
                actions.append((delta,gross,rng.choice([1,MARK-2,MARK+2,1_000_000]),rng.randint(-SCALE,SCALE)))
            check(actions, available)
        for side in (-1,1):
            check([fill(side*100_000_000,1_000_000,1),fill(-side,1,1_000_000),
                   fill(-side*99_999_999,1_000_000,1)])
        self.assertEqual(len(check(opposite_histories(1,rounds=2048))),4101)


if __name__ == "__main__":
    unittest.main()
