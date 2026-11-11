"""Actual resumable Rust arithmetic against independent Python integer results.

No settlement/account/RPC acceptance is inferred from these scratch operations.
"""
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

    def test_count_width_and_invalid_divisors(self):
        counts = [1, 64, 65, 128, 1024, 10000, 1 << 32]
        actual = self.run_lines([f'width|{count}' for count in counts])
        for count, value in zip(counts, actual):
            bits = 88 * count + 4 * (87 + (count - 1).bit_length()) + 16
            self.assertEqual(int(value), (bits + 63) // 64)
        for result in self.run_lines(['width|0', 'div|2|1|abc|0', f'div|2|1|abc|{1 << 88:x}',
                                      'add|0|1|0|0', 'add|2|0|1|1', f'mul|8|1|1|{1 << 302:x}']):
            self.assertTrue(result.startswith('err:'))


if __name__ == '__main__':
    unittest.main()
