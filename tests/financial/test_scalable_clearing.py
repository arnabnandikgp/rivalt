"""Feasibility tests: independent branch oracle and actual retained Rust kernel.

These are native financial arithmetic comparisons, not signed/RPC acceptance of
larger cohorts. No program or client activates this experimental candidate.
"""

from fractions import Fraction
from pathlib import Path
from random import Random
import subprocess
import unittest

from account_contract_reference import Account
from clearing_network_reference import clear_atom_cohort
from scalable_clearing_candidate import MAX_CLAIM, SCALE, Work, common_denominator, round_plan, solve
from measure_scalable_clearing import cohort


def samples():
    # Literal claims are in collateral atoms here, converted only at the input.
    goldens = [
        (((0, (100, -100)), (0, (-100, 100))), (0, 0)),
        (((100, (-80, -80)), (0, (80, 0)), (0, (0, 80))), (0, 0)),
        (((0, (100, -100)), (40, (-100, 0)), (0, (0, 100))), (0, 0)),
        # Cashless reciprocal cycle with a creditor OUTSIDE that cycle.
        (((0, (100, -100)), (0, (-100, 80)), (0, (0, 20))), (0, 0)),
        (((0, (20, -5)), (0, (-20, 5))), (0, 0)),
        (((0, (2, -1)), (0, (1, 0)), (0, (-3, 0)), (0, (0, 1))), (0, 0)),
    ]
    for rows, pools in goldens:
        scaled = tuple((cash, tuple(claim * SCALE for claim in claims)) for cash, claims in rows)
        for insurance in ((0, 0), (10, 20)):
            yield scaled, pools, insurance
    # Requires two distinct fractional-insurance clipping passes.
    yield ((2, (0, 0)), (2, (2*SCALE//5, SCALE//5)),
           (1, (-3*SCALE//5, 3*SCALE//5)), (2, (SCALE//5, -4*SCALE//5))), (0, 0), (1, 1)
    rng = Random(510002)
    for sample in range(240):
        count = 64 if sample >= 235 else rng.randrange(2, 25)
        pools = rng.randrange(4), rng.randrange(4)
        quantum = (1, SCALE//10, SCALE)[sample % 3]
        claims = [tuple(rng.randrange(-30, 31) * quantum for _ in range(2)) for _ in range(count-1)]
        claims.append(tuple(pools[market]*SCALE - sum(row[market] for row in claims) for market in range(2)))
        yield tuple((rng.randrange(20), claim) for claim in claims), pools, (rng.randrange(5), rng.randrange(5))
    rows = [(1, (-MAX_CLAIM//128-index*2-1, -MAX_CLAIM//128-index*4-3)) for index in range(63)]
    rows.append((0, tuple(-sum(row[1][market] for row in rows) for market in range(2))))
    yield tuple(rows), (0, 0), (13, 17)


class ScalableClearingCandidate(unittest.TestCase):
    def test_literal_economics(self):
        cycle = ((0, (100*SCALE, -100*SCALE)), (0, (-100*SCALE, 100*SCALE)))
        plan = solve(cycle, insurance=(5, 9))
        self.assertEqual(plan.rates, (1, 1))
        self.assertEqual(plan.insurance_spent, (0, 0))
        self.assertEqual(round_plan(cycle, (0, 0), plan)[0], (0, 0))

        # Own 100 pays two equal debts of 80: 50 per market, rate 5/8,
        # no sharing of a different root's cash and no insurance consumed.
        double_debt = ((100, (-80*SCALE, -80*SCALE)), (0, (80*SCALE, 0)), (0, (0, 80*SCALE)))
        plan = solve(double_debt)
        self.assertEqual(plan.rates, (Fraction(5, 8), Fraction(5, 8)))
        self.assertEqual(round_plan(double_debt, (0, 0), plan)[0], (0, 50, 50))

        # The same cycle now owes an external ETH creditor 20. With no external
        # cash both recoveries are zero. With ten ETH insurance: rBTC=.8*rETH,
        # rETH=rBTC+.1 => rETH=.5, rBTC=.4, outsider receives 10.
        external = ((0, (100*SCALE, -100*SCALE)), (0, (-100*SCALE, 80*SCALE)), (0, (0, 20*SCALE)))
        self.assertEqual(solve(external).rates, (0, 0))
        plan = solve(external, insurance=(0, 10))
        self.assertEqual(plan.rates, (Fraction(2, 5), Fraction(1, 2)))
        self.assertEqual(plan.insurance_spent, (0, 10))
        self.assertEqual(round_plan(external, (0, 0), plan)[0], (0, 0, 10))

    def test_independent_branch_oracle_and_actual_rust(self):
        row_commands, atom_commands, expected_atoms, expected_rows = [], [], [], []
        for rows, pools, insurance in samples():
            accounts = tuple(Account(cash, tuple(Fraction(claim, SCALE) for claim in claims)) for cash, claims in rows)
            oracle = clear_atom_cohort(accounts, pools, insurance)
            plan = solve(rows, pools, insurance)
            cash, movements = round_plan(rows, pools, plan)
            self.assertEqual(plan.rates, oracle.benchmark.rates)
            self.assertEqual(plan.insurance_spent, oracle.insurance_spent)
            self.assertEqual(plan.budgets, oracle.effective_insurance_budgets)
            self.assertEqual(plan.evaluations, oracle.insurance_passes)
            self.assertEqual(cash, oracle.cash)
            self.assertEqual(movements, oracle.claim_cash_movements)
            self.assertEqual(tuple(Fraction(value, plan.denominator) for value in plan.cash_numerators),
                             oracle.benchmark.cash_entitlements)
            self.assertLessEqual(plan.work.composed_intervals, plan.work.curve_segments)
            compact_plan = solve(rows, pools, insurance, compact=True)
            self.assertIsNone(compact_plan.flows)
            self.assertIsNone(compact_plan.cash_numerators)
            self.assertEqual(round_plan(rows, pools, compact_plan, compact=True), (cash, movements))
            self.assertEqual(compact_plan.work.augmentations, plan.work.augmentations)
            self.assertLessEqual(compact_plan.work.arc_visits, plan.work.arc_visits)
            product_plan = solve(rows, pools, insurance, strategy="product")
            self.assertEqual(round_plan(rows, pools, product_plan), (cash, movements))
            self.assertLessEqual(plan.common, product_plan.common)

            # Re-encode EXACT candidate rates against the existing Rust product
            # denominator, without changing that implementation's acceptance.
            old_common = common_denominator(rows, "product", Work())
            denominator = product_plan.denominator
            rates = product_plan.rate_numerators
            prefix = ";".join(f"{initial},{claims[0]},{claims[1]}" for initial, claims in rows)
            prefix += f"|{pools[0]},{pools[1]}|{plan.budgets[0]},{plan.budgets[1]}|"
            row_commands.append(prefix + f"{rates[0]:x},{rates[1]:x},{product_plan.factor:x}")
            expected_rows.append((old_common, denominator, plan.insurance_spent, product_plan.flows))
            # Invalid proposals cannot pass merely because the solver provided them.
            row_commands.append(prefix + f"{rates[0]+1:x},{rates[1]:x},{product_plan.factor:x}")
            expected_rows.append(None)
            encoded = ";".join(f"{initial},{claims[0]},{claims[1]},"
                               f"{abs(product_plan.flows[index][0]):x},{abs(product_plan.flows[index][1]):x}"
                               for index, (initial, claims) in enumerate(rows))
            for step_budget in (1, 128):
                atom_commands.append(encoded + f"|{pools[0]+plan.insurance_spent[0]},{pools[1]+plan.insurance_spent[1]}"
                                     f"|{denominator:x}|{step_budget}")
                expected_atoms.append((cash, movements, plan.work.augmentations))

        for name, commands, expected in (("row", row_commands, expected_rows), ("atoms", atom_commands, expected_atoms)):
            driver = Path(f"target/debug/clearing-{name}-driver").resolve()
            self.assertTrue(driver.exists(), f"build actual financial-core clearing-{name}-driver first")
            result = subprocess.run([str(driver)], input="\n".join(commands)+"\n", text=True, capture_output=True, check=True)
            lines = result.stdout.splitlines()
            self.assertEqual(len(lines), len(expected))
            for index, (line, want) in enumerate(zip(lines, expected)):
                if want is None:
                    self.assertTrue(line.startswith("err:"), (name, index, line))
                    continue
                self.assertFalse(line.startswith("err:"), (name, index, line))
                parts = line.split("|")
                if name == "row":
                    got = (int(parts[0], 16), int(parts[1], 16), tuple(map(int, parts[2].split(","))),
                           tuple(tuple(int(value, 16) for value in row.split(",")) for row in parts[5].split(";")))
                    self.assertEqual(int(parts[3]), 0, "insurance has already been clipped")
                else:
                    got = (tuple(map(int, parts[0].split(","))),
                           tuple(tuple(map(int, row.split(","))) for row in parts[1].split(";")), int(parts[2]))
                self.assertEqual(got, want, (name, index))
        print(f"{len(expected_rows)//2} complete cohorts: independent oracle, {len(expected_rows)} Rust rate/"
              f"mutation cases and {len(expected_atoms)} Rust rounding/continuation cases matched")

    def test_invalid_input_and_resource_exhaustion(self):
        for rows in ((), ((1, (SCALE, 0)),), ((True, (0, 0)),), ((0, (MAX_CLAIM+1, 0)),)):
            with self.assertRaises(ValueError):
                solve(rows)
        rows = ((1, (-2*SCALE, -SCALE)), (0, (2*SCALE, 0)), (0, (0, SCALE)))
        plan = solve(rows)
        with self.assertRaisesRegex(RuntimeError, "no payout plan"):
            round_plan(rows, (0, 0), plan, max_arc_visits=0)

    def test_large_literal_repeated_fraction_and_fee_exclusion(self):
        # Each populated triple owns one cash atom against debts 2 and 1.
        # Across any number of triples each market's recovery is exactly 1/3.
        # Fees are separate retained property and cannot improve that recovery.
        for count in (128, 1024, 10000):
            rows, populated = cohort(count, "repeated-fraction")
            plan = solve(rows, compact=True, fees=(17, 23))
            self.assertEqual(plan.rates, (Fraction(1, 3), Fraction(1, 3)))
            self.assertEqual(plan.insurance_spent, (0, 0))
            self.assertEqual(plan.common, 3)
            cash, movements = round_plan(rows, (0, 0), plan, compact=True)
            self.assertEqual(sum(cash), populated//3)
            self.assertEqual(tuple(sum(row[market] for row in movements) for market in range(2)), (0, 0))
            self.assertLess(plan.work.arc_visits, 2*count)
        with self.assertRaisesRegex(ValueError, "allocated custody"):
            solve(((10**15, (0, 0)),), fees=(1, 0))


if __name__ == "__main__":
    unittest.main()
