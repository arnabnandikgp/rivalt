"""Independent Fraction benchmark versus actual Rust row/rate verification.

The transport supplies proposed rates, never trusted flows. Program authentication,
persisted stages, rounding and signed runtime budgets remain separate P26 gates.
"""
from fractions import Fraction
from math import gcd, lcm
from pathlib import Path
import random
import subprocess
import unittest
from account_contract_reference import Account
from clearing_network_reference import clear_rational_cohort

SCALE=10**9
MAX_CLAIM=10**26+3*10**23


class ClearingRowsImplementation(unittest.TestCase):
    def test_actual_collections_flows_greatest_rates_and_insurance(self):
        commands=[]
        expected=[]

        def case(rows,pools=(0,0),budgets=(0,0)):
            accounts=tuple(Account(cash,tuple(Fraction(claim,SCALE) for claim in claims)) for cash,claims in rows)
            benchmark=clear_rational_cohort(accounts,pools,budgets,whole_cash_collection=True)
            common=1
            for cash,claims in rows:
                debts=tuple(max(-claim,0) for claim in claims)
                if all(debts) and min(cash,sum(debts)//SCALE):common*=sum(debts)
            denominator=lcm(*(rate.denominator for rate in benchmark.rates))
            factor=denominator//gcd(common,denominator)
            self.assertLess(factor,1<<186)
            rate_denominator=common*factor
            rates=tuple(int(rate*rate_denominator) for rate in benchmark.rates)
            cash_denominator=SCALE*rate_denominator
            flows=[]
            for index,(_,claims) in enumerate(rows):
                flow=[]
                for market,claim in enumerate(claims):
                    if claim>=0:
                        value=Fraction(claim,SCALE)*benchmark.rates[market]
                    else:
                        value=-benchmark.collections[index][market]-sum(
                            payment for link,payment in zip(benchmark.links,benchmark.link_payments)
                            if link.account_index==index and link.destination_market==market)
                    self.assertEqual((value*cash_denominator).denominator,1)
                    flow.append(int(value*cash_denominator))
                flows.append(tuple(flow))
            slopes=tuple(sum(int(link.claim*SCALE) for link in benchmark.links
                if link.destination_market==market and link.claim*benchmark.rates[link.source_market]<link.debt)
                for market in range(2))
            prefix=';'.join(f'{cash},{claims[0]},{claims[1]}' for cash,claims in rows)+f'|{pools[0]},{pools[1]}|{budgets[0]},{budgets[1]}|'
            commands.append(prefix+f'{rates[0]:x},{rates[1]:x},{factor:x}')
            expected.append((common,cash_denominator,tuple(int(spent) for spent in benchmark.insurance_spent),
                sum((spent.denominator!=1)<<index for index,spent in enumerate(benchmark.insurance_spent)),slopes,flows))
            commands.append(prefix+f'{rates[0]+1:x},{rates[1]:x},{factor:x}')
            expected.append(None)
            return benchmark

        goldens=[
            ((100,(-100,0)),(0,(100,0)),(0,(0,-100)),(0,(0,100))),
            ((100,(-80,-80)),(0,(80,0)),(0,(0,80))),
            ((0,(100,-100)),(40,(-100,0)),(0,(0,100))),
            ((0,(100,-100)),(0,(-100,100))),
            ((0,(20,-5)),(0,(-20,5))),
            ((0,(2,-1)),(0,(1,0)),(0,(-3,0)),(0,(0,1))),
        ]
        for rows in goldens:
            for budgets in [(0,0),(10,20)]:
                case(tuple((cash,tuple(claim*SCALE for claim in claims)) for cash,claims in rows),budgets=budgets)
        # Both prescribed insurance clipping passes remain exact before rounding.
        clip_rows=((2,(0,0)),(2,(2*SCALE//5,SCALE//5)),(1,(-3*SCALE//5,3*SCALE//5)),(2,(SCALE//5,-4*SCALE//5)))
        budgets=(1,1)
        for _ in range(3):
            benchmark=case(clip_rows,budgets=budgets)
            budgets=tuple(int(spent) if spent.denominator!=1 else budget for spent,budget in zip(benchmark.insurance_spent,budgets))
        rng=random.Random(260002)
        for index in range(150):
            count=rng.randrange(2,13)
            quantum=SCALE if index%2 else SCALE//10
            pools=(rng.randrange(4),rng.randrange(4))
            claims=[tuple(rng.randrange(-30,31)*quantum for _ in range(2)) for _ in range(count-1)]
            claims.append(tuple(pools[market]*SCALE-sum(row[market] for row in claims) for market in range(2)))
            rows=tuple((rng.randrange(20),claim) for claim in claims)
            case(rows,pools,(rng.randrange(10),rng.randrange(10)))
        rows=[(1,(-MAX_CLAIM//128-index*2-1,-MAX_CLAIM//128-index*4-3)) for index in range(63)]
        rows.append((0,tuple(-sum(row[1][market] for row in rows) for market in range(2))))
        case(tuple(rows),budgets=(13,17))
        # Exact fixed equations alone would incorrectly accept these lower cycles.
        cycle=f'0,{100*SCALE},{-100*SCALE};0,{-100*SCALE},{100*SCALE}|0,0|0,0|'
        commands.extend([cycle+'0,0,1',cycle+'1,1,2',cycle+'1,0,1',cycle+'1,1,0',cycle+f'1,1,{1<<186:x}'])
        expected.extend([None]*5)
        driver=Path('target/debug/clearing-row-driver')
        result=subprocess.run([str(driver.resolve())],input='\n'.join(commands)+'\n',text=True,capture_output=True,check=True)
        actual=result.stdout.splitlines()
        self.assertEqual(len(actual),len(expected))
        for index,(line,want) in enumerate(zip(actual,expected)):
            if want is None:
                self.assertTrue(line.startswith('err:'),(index,line));continue
            self.assertFalse(line.startswith('err:'),(index,line,commands[index]))
            parts=line.split('|')
            got=(int(parts[0],16),int(parts[1],16),tuple(map(int,parts[2].split(','))),int(parts[3]),
                 tuple(map(int,parts[4].split(','))),[tuple(int(value,16) for value in row.split(',')) for row in parts[5].split(';')])
            self.assertEqual(got,want,f'case {index}')
        print(f'{len(commands)} actual Rust collection/flow/rate cases matched independent Fraction expectations')


if __name__=='__main__':unittest.main()
