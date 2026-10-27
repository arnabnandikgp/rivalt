"""Independent integer vectors against actual fixed-width Rust clearing work.

Run only this phase-owned target. A host arithmetic pass is not SBF/authority/
complete-resolution acceptance. No production/reference arithmetic is imported.
"""
import os
from pathlib import Path
import random
import subprocess
import unittest

BITS = 6144
LIMIT = 1 << BITS


class ClearingWideImplementation(unittest.TestCase):
    def test_independent_exact_operations_and_boundaries(self):
        commands, expected = [], []

        def check(operation, first, second):
            commands.append(f'{operation} {first:x} {second:x}')
            if operation == 'add':
                value = first + second
                result = f'{value:x}' if value < LIMIT else 'err:Overflow'
            elif operation == 'sub':
                result = f'{first-second:x}' if first >= second else 'err:Bounds'
            elif operation == 'mul':
                value = first * second
                result = 'err:Bounds' if second >= 1 << 192 else f'{value:x}' if value < LIMIT else 'err:Overflow'
            elif operation == 'div-small':
                result = 'err:Bounds' if not 0 < second < 1 << 88 else f'{first//second:x} {first%second:x}'
            elif operation == 'div-atoms':
                result = 'err:Bounds' if not second or first//second >= 1 << 58 else f'{first//second:x} {first%second:x}'
            elif operation == 'product-small':
                result = f'{first*second:x}' if max(first, second) < 1 << 93 else 'err:Bounds'
            else:
                raise AssertionError(operation)
            expected.append(result)

        boundaries = [0, 1, (1 << 64)-1, 1 << 64, (1 << 128)-1, 1 << 128, LIMIT-1]
        for first in boundaries:
            for second in boundaries:
                for operation in ['add', 'sub', 'mul', 'div-small', 'div-atoms', 'product-small']:
                    check(operation, first, second)
        rng = random.Random(260001)
        for _ in range(250):
            first = rng.getrandbits(rng.randrange(BITS+1))
            second = rng.getrandbits(rng.randrange(BITS+1))
            check('add', first, second)
            check('sub', first, second)
            check('mul', first, rng.getrandbits(rng.randrange(193)))
            check('div-small', first, rng.randrange(1, 1 << 88))
            check('product-small', rng.getrandbits(93), rng.getrandbits(93))
            divisor = rng.getrandbits(rng.randrange(1, BITS+1)) or 1
            quotient = rng.randrange(1 << 58)
            remainder = rng.randrange(divisor)
            value = divisor*quotient+remainder
            if value < LIMIT:
                check('div-atoms', value, divisor)
            check('div-atoms', first, second)
        for divisor in [1, (1 << 64)+1, 1 << 6000, LIMIT-1]:
            for quotient in [0, 1, (1 << 58)-1, 1 << 58]:
                value=divisor*quotient
                if value < LIMIT:
                    check('div-atoms', value, divisor)
        # Maximum-width nontrivial denominator, representing the >5,000-bit L case.
        for divisor in [(1 << 87)-1, (1 << 88)-1, 1 << 88]:
            check('div-small', LIMIT-1, divisor)
        driver=Path(os.environ.get('RIVALT_WIDE_DRIVER','target/debug/clearing-wide-driver'))
        result=subprocess.run([str(driver.resolve())],input='\n'.join(commands)+'\n',text=True,capture_output=True,check=True)
        actual=result.stdout.splitlines()
        self.assertEqual(len(actual),len(expected))
        for index,(got,want) in enumerate(zip(actual,expected)):
            self.assertEqual(got,want,f'case {index}: {commands[index]}')
        print(f'{len(commands)} independent fixed-width operation cases passed')


if __name__ == '__main__':
    unittest.main()
