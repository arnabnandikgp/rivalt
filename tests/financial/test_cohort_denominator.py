"""Compiled complete-row schedule against independent reduced Fraction LCMs.

Frozen membership/authentication and chain atomicity remain separate acceptance.
"""
from fractions import Fraction
from math import lcm
from random import Random
import test_scalable_wide as wide
import unittest


class CohortDenominator(unittest.TestCase):
    run_lines = wide.ScalableWide.run_lines

    def test_complete_independent_denominators_and_encoded_restarts(self):
        rng = Random(540101)
        cohorts = [[(0, 0, 0)], [(1, -2 * 10**9, -10**9)],
                   [(1, -2 * 10**9, -10**9), (1, -4 * 10**9, -10**9)],
                   [(10**15, -100300000000000000000000000, -100299999999999999999999999)]]
        for size in (2, 7, 64, 128, 257, 1024):
            cohorts.append([(rng.randrange(1, 8), -rng.randrange(1 << 80, 1 << 86),
                             -rng.randrange(1 << 80, 1 << 86)) for _ in range(size)])
        for _ in range(30):
            cohorts.append([(rng.randrange(0, 10**8), rng.randrange(-10**20, 10**20),
                             rng.randrange(-10**20, 10**20)) for _ in range(rng.randrange(1, 30))])
        commands, expected = [], []
        for rows in cohorts:
            denominator = 1
            bound = 1  # initialization is one word write
            for cash, first, second in rows:
                debts = [max(0, -first), max(0, -second)]
                total = sum(debts)
                collected = min(cash, total // 10**9)
                fractions = [Fraction(collected * 10**9 * debt, total) if total else Fraction(0)
                             for debt in debts]
                divisor = lcm(*(value.denominator for value in fractions))
                if divisor != 1:
                    bound += 5 * ((denominator.bit_length() + 63) // 64) + 11
                denominator = lcm(denominator, divisor)
            # Stable IDs are not dense ordinals or 32-bit indices.
            encoded = ';'.join(f'{2**40 + index * 67}:{cash}:{first}:{second}'
                               for index, (cash, first, second) in enumerate(rows))
            for budget in (1, 7, 128):
                commands.append(f'denominators|{budget}|{len(rows)}|{encoded}')
                expected.append((denominator, bound))
        for line, (want, bound) in zip(self.run_lines(commands), expected):
            self.assertFalse(line.startswith('err:'), line)
            actual, used, steps = line.split('|')
            self.assertEqual(int(actual, 16), want)
            self.assertEqual(int(used), (want.bit_length() + 63) // 64)
            self.assertLessEqual(int(steps), bound)
        self.assertGreater(max(value.bit_length() for value, _ in expected), 256 * 64)
        print(f'{len(commands)} complete compiled denominator passes matched independent Fractions')

    def test_bad_count_order_domain_and_incomplete_pass_refuse(self):
        row = '7:1:-2000000000:-1000000000'
        commands = [f'denominators|1|0|{row}', f'denominators|0|1|{row}',
                    f'denominators|1|2|{row}', f'denominators|1|1|{row};{row}',
                    f'denominators|1|2|{row};{row}',
                    f'denominators|1|2|{row};6:0:0:0',
                    'denominators|1|1|0:1000000000000001:0:0',
                    'denominators|1|1|0:0:-100300000000000000000000001:0']
        for command, line in zip(commands, self.run_lines(commands)):
            self.assertTrue(line.startswith('err:'), (command, line))
        print(f'{len(commands)} incomplete, malformed and non-monotone denominator passes rejected')


if __name__ == '__main__':
    unittest.main()
