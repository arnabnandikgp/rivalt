"""Actual compiled P54A kernel versus independent rational/branch expectations.

The Python proposer is untrusted input. These tests do not activate programs,
authenticate accounts, or infer CU/RPC acceptance from native continuation.
"""
from fractions import Fraction
from math import gcd, lcm
from pathlib import Path
from random import Random
import os
import subprocess
import unittest

from account_contract_reference import Account
from clearing_network_reference import clear_atom_cohort, clear_rational_cohort
from scalable_clearing_candidate import MAX_CLAIM, SCALE
from test_scalable_clearing import samples

DRIVER = Path(os.environ.get("RIVALT_SCALABLE_DRIVER", "target/debug/scalable-settlement-driver")).resolve()


def run(commands):
    result = subprocess.run([str(DRIVER)], input="\n".join(commands)+"\n", text=True,
                            capture_output=True, check=True)
    output = result.stdout.splitlines()
    if len(output) != len(commands):
        raise AssertionError((len(output), len(commands), result.stderr))
    return output


def proposal(common, rates):
    rate_lcm = lcm(*(rate.denominator for rate in rates))
    factor = rate_lcm // gcd(rate_lcm, common)
    return factor, *(int(rate * common * factor) for rate in rates)


def independent_input(rows, pools, insurance, fees=(0, 0)):
    accounts = tuple(Account(cash, tuple(Fraction(claim, SCALE) for claim in claims)) for cash, claims in rows)
    budgets, proposals, common = list(insurance), [], 1
    for cash, claims in rows:
        debts = tuple(max(-claim, 0) for claim in claims)
        total = sum(debts)
        if total:
            collected = min(cash, total // SCALE)
            common = lcm(common, *(Fraction(collected*SCALE*debt, total).denominator for debt in debts))
    for _ in range(3):
        benchmark = clear_rational_cohort(accounts, pools, tuple(budgets), fees, whole_cash_collection=True)
        proposals.append(proposal(common, benchmark.rates))
        fractional = [market for market in range(2) if benchmark.insurance_spent[market].denominator != 1]
        if not fractional:
            break
        for market in fractional:
            budgets[market] = int(benchmark.insurance_spent[market])
    else:
        raise AssertionError("oracle did not finish clipping")
    orders = []
    for market in range(2):
        # Only positive claim edges are outgoing from a market. Other rows
        # remain in the complete permutation but have no forward adjacency.
        def key(index):
            claim = accounts[index].claims[market]
            flow = max(claim, 0) * benchmark.rates[market]
            return (-(flow % 1) if claim > 0 else Fraction(1), index)
        orders.append(tuple(sorted(range(len(rows)), key=key)))
    return accounts, common, proposals, orders


def command(rows, pools, insurance, fees, proposals, orders, budget=128, full=True):
    return "|".join(("full" if full else "compact",
        ";".join(f"{cash},{claims[0]},{claims[1]}" for cash, claims in rows),
        ",".join(map(str, pools)), ",".join(map(str, insurance)), ",".join(map(str, fees)),
        ";".join(",".join(f"{value:x}" for value in item) for item in proposals),
        *( ",".join(map(str, order)) for order in orders), str(budget)))


def decode(line):
    if line.startswith("err:"):
        raise AssertionError(line)
    fields = line.split("|")
    return {
        "common": int(fields[0], 16), "denominator": int(fields[1], 16),
        "spent": tuple(map(int, fields[2].split(","))), "budgets": tuple(map(int, fields[3].split(","))),
        "evaluations": int(fields[4]), "cash": tuple(map(int, fields[5].split(","))),
        "movements": tuple(tuple(map(int, row.split(","))) for row in fields[6].split(";")),
        "residuals": tuple(int(value, 16) for value in fields[7].split(",")),
        "losses": tuple(int(value, 16) for value in fields[8].split(",")),
        "attribution": tuple(tuple(int(value, 16) for value in row.split(",")) for row in fields[9].split(";")) if fields[9] else (),
        "metrics": tuple(map(int, fields[10].split(","))),
        "remaining_insurance": tuple(map(int, fields[11].split(","))),
        "retained_fees": tuple(map(int, fields[12].split(","))),
    }


def assert_work_bounds(count, metrics):
    bits = 88*count + 4*(87+(count-1).bit_length()) + 16
    width = (bits+63)//64
    assert metrics[2] <= width
    assert metrics[0] + metrics[1] <= 2048*(count+1)*(width+16)
    assert metrics[3] <= 3*count*(11*count+32) + 4*count+5
    assert metrics[5] <= 3*count
    assert metrics[8] <= 512*count + 512*width + 4096


class CompiledScalableSettlement(unittest.TestCase):
    def test_literal_populated_cohorts_above_64(self):
        # Each debtor pays its one funded atom against a three-atom loss; the
        # matching isolated creditor receives one. No insurance or cross subsidy.
        block = ((1, (-3*SCALE, 0)), (0, (3*SCALE, 0)),
                 (1, (0, -3*SCALE)), (0, (0, 3*SCALE)))
        cases = [(block*16 + ((17, (0, 0)),), (0, 1, 0, 1)*16 + (17,)),
                 (block*32, (0, 1, 0, 1)*32),
                 (((0, (7*SCALE, -7*SCALE)), (0, (-7*SCALE, 7*SCALE)))*64, (0,)*128)]
        for rows, cash in cases:
            with self.subTest(population=len(rows), cycles=not any(cash)):
                accounts, _, proposals, orders = independent_input(rows, (0, 0), (0, 0))
                oracle = clear_atom_cohort(accounts)
                self.assertEqual(oracle.cash, cash)
                self.assertEqual(oracle.insurance_spent, (0, 0))
                self.assertEqual(oracle.benchmark.rates,
                                 (Fraction(1, 3),)*2 if any(cash) else (Fraction(1),)*2)
                got = decode(run([command(rows, (0, 0), (0, 0), (0, 0), proposals, orders)])[0])
                self.assertEqual(got['cash'], cash)
                self.assertEqual(got['spent'], (0, 0))
                self.assertEqual(got['movements'], oracle.claim_cash_movements)
                assert_work_bounds(len(rows), got['metrics'])

    def test_independent_complete_cohorts(self):
        commands, expected = [], []
        edges = [
            (((10**15-40, (0, 0)),), (0, 0), (0, 0)),
            (((0, (0, 0)),), (0, 0), (40, 80)),
            (((0, (MAX_CLAIM, -MAX_CLAIM)), (0, (-MAX_CLAIM, MAX_CLAIM))), (0, 0), (13, 17)),
            (((10**15-70, (-MAX_CLAIM, -MAX_CLAIM)), (0, (MAX_CLAIM, 0)), (0, (0, MAX_CLAIM))), (0, 0), (13, 17)),
        ]
        for rows, pools, insurance in [*samples(), *edges]:
            fees = (17, 23)
            accounts, common, proposals, orders = independent_input(rows, pools, insurance, fees)
            oracle = clear_atom_cohort(accounts, pools, insurance, fees)
            for budget in (1, 7, 128):
                commands.append(command(rows, pools, insurance, fees, proposals, orders, budget))
                expected.append((rows, common, proposals, oracle, insurance))
        for index, (line, (rows, common, proposals, oracle, insurance)) in enumerate(zip(run(commands), expected)):
            with self.subTest(case=index):
                got = decode(line)
                assert_work_bounds(len(rows), got["metrics"])
                denominator = got["denominator"]
                self.assertEqual(got["common"], common)
                self.assertEqual(denominator, common * proposals[-1][0] * SCALE)
                self.assertEqual(got["spent"], oracle.insurance_spent)
                self.assertEqual(got["remaining_insurance"], tuple(insurance[market]-oracle.insurance_spent[market] for market in range(2)))
                self.assertEqual(got["retained_fees"], (17, 23))
                self.assertEqual(got["budgets"], oracle.effective_insurance_budgets)
                self.assertEqual(got["evaluations"], oracle.insurance_passes)
                self.assertEqual(got["cash"], oracle.cash)
                self.assertEqual(got["movements"], oracle.claim_cash_movements)
                self.assertEqual(got["metrics"][5], oracle.augmentations)
                for member, (_, claims) in enumerate(rows):
                    flows = got["attribution"][member][:3]
                    collections = got["attribution"][member][3:5]
                    residuals = got["attribution"][member][5:7]
                    impairments = got["attribution"][member][7:9]
                    self.assertEqual(Fraction(flows[2], denominator), oracle.benchmark.cash_entitlements[member])
                    for market in range(2):
                        self.assertEqual(Fraction(collections[market], denominator), oracle.benchmark.collections[member][market])
                        self.assertEqual(Fraction(impairments[market], denominator), oracle.benchmark.creditor_impairments[member][market])
                        writeoff = Fraction(residuals[market]*got["losses"][market], denominator*got["residuals"][market]) if got["residuals"][market] else 0
                        self.assertEqual(writeoff, oracle.benchmark.debtor_writeoffs[member][market])
                        sign = (claims[market] > 0) - (claims[market] < 0)
                        adjustment = got["movements"][member][market] - sign*Fraction(flows[market], denominator)
                        self.assertEqual(adjustment, oracle.rounding_adjustments[member][market])
                self.assertTrue(all(sum(got["attribution"][row][5+market] for row in range(len(rows))) == got["residuals"][market] for market in range(2)))
        print(f"{len(expected)} full Rust settlements match independent branch/Fraction cash, insurance, writeoffs and atom owners")

    def test_hostile_proposals_and_inputs(self):
        commands = []
        for rows, pools, insurance in list(samples())[:32]:
            _, _, proposals, orders = independent_input(rows, pools, insurance)
            for mutation in (lambda p: (p[0], p[1]+1, p[2]), lambda p: (0, p[1], p[2]),
                             lambda p: (1 << 302, p[1], p[2])):
                corrupt = list(proposals)
                corrupt[-1] = mutation(corrupt[-1])
                commands.append(command(rows, pools, insurance, (0, 0), corrupt, orders))
            duplicate = [list(order) for order in orders]
            duplicate[0][-1] = duplicate[0][0]
            commands.append(command(rows, pools, insurance, (0, 0), proposals, duplicate))
            commands.append(command(rows, (pools[0]+1, pools[1]), insurance, (0, 0), proposals, orders))
            commands.append(command(rows, pools, insurance, (0, 0), proposals + proposals[-1:], orders))
            commands.append(command(rows, pools, insurance, (0, 0), proposals, orders, budget=0))
            foreign = [list(order) for order in orders]
            foreign[0][-1] = len(rows)
            commands.append(command(rows, pools, insurance, (0, 0), proposals, foreign))
            commands.append(command(rows, pools, insurance, (0, 0), proposals, (orders[0][:-1], orders[1])))
            if len(proposals) > 1:
                commands.append(command(rows, pools, insurance, (0, 0), proposals[-1:], orders))
        cycle = ((0, (SCALE, -SCALE)), (0, (-SCALE, SCALE)))
        for rates in ((1, 0, 0), (2, 1, 1)):
            commands.append(command(cycle, (0, 0), (0, 0), (0, 0), [rates], ((0, 1), (0, 1))))
        # Sorting changes who receives the indivisible atom; a complete but
        # reversed positive-creditor permutation must also reject.
        fractional = ((1, (-3*SCALE, 0)), (0, (2*SCALE, 0)), (0, (SCALE, 0)))
        _, _, proposals, orders = independent_input(fractional, (0, 0), (0, 0))
        commands.append(command(fractional, (0, 0), (0, 0), (0, 0), proposals, (tuple(reversed(orders[0])), orders[1])))
        for rows, pools, fees in (
            (((10**15+1, (0, 0)),), (0, 0), (0, 0)),
            (((10**15, (0, 0)),), (0, 0), (1, 0)),
            (((0, (MAX_CLAIM+1, 0)), (0, (-MAX_CLAIM-1, 0))), (0, 0), (0, 0)),
            (((0, (-(1 << 127), 0)),), (0, 0), (0, 0)),
            (((0, (SCALE, 0)),), (0, 0), (0, 0)),
        ):
            commands.append(command(rows, pools, (0, 0), fees, [(1, 1, 1)], (tuple(range(len(rows))),)*2))
        for line in run(commands):
            self.assertTrue(line.startswith("err:"), line)
        print(f"{len(commands)} hostile/incomplete/non-greatest settlement requests rejected")

    def test_exact_single_digit_division(self):
        rng = Random(540001)
        vectors = []
        for bits in (1, 2, 31, 32, 63, 64, 65, 127, 128, 129, 511, 6144, 6208):
            for _ in range(60):
                denominator = rng.getrandbits(bits) | (1 << (bits-1))
                quotient = rng.choice((0, 1, 2, (1 << 58)-1, rng.randrange(1 << 58)))
                remainder = rng.randrange(denominator)
                vectors.append((quotient*denominator+remainder, denominator))
        # Knuth estimate needs downward correction, and leading zero bits must
        # not hide the high normalization word. These expectations are Python's
        # independent arbitrary-integer divmod, not kernel output called twice.
        for _ in range(200):
            denominator = rng.randrange(1 << 127, 1 << 128)
            quotient = rng.randrange(1 << 58)
            vectors.append((quotient*denominator-1, denominator))
        commands = [f"atoms|{max(n.bit_length(), d.bit_length())//64+3}|{n:x}|{d:x}|7" for n, d in vectors]
        for line, (numerator, denominator) in zip(run(commands), vectors):
            self.assertFalse(line.startswith("err:"), (line, numerator, denominator))
            whole, remainder, _ = line.split("|")
            self.assertEqual((int(whole), int(remainder, 16)), divmod(numerator, denominator))
        for line in run(("atoms|5|1|0|1", f"atoms|5|{1 << 58:x}|1|1", f"atoms|5|{1 << 200:x}|1|1")):
            self.assertTrue(line.startswith("err:"), line)
        print(f"{len(vectors)} exact normalized atom-division vectors matched")

    def test_aggregate_coefficient_envelope(self):
        # Full u64-population arithmetic bound, without pretending to allocate
        # or financially qualify that population: (u64::MAX)*K <2^151, and its
        # two-market determinant products are <2^302, exceeding u128.
        aggregate = ((1 << 64)-1)*MAX_CLAIM
        factors = ((aggregate, aggregate), ((1 << 151)-1, (1 << 151)-1),
                   ((1 << 128)+1, (1 << 150)+17))
        output = run([f"product|8|{left:x}|{right:x}|1" for left, right in factors])
        for line, (left, right) in zip(output, factors):
            self.assertEqual(int(line, 16), left*right)
            self.assertLess(left*right, 1 << 302)


if __name__ == "__main__":
    unittest.main()
