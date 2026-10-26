"""Independent Fraction comparison for the fixed-width P22B integer schedule."""
from fractions import Fraction
import random
import unittest
from account_contract_reference import Account
from clearing_network_reference import clear_atom_cohort
from bounded_clearing_reference import BITS, MAX_CASH, MAX_CLAIM, SCALE, Checked, solve_scaled, finalize_scaled, verify_rate_certificate


class BoundedClearingContract(unittest.TestCase):
    def compare(self, rows, pools=(0, 0), insurance=(0, 0)):
        accounts = tuple(Account(cash, tuple(Fraction(claim, SCALE) for claim in claims)) for cash, claims in rows)
        expected = clear_atom_cohort(accounts, pools, insurance)
        actual = solve_scaled(rows, pools, insurance)
        self.assertEqual(tuple(Fraction(value, actual.common * actual.rate_factor) for value in actual.rate_numerators),
                         expected.benchmark.rates)
        self.assertEqual(tuple(Fraction(value, actual.flow_denominator) for value in actual.cash_numerators),
                         expected.benchmark.cash_entitlements)
        self.assertTrue(verify_rate_certificate(rows, pools, actual.effective_budgets,
                                               actual.rate_numerators, actual.rate_factor))
        self.assertEqual(actual.insurance_spent, expected.insurance_spent)
        self.assertEqual(actual.effective_budgets, expected.effective_insurance_budgets)
        atoms = finalize_scaled(rows, pools, insurance)
        self.assertEqual(atoms.cash, expected.cash)
        self.assertEqual(atoms.signed_movements, expected.claim_cash_movements)
        self.assertEqual(tuple(tuple(Fraction(value, atoms.plan.flow_denominator) for value in row)
                               for row in atoms.adjustment_numerators), expected.rounding_adjustments)
        self.assertLessEqual(actual.maximum_bits, BITS)
        return actual

    def test_selected_default_and_cycle_goldens(self):
        cases = [
            (((100, (-100, 0)), (0, (100, 0)), (0, (0, -100)), (0, (0, 100))), (0, 0)),
            (((100, (-80, -80)), (0, (80, 0)), (0, (0, 80))), (20, 10)),
            (((0, (100, -100)), (40, (-100, 0)), (0, (0, 100))), (10, 20)),
            (((0, (100, -100)), (0, (-100, 100))), (30, 40)),
            (((0, (20, -5)), (0, (-20, 5))), (10, 99)),
            (((0, (2, -1)), (0, (1, 0)), (0, (-3, 0)), (0, (0, 1))), (1, 1)),
        ]
        for rows, insurance in cases:
            self.compare(tuple((cash, tuple(claim * SCALE for claim in claims)) for cash, claims in rows), insurance=insurance)

    def test_seeded_complete_histories_fractional_and_integral(self):
        rng = random.Random(220059)
        for case in range(200):
            count = rng.randrange(2, 13)
            quantum = SCALE if case % 2 else SCALE // 10
            claims = [[rng.randrange(-30, 31) * quantum for _ in range(2)] for _ in range(count - 1)]
            claims.append([-sum(row[market] for row in claims) for market in range(2)])
            rows = tuple((rng.randrange(0, 20), tuple(row)) for row in claims)
            self.compare(rows, insurance=(rng.randrange(0, 10), rng.randrange(0, 10)))

    def test_three_insurance_passes_and_held_cash(self):
        result = self.compare(((2, (0, 0)), (2, (2 * SCALE // 5, SCALE // 5)),
                               (1, (-3 * SCALE // 5, 3 * SCALE // 5)),
                               (2, (SCALE // 5, -4 * SCALE // 5))), insurance=(1, 1))
        self.assertEqual(result.evaluations, 3)
        self.assertEqual(result.insurance_spent, (0, 0))
        self.assertEqual(tuple(value // result.flow_denominator for value in result.cash_numerators), (2, 2, 1, 2))

    def test_large_denominator_64_rows_and_extreme_claims(self):
        # 63 double debtors maximize denominator contributors; one complete
        # cross creditor balances both markets within the frozen claim bound.
        rows = []
        for index in range(63):
            first = MAX_CLAIM // 128 + index * 2 + 1
            second = MAX_CLAIM // 128 + index * 4 + 3
            rows.append((1, (-first, -second)))
        rows.append((0, tuple(-sum(row[1][market] for row in rows) for market in range(2))))
        result = self.compare(tuple(rows), insurance=(13, 17))
        self.assertGreater(result.common.bit_length(), 5000)
        self.assertLess(result.maximum_bits, 6144)

    def test_64_row_maximum_link_census(self):
        rows = tuple((0, (SCALE * (index + 1), -SCALE * (index + 1))) if index % 2 == 0
                     else (0, (-SCALE * index, SCALE * index)) for index in range(64))
        result = self.compare(rows)
        self.assertEqual(result.insurance_spent, (0, 0))
        self.assertEqual(result.cash_numerators, (0,) * 64)

    def test_near_singular_cycle_is_exact(self):
        linked = 10**12
        rows = ((0, (linked, -linked)), (0, (-linked, linked)), (0, (1, 0)),
                (0, (0, 1)), (1, (-1, 0)), (0, (0, -1)))
        result = self.compare(tuple((cash, tuple(claim * SCALE for claim in claims)) for cash, claims in rows))
        self.assertEqual(Fraction(result.rate_numerators[0], result.common * result.rate_factor),
                         Fraction(linked + 1, 2 * linked + 1))

    def test_certificate_rejects_smaller_cashless_cycle_fixed_points(self):
        rows = ((0, (100 * SCALE, -100 * SCALE)), (0, (-100 * SCALE, 100 * SCALE)))
        self.assertFalse(verify_rate_certificate(rows, (0, 0), (0, 0), (0, 0), 1))
        self.assertFalse(verify_rate_certificate(rows, (0, 0), (0, 0), (1, 1), 2))
        self.assertTrue(verify_rate_certificate(rows, (0, 0), (0, 0), (1, 1), 1))
        self.assertFalse(verify_rate_certificate(rows, (0, 0), (0, 0), (1, 0), 1))

    def test_certificate_requires_exact_equations_and_encoding_bounds(self):
        rows = ((1, (-3 * SCALE, 0)), (0, (3 * SCALE, 0)))
        self.assertTrue(verify_rate_certificate(rows, (0, 0), (0, 0), (1, 3), 3))
        self.assertFalse(verify_rate_certificate(rows, (0, 0), (0, 0), (2, 3), 3))
        self.assertFalse(verify_rate_certificate(rows, (0, 0), (0, 0), (1, 3), 0))
        self.assertFalse(verify_rate_certificate(rows, (0, 0), (0, 0), (1, 3), 2**186))

    def test_bounds_and_invariants_reject_instead_of_truncate(self):
        for rows, pools in [(((0, (1, 0)),), (0, 0)),
                            (((MAX_CASH + 1, (0, 0)),), (0, 0)),
                            (((0, (MAX_CLAIM + 1, 0)),), (0, 0)),
                            (tuple((0, (0, 0)) for _ in range(65)), (0, 0))]:
            with self.assertRaises(ValueError):
                solve_scaled(rows, pools)
        checked = Checked()
        self.assertEqual(checked.value((1 << BITS) - 1).bit_length(), BITS)
        with self.assertRaises(OverflowError):
            checked.mul(1 << (BITS - 1), 2)


if __name__ == '__main__':
    unittest.main()
