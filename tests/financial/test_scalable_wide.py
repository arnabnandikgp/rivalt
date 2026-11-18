"""Actual resumable Rust arithmetic against independent Python integer results.

No settlement/account/RPC acceptance is inferred from these scratch operations.
"""
from fractions import Fraction
from math import lcm
from pathlib import Path
from random import Random
import subprocess
import unittest

DRIVER = Path('target/debug/scalable-wide-driver').resolve()


class ScalableWide(unittest.TestCase):
    def run_lines(self, commands):
        self.assertTrue(DRIVER.exists(), 'Build scalable-wide-driver first')
        result = subprocess.run([str(DRIVER)], input='\n'.join(commands) + '\n', text=True,
                                capture_output=True, check=True)
        lines = result.stdout.splitlines()
        self.assertEqual(len(lines), len(commands))
        return lines

    def test_independent_arithmetic_and_every_resume_budget(self):
        rng = Random(540001)
        cases = []
        for width in [1, 2, 3, 5, 7, 96, 97, 512, 13757]:
            for _ in range(12 if width < 512 else 2):
                left, right = (rng.getrandbits(64 * width) for _ in range(2))
                factor = rng.getrandbits(min(301, 64 * width))
                # Leave actual headroom for nontrivial successful products.
                small_left = left >> factor.bit_length()
                divisor = rng.randrange(1, 1 << 88)
                cases.extend([('add', width, left, right, left + right),
                              ('sub', width, left, right, left - right),
                              ('mul', width, small_left, factor, small_left * factor),
                              ('mul', width, left, factor, left * factor),
                              ('div', width, left, divisor, left // divisor)])
        cases.extend([('add', 2, (1 << 64) - 1, 1, 1 << 64),
                      ('sub', 2, 1 << 64, 1, (1 << 64) - 1),
                      ('mul', 3, (1 << 64) - 1, (1 << 64) - 1, ((1 << 64) - 1)**2),
                      ('mul', 97, 0, (1 << 301) - 1, 0),
                      ('mul', 8, 1, (1 << 302) - 1, (1 << 302) - 1),
                      ('div', 97, (1 << 6208) - 1, (1 << 88) - 1, ((1 << 6208) - 1) // ((1 << 88) - 1))])
        commands, expected = [], []
        for operation, width, left, right, value in cases:
            for budget in (1, 7, 128):
                commands.append(f'{operation}|{width}|{budget}|{left:x}|{right:x}')
                expected.append((operation, width, left, right, value))
        for line, (operation, width, left, right, value) in zip(self.run_lines(commands), expected):
            if value < 0 or value >= 1 << (64 * width):
                self.assertTrue(line.startswith('err:'), (operation, width)); continue
            self.assertFalse(line.startswith('err:'), (operation, width, line))
            actual, remainder, steps, reads, writes = line.split('|')
            self.assertEqual(int(actual or '0', 16), value)
            self.assertEqual(int(remainder, 16), left % right if operation == 'div' else 0)
            bound = width * (1 + max(1, (right.bit_length() + 63) // 64)) if operation == 'mul' else width
            self.assertEqual(int(steps), bound)
            self.assertLessEqual(int(reads) + int(writes), 3 * int(steps))
        print(f'{len(commands)} independent Rust resumable arithmetic cases matched')

    def test_reduced_collection_against_independent_fractions(self):
        rng = Random(540002)
        limit = 100_300_000_000_000_000_000_000_000
        rows = [(100, [-80*10**9, -80*10**9]), (1, [-2*10**9, -10**9]),
                (10**15, [-limit, -limit + 1]), (0, [-limit, limit]), (3, [-10**9, 7])]
        for _ in range(300):
            rows.append((rng.randrange(10**15 + 1), [rng.randrange(-limit, limit + 1) for _ in range(2)]))
        lines = self.run_lines([f'collection|{cash}|{claims[0]}|{claims[1]}' for cash, claims in rows])
        for (cash, claims), line in zip(rows, lines):
            self.assertFalse(line.startswith('err:'))
            collected, denominator, first, second = line.split('|')
            debts = [max(-claim, 0) for claim in claims]
            total = sum(debts)
            want_collected = min(cash, total // 10**9)
            fractions = [Fraction(want_collected * 10**9 * debt, total) if total else Fraction(0) for debt in debts]
            denominator = int(denominator, 16)
            self.assertEqual(int(collected), want_collected)
            self.assertEqual(denominator, lcm(*(value.denominator for value in fractions)))
            self.assertEqual([Fraction(int(value, 16), denominator) for value in (first, second)], fractions)
        for line in self.run_lines([f'collection|0|{limit + 1}|0', 'collection|1000000000000001|0|0']):
            self.assertTrue(line.startswith('err:'))
        print(f'{len(rows)} Rust own-collection rows matched exact independent Fractions')

    def test_lcm_restarts_and_normalized_work_width(self):
        rng = Random(540003)
        pairs = [(1, 1), (3, 3), (3, 9), ((1 << 6401) - 1, (1 << 87) + 1)]
        for _ in range(150):
            pairs.append((rng.getrandbits(rng.randrange(1, 7000)) or 1, rng.randrange(1, 1 << 88)))
        commands, expected = [], []
        for common, divisor in pairs:
            used = (common.bit_length() + 63) // 64
            for budget in (1, 7, 128):
                # Oversized backing storage must not cause a maximum-width scan.
                commands.append(f'lcm|{used + 19}|{budget}|{common:x}|{divisor:x}')
                expected.append((lcm(common, divisor), used))
        for line, (want, input_used) in zip(self.run_lines(commands), expected):
            self.assertFalse(line.startswith('err:'), line)
            actual, used, steps = line.split('|')
            self.assertEqual(int(actual, 16), want)
            self.assertEqual(int(used), (want.bit_length() + 63) // 64)
            self.assertLessEqual(int(steps), 5 * input_used + 11)
        for line in self.run_lines(['lcm|3|1|0|3', 'lcm|3|1|1|0', f'lcm|3|1|1|{1 << 88:x}']):
            self.assertTrue(line.startswith('err:'))
        print(f'{len(commands)} independently checked resumable LCM extensions matched')

    def test_count_width_and_invalid_divisors(self):
        counts = [1, 64, 65, 128, 1024, 10000, 1 << 32]
        actual = self.run_lines([f'width|{count}' for count in counts])
        for count, value in zip(counts, actual):
            bits = 88 * count + 4 * (87 + (count - 1).bit_length()) + 16
            self.assertEqual(int(value), (bits + 63) // 64)
        for result in self.run_lines(['width|0', 'div|2|1|abc|0', f'div|2|1|abc|{1 << 88:x}',
                                      'add|0|1|0|0', 'add|2|0|1|1', f'mul|8|1|1|{1 << 302:x}']):
            self.assertTrue(result.startswith('err:'))

    def test_comparison_bytes_and_bounded_next_accesses(self):
        rng = Random(540004)
        commands, expected = [], []
        for width in (1, 2, 3, 96, 97, 512):
            pairs = [(0, 0), (1, 0), (0, 1)]
            for _ in range(20):
                left, right = (rng.getrandbits(64*width) for _ in range(2))
                pairs.extend(((left, right), (left, left)))
            for left, right in pairs:
                difference = left ^ right
                steps = width if difference == 0 else width - (difference.bit_length()-1)//64
                for budget in (1, 7, 128):
                    commands.append(f'cmp|{width}|{budget}|{left:x}|{right:x}')
                    expected.append(((left > right) - (left < right), steps))
        for line, want in zip(self.run_lines(commands), expected):
            self.assertEqual(tuple(map(int, line.split('|'))), want)
        print(f'{len(commands)} checkpointed exact comparisons and declared word accesses matched')


if __name__ == '__main__':
    unittest.main()
