"""Exact persisted wide atom division against Python divmod, not the native solver."""
from pathlib import Path
from random import Random
import subprocess
import unittest
DRIVER=Path('target/debug/scalable-wide-driver').resolve()

class PagedAtomDivision(unittest.TestCase):
    def test_exact_quotient_remainder_and_bounded_resume(self):
        rng=Random(540508)
        pairs=[(0,1),(1,1),(2,3),(2,2),(3,2)]
        for bits in (1,63,64,65,127,128,6143,6144,6145,16383,16384,16385,32767):
            for _ in range(16):
                denominator=(1<<(bits-1))|rng.getrandbits(bits-1)
                quotient=rng.choice([0,1,(1<<58)-1,rng.randrange(1<<58)])
                remainder=rng.randrange(denominator)
                pairs.append((quotient*denominator+remainder,denominator))
        # The two-word quotient prefix ignores this low divisor contribution.
        # The exact product check must correct the one-atom overestimate.
        denominator=(1<<127)+(1<<64)-1
        quotient=(1<<58)-1
        pairs.append((quotient*denominator-1,denominator))
        commands, expected=[],[]
        for numerator,denominator in pairs:
            width=(max(numerator,denominator).bit_length()+63)//64+4
            for budget in (1,7,128):
                commands.append(f'atoms|{width}|{budget}|{numerator:x}|{denominator:x}')
                expected.append((*divmod(numerator,denominator),width))
        lines=subprocess.run([DRIVER],input='\n'.join(commands)+'\n',text=True,capture_output=True,check=True).stdout.splitlines()
        self.assertEqual(len(lines),len(commands));corrected=0
        for line,(quotient,remainder,width) in zip(lines,expected):
            self.assertFalse(line.startswith('err:'),line)
            actual,rest,steps,corrections=line.split('|')
            self.assertEqual(int(actual),quotient);self.assertEqual(int(rest,16),remainder)
            self.assertLessEqual(int(steps),24*width+5);self.assertLessEqual(int(corrections),2)
            corrected+=int(corrections)>0
        self.assertGreater(corrected,0,'missing exact estimate-correction coverage')
        print(f'{len(commands)} persisted atom divisions match divmod; {corrected} corrected estimates; 1/7/128-step budgets')
    def test_zero_denominator_and_excess_quotient_reject(self):
        commands=['atoms|4|1|1|0',f'atoms|8|1|{1<<58:x}|1',f'atoms|8|1|{1<<192:x}|1','atoms|4|0|1|1']
        lines=subprocess.run([DRIVER],input='\n'.join(commands)+'\n',text=True,capture_output=True,check=True).stdout.splitlines()
        self.assertEqual(len(lines),len(commands));self.assertTrue(all(line.startswith('err:') for line in lines),lines)
if __name__=='__main__':unittest.main()
