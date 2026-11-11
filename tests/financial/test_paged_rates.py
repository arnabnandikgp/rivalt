"""Bounded persisted Rust rate work vs independent branch/Fraction equations."""
from fractions import Fraction
from pathlib import Path
import subprocess
import unittest
from account_contract_reference import Account
from clearing_network_reference import clear_rational_cohort
from test_scalable_settlement import independent_input
from test_scalable_clearing import samples
from scalable_clearing_candidate import SCALE,MAX_CLAIM
DRIVER=Path('target/debug/scalable-rate-driver').resolve()

def command(rows,pools,budgets,common,proposal,budget):
    return '|'.join(('rates',';'.join(f'{cash},{claims[0]},{claims[1]}' for cash,claims in rows),
        ','.join(map(str,pools)),','.join(map(str,budgets)),f'{common:x}',','.join(f'{value:x}' for value in proposal),str(budget)))
def run(commands):
    lines=subprocess.run([DRIVER],input='\n'.join(commands)+'\n',text=True,capture_output=True,check=True).stdout.splitlines()
    assert len(lines)==len(commands),(len(lines),len(commands))
    return lines

class PagedRates(unittest.TestCase):
    def test_complete_equations_insurance_and_every_row_prefix(self):
        edges=[(((10**15-40,(0,0)),),(0,0),(0,0)),(((0,(0,0)),),(0,0),(40,80)),
            (((0,(MAX_CLAIM,-MAX_CLAIM)),(0,(-MAX_CLAIM,MAX_CLAIM))),(0,0),(13,17)),
            (((10**15-70,(-MAX_CLAIM,-MAX_CLAIM)),(0,(MAX_CLAIM,0)),(0,(0,MAX_CLAIM))),(0,0),(13,17))]
        commands,expected=[],[]
        for rows,pools,insurance in [*samples(),*edges]:
            accounts,common,proposals,_=independent_input(rows,pools,insurance)
            budgets=list(insurance)
            for proposal in proposals:
                oracle=clear_rational_cohort(accounts,pools,tuple(budgets),whole_cash_collection=True)
                denominator=common*proposal[0]*SCALE
                expected_prefix=[];incoming=[Fraction(0),Fraction(0)]
                for index in range(len(rows)):
                    for market in range(2):
                        incoming[market]+=oracle.collections[index][market]
                        incoming[market]+=sum(payment for link,payment in zip(oracle.links,oracle.link_payments)
                            if link.account_index==index and link.destination_market==market)
                    expected_prefix.append(tuple(value*denominator for value in incoming))
                residual=tuple(sum(max(-account.claims[market],0) for account in accounts)-incoming[market] for market in range(2))
                losses=tuple(sum(row[market] for row in oracle.creditor_impairments) for market in range(2))
                for budget in (1,7,128):
                    commands.append(command(rows,pools,budgets,common,proposal,budget))
                    expected.append((oracle,denominator,expected_prefix,residual,losses))
                for market,spent in enumerate(oracle.insurance_spent):
                    if spent.denominator!=1:budgets[market]=int(spent)
        for index,(line,(oracle,denominator,prefix,residual,losses)) in enumerate(zip(run(commands),expected)):
            with self.subTest(case=index):
                self.assertFalse(line.startswith('err:'),(index,line,commands[index]))
                fields=line.split('|');self.assertEqual(len(fields),6)
                self.assertEqual(tuple(map(int,fields[0].split(','))),tuple(int(value) for value in oracle.insurance_spent))
                self.assertEqual(tuple(map(int,fields[1].split(','))),tuple(int(value.denominator!=1) for value in oracle.insurance_spent))
                self.assertEqual(tuple(Fraction(int(value,16),denominator) for value in fields[2].split(',')),residual)
                self.assertEqual(tuple(Fraction(int(value,16),denominator) for value in fields[3].split(',')),losses)
                actual_prefix=[tuple(int(value,16) for value in row.split(',')) for row in fields[4].split(';')]
                self.assertEqual(actual_prefix,prefix)
        print(f'{len(commands)} complete persisted rate evaluations match independent equations, greatestness, every row prefix and exact insurance floors')
    def test_hostile_rates_and_non_greatest_cycles_reject(self):
        commands=[]
        for rows,pools,insurance in list(samples())[:12]:
            _,common,proposals,_=independent_input(rows,pools,insurance)
            factor,first,second=proposals[0]
            for proposed in [(0,first,second),(factor,first+1,second),(factor,first,second+1),(1<<303,first,second)]:
                commands.append(command(rows,pools,insurance,common,proposed,1))
            commands.append(command(rows,(pools[0]+1,pools[1]),insurance,common,proposals[0],7))
            commands.append(command(rows,pools,insurance,common,proposals[0],0))
        cycle=((0,(SCALE,-SCALE)),(0,(-SCALE,SCALE)))
        for proposal in [(1,0,0),(2,1,1)]:commands.append(command(cycle,(0,0),(0,0),1,proposal,1))
        for line in run(commands):self.assertTrue(line.startswith('err:'),line)
        print(f'{len(commands)} hostile/domain/non-greatest rate requests rejected')
if __name__=='__main__':unittest.main()
