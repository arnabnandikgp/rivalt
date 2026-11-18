"""Resumable normalized register arithmetic vs independent Python integers.

The real Rust adapter poisons unused words and denies undeclared word accesses.
This is arithmetic/codec evidence, not an authenticated rate or payout proof.
"""
from pathlib import Path
from random import Random
import subprocess
import unittest

DRIVER = Path('target/debug/scalable-wide-driver').resolve()

class NormalizedPages(unittest.TestCase):
    def test_values_dirty_tails_page_boundaries_and_persisted_budgets(self):
        rng = Random(540507)
        pairs = [(0,0),(0,1),(1,0),(1,1)]
        for bits in (63,64,65,6143,6144,6145,16383,16384,16385,32767):
            pairs += [((1 << bits)-1,1),(1 << bits,(1 << bits)-1)]
        for _ in range(96):
            pairs.append((rng.getrandbits(rng.randrange(0,18000)),
                          rng.getrandbits(rng.randrange(0,18000))))
        commands, expected = [], []
        for left, right in pairs:
            factor = rng.getrandbits(rng.randrange(0,303))
            divisor = rng.randrange(1,1 << 88)
            for operation, first, second, argument, want, remainder in (
                ('add',left,right,0,left+right,0),
                ('sub',max(left,right),min(left,right),0,abs(left-right),0),
                ('mul',left,0,factor,left*factor,0),
                ('div',left,0,divisor,left//divisor,left%divisor),
            ):
                # Deliberately overprovision/poison the tails. Step count depends
                # on actual normalized values, not this capacity.
                used = max(1,(max(first,second,want).bit_length()+63)//64)
                for budget in (1,7,128):
                    commands.append(f'normalized|{operation}|{used+19}|{budget}|{first:x}|{second:x}|{argument:x}')
                    expected.append((want,remainder,used))
        result = subprocess.run([DRIVER], input='\n'.join(commands)+'\n',text=True,capture_output=True,check=True)
        lines = result.stdout.splitlines()
        self.assertEqual(len(lines),len(commands))
        for command,line,(want,remainder,used) in zip(commands,lines,expected):
            self.assertFalse(line.startswith('err:'),(command,line))
            actual,length,rest,steps = line.split('|')
            self.assertEqual(int(actual,16),want)
            self.assertEqual(int(length),(want.bit_length()+63)//64)
            self.assertEqual(int(rest,16),remainder)
            # Five factor words may be scanned even when the multiplicand is zero.
            self.assertLessEqual(int(steps),7*(used+5))
        print(f'{len(commands)} normalized paged arithmetic cases match independent integers; dirty tails and 1/7/128-step byte resumes')

    def test_unsupported_domain_and_underflow_reject(self):
        commands = [
            'normalized|add|1|1|ffffffffffffffff|1|0',
            'normalized|sub|4|1|1|2|0',
            'normalized|sub|4|1|0|10000000000000000|0',
            'normalized|div|4|1|1|0|0',
            f'normalized|div|4|1|1|0|{1<<88:x}',
            f'normalized|mul|8|1|1|0|{1<<302:x}',
            'normalized|mul|8|1|1|1|1',
            'normalized|div|8|1|1|1|1',
            'normalized|add|0|1|0|0|0',
            'normalized|add|4|0|0|0|0',
        ]
        lines = subprocess.run([DRIVER], input='\n'.join(commands)+'\n',text=True,capture_output=True,check=True).stdout.splitlines()
        self.assertEqual(len(lines),len(commands))
        self.assertTrue(all(line.startswith('err:') for line in lines),lines)

if __name__ == '__main__':
    unittest.main()
