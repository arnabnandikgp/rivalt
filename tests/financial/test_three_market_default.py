"""Compare complete native terminal plans, including every whole-atom movement."""
import copy
from fractions import Fraction
import itertools
import json
import os
import random
import subprocess
import unittest

from account_contract_reference import Account
from clearing_network_reference import clear_atom_cohort
from three_market_reference import expected

SCALE = 10**9
MAX_CASH = 10**15
MAX_SCALED_CLAIM = 100_300_000_000_000_000_000_000_000
BINARY = os.environ.get(
    "RIVALT_THREE_MARKET_DRIVER", "target/debug/examples/three_market_default"
)


def book(members, pool=(0, 0, 0), insurance=(0, 0, 0), fees=(0, 0, 0)):
    markets = [
        dict(id=market_id, pool=str(balance), insurance=str(reserve), fees=str(fee))
        for market_id, balance, reserve, fee in zip((3, 8, 38), pool, insurance, fees)
    ]
    rows = []
    for index, (cash, claims) in enumerate(members):
        scaled = [Fraction(claim) * SCALE for claim in claims]
        assert all(value.denominator == 1 for value in scaled)
        rows.append(dict(id=str(100 + index * 13), cash=str(cash), claims=[str(int(x)) for x in scaled]))
    vault = sum(cash for cash, _ in members) + sum(pool) + sum(insurance) + sum(fees)
    return dict(markets=markets, roster=[row["id"] for row in rows], rows=rows, vault=str(vault))


def run(books):
    stream = "".join(json.dumps(data) + "\n" for data in books)
    result = subprocess.run([BINARY], input=stream, text=True, capture_output=True, check=True)
    outputs = [json.loads(line) for line in result.stdout.splitlines()]
    assert len(outputs) == len(books)
    return outputs


def permute(data, order, reverse):
    result = copy.deepcopy(data)
    result["markets"] = [result["markets"][index] for index in order]
    for row in result["rows"]:
        row["claims"] = [row["claims"][index] for index in order]
    if reverse:
        result["rows"].reverse()
        result["roster"] = result["roster"][1:] + result["roster"][:1]
    return result


def split(recovered, insurance=150, face=180, cash=0):
    return book(
        [(cash, (-150, -120, face)), (0, (150, 0, 0)), (0, (0, 120, 0)), (recovered, (0, 0, -face))],
        insurance=(insurance, 0, 0), fees=(7, 11, 13),
    )


class FrozenBookTests(unittest.TestCase):
    def test_split_goldens_and_permutations(self):
        cases = [
            (split(180), (150, 80), 50),
            (split(90), (150, 40), 100),
            (split(0), (150, 0), 150),
            (split(1, 0), (1, 0), 0),
            (split(1), (150, 0), 149),
            (split(300, 0, 300), (150, 120), 0),
        ]
        for original, payouts, spend in cases:
            model = expected(original)
            self.assertEqual(tuple(int(row["cash"]) for row in model["rows"][1:3]), payouts)
            self.assertEqual(tuple(map(int, model["spent"])), (spend, 0, 0))
            variants = [
                permute(original, order, reverse)
                for order in itertools.permutations(range(3)) for reverse in (False, True)
            ]
            self.assertEqual(run(variants), [model] * 12)
        one = expected(split(1, 0))
        self.assertEqual(one["rows"][0]["forwarded"], ["5/9", "4/9", "0"])
        self.assertEqual([row["entitlement"] for row in one["rows"][1:3]], ["5/9", "4/9"])
        clipped = expected(split(1))
        self.assertEqual(clipped["rates"], ["673/675", "1/270", "1/180"])
        self.assertEqual(clipped["left"], ["1", "0", "0"])
        self.assertEqual(expected(split(300, 0, 300))["rows"][0]["cash"], "30")

    def test_complete_mixed_books(self):
        cycle = [(0, (10, -10, 0)), (0, (0, 10, -10)), (0, (-10, 0, 10))]
        leaky_cycle = cycle + [(0, (2, 0, 0)), (1, (-2, 0, 0)), (0, (0, 0, 3)), (2, (0, 0, -3))]
        # Two distinct recoveries share the single remaining six-atom debt cap.
        multi = book([(1, (9, 4, -7)), (2, (-9, 0, 0)), (3, (0, -4, 0)), (0, (0, 0, 7))],
                     insurance=(1, 2, 4))
        mixed = book([(3, (-5, -4, 7)), (1, (4, -2, -1)), (2, (-1, 5, 2)), (0, (2, 1, -8))],
                     insurance=(0, 1, 2))
        tenth = Fraction(1, 10)
        dust = book([(11, (0, 0, 0)), (2, (-3*tenth, -4*tenth, 2*tenth)),
                     (1, (3*tenth, 4*tenth, -2*tenth))], fees=(1, 3, 5))
        pool = book([(0, (-15, -12, 18)), (0, (10, 0, 0)), (0, (5, 12, 0))],
                    pool=(0, 0, 18), insurance=(5, 0, 0))
        # A half-atom reserve draw becomes necessary successively in BTC, ETH and SOL.
        half = Fraction(1, 2)
        cascade = book([(0, (-3*half, 0, 0)), (0, (3*half, -3, 0)), (0, (0, -half, 0)),
                        (0, (0, 7*half, -5)), (0, (0, 0, -half)), (0, (0, 0, 11*half))],
                       insurance=(2, 3, 3))
        fixtures = [book(cycle, insurance=(7, 9, 11)), book(leaky_cycle),
                    multi, mixed, dust, pool, split(90, 11, 180, 33), cascade]
        for data in fixtures:
            variants = [permute(data, order, True) for order in itertools.permutations(range(3))]
            self.assertEqual(run(variants), [expected(data)] * 6)
        closed = expected(fixtures[0])
        self.assertEqual(closed["rates"], ["1"] * 3)
        self.assertEqual(closed["spent"], ["0"] * 3)
        self.assertEqual([row["cash"] for row in closed["rows"]], ["0"] * 3)
        # 12*b = 1 + 10*s, e = b, 13*s = 2 + 10*e.
        self.assertEqual(expected(fixtures[1])["rates"], ["33/56", "33/56", "17/28"])
        self.assertEqual(expected(multi)["rows"][0]["forwarded"], ["0", "0", "6"])
        self.assertEqual(expected(dust)["rows"][0]["cash"], "11")
        self.assertEqual(expected(cascade)["rates"], ["2/3", "6/7", "10/11"])
        self.assertEqual(expected(cascade)["spent"], ["1", "2", "2"])

    def test_numeric_boundaries(self):
        face = Fraction(MAX_SCALED_CLAIM, SCALE)
        tick = Fraction(1, SCALE)
        data = book([(MAX_CASH, (0, 0, 0)), (0, (face, -face, 0)),
                     (0, (-face, tick, face - tick)), (0, (0, face - tick, tick - face))])
        actual, = run([data])
        self.assertEqual(actual, expected(data))
        self.assertEqual(actual["rates"], ["1"] * 3)
        self.assertEqual([row["cash"] for row in actual["rows"]], [str(MAX_CASH), "0", "0", "0"])

    def test_seeded_mixed_books(self):
        rng = random.Random(1103)
        books = []
        for _ in range(32):
            claims = [[Fraction(rng.randint(-12, 12), 10) for _ in range(3)] for _ in range(3)]
            claims.append([-sum(row[m] for row in claims) for m in range(3)])
            members = [(rng.randrange(4), row) for row in claims]
            books.append(book(members, insurance=tuple(rng.randrange(3) for _ in range(3))))
        for index, (data, output) in enumerate(zip(books, run(books))):
            with self.subTest(index=index):
                self.assertEqual(output, expected(data))

    def test_two_market_projection_matches_existing_atom_contract(self):
        rng = random.Random(221)
        books, plans = [], []
        for _ in range(24):
            pairs = [[Fraction(rng.randint(-15, 15), 10) for _ in range(2)] for _ in range(4)]
            pairs.append([-sum(row[m] for row in pairs) for m in range(2)])
            accounts = tuple(Account(rng.randrange(3), tuple(row)) for row in pairs)
            insurance = tuple(rng.randrange(2) for _ in range(2))
            plans.append(clear_atom_cohort(accounts, insurance=insurance))
            books.append(book([(a.cash, (*a.claims, 0)) for a in accounts], insurance=(*insurance, 0)))
        for output, prior in zip(run(books), plans):
            self.assertEqual([r["cash"] for r in output["rows"]], list(map(str, prior.cash)))
            self.assertEqual(output["spent"][:2], list(map(str, prior.insurance_spent)))
            self.assertEqual([r["movements"][:2] for r in output["rows"]],
                             [list(map(str, row)) for row in prior.claim_cash_movements])

    def test_invalid_complete_book_refuses(self):
        cases = []
        for edit in (
            lambda b: b["rows"].pop(),
            lambda b: b["roster"].pop(),
            lambda b: b["roster"].append(b["roster"][0]),
            lambda b: b["rows"][1].update(id=b["rows"][0]["id"]),
            lambda b: b["markets"][1].update(id=3),
            lambda b: b.update(vault="0"),
            lambda b: b["rows"][0]["claims"].__setitem__(1, "-1"),
        ):
            data = split(90)
            edit(data)
            cases.append(data)
        # These control books reconcile financially. Only roster/domain checks can reject them.
        missing_flat = book([(0, (0, 0, 0)), (0, (0, 0, 0))])
        missing_flat["rows"].pop()
        too_large = Fraction(MAX_SCALED_CLAIM + 1, SCALE)
        cases.extend([
            missing_flat, book([(MAX_CASH + 1, (0, 0, 0))]),
            book([(0, (too_large, 0, 0)), (0, (-too_large, 0, 0))]),
        ])
        self.assertEqual([r.get("error") for r in run(cases)],
                         ["Cohort"] * 4 + ["Bounds", "Invariant", "Invariant", "Cohort", "Bounds", "Bounds"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
