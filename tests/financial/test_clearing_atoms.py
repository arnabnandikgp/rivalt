"""Independent integer/Fraction expected flows versus actual fixed-array DFS.

Includes one-edge continuations, reverse repair paths and the 64-member bound;
program authentication/application and signed budgets remain separate gates.
"""
from pathlib import Path
from random import Random
from subprocess import run
import unittest
from bounded_clearing_reference import finalize_scaled

SCALE=10**9
class ActualAtomCirculation(unittest.TestCase):
    def test_fixed_storage_matches_independent_conserving_schedule(self):
        rng=Random(260003)
        cases=[(((0,(100*SCALE,-100*SCALE)),(0,(-100*SCALE,100*SCALE))),(0,0),(0,0)),
            (((100,(-80*SCALE,-80*SCALE)),(0,(80*SCALE,0)),(0,(0,80*SCALE))),(0,0),(0,0)),
            (((0,(20*SCALE,-5*SCALE)),(0,(-20*SCALE,5*SCALE))),(0,0),(0,0))]
        for sample in range(180):
            count=64 if sample>=170 else rng.randrange(2,17)
            quantum=SCALE//10 if sample%2 else SCALE
            pools=(rng.randrange(4),rng.randrange(4))
            claims=[(rng.randrange(-30,31)*quantum,rng.randrange(-30,31)*quantum) for _ in range(count-1)]
            claims.append(tuple(pools[m]*SCALE-sum(row[m] for row in claims) for m in range(2)))
            rows=tuple((rng.randrange(20),claim) for claim in claims)
            cases.append((rows,pools,(rng.randrange(5),rng.randrange(5))))
        commands=[];expected=[]
        for rows,pools,insurance in cases:
            final=finalize_scaled(rows,pools,insurance)
            plan=final.plan
            effective=tuple(pools[m]+plan.insurance_spent[m] for m in range(2))
            encoded=';'.join(f'{cash},{claims[0]},{claims[1]},{abs(plan.signed_flows[i][0]):x},{abs(plan.signed_flows[i][1]):x}'
                for i,(cash,claims) in enumerate(rows))
            # Continuation chunk size cannot change an atom's owner or DFS path.
            for budget in (1,7,128):
                commands.append(encoded+f'|{effective[0]},{effective[1]}|{plan.flow_denominator:x}|{budget}')
                expected.append((final.cash,final.signed_movements,final.augmentations))
        result=run([str(Path('target/debug/clearing-atoms-driver').resolve())],input='\n'.join(commands)+'\n',
            text=True,capture_output=True,check=True)
        actual=result.stdout.splitlines();self.assertEqual(len(actual),len(expected))
        for index,(line,want) in enumerate(zip(actual,expected)):
            self.assertFalse(line.startswith('err:'),(index,line))
            cash,flows,augmentations,calls=line.split('|')
            self.assertEqual(tuple(map(int,cash.split(','))),want[0],index)
            self.assertEqual(tuple(tuple(map(int,row.split(','))) for row in flows.split(';')),want[1],index)
            self.assertEqual(int(augmentations),want[2],index)
            self.assertGreaterEqual(int(calls),1)
        print(f'{len(expected)} independent atom/continuation comparisons pass')

if __name__=='__main__':unittest.main()
