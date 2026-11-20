"""Native D117 controls. Charges are inputs; this verifies what happens to cash."""
from fractions import Fraction
from itertools import product
import unittest

from account_contract_reference import Account
from clearing_network_reference import clear_atom_cohort
from test_scalable_settlement import SCALE, command, decode, independent_input, run


def wire(rows):
    return [(cash, tuple(int(Fraction(value)*SCALE) for value in claims)) for cash, claims in rows]


def encoded(original, effective, insurance=(0, 0), fees=(0, 0)):
    before, after = wire(original), wire(effective)
    collections = []
    for cash, claims in original:
        debt = [max(-Fraction(value), 0) for value in claims]
        face = sum(debt)
        collections.append(tuple(min(cash, int(face))*value/face if face else Fraction(0) for value in debt))
    _, common, proposals, orders = independent_input(after, (0, 0), insurance, fees, frozen_collections=collections)
    text = command(after, (0, 0), insurance, fees, proposals, orders)
    return 'reduced'+text[4:]+'|'+';'.join(f'{cash},{btc},{eth}' for cash,(btc,eth) in before), collections, common


class FrozenCashAllocation(unittest.TestCase):
    def test_an_actual_btc_reduction_keeps_the_original_60_and_30(self):
        original = [(90, (-80,-40)), (0,(20,0)), (0,(60,0)), (0,(0,40))]
        effective = [(90, (-60,-40)), (0,(0,0)), (0,(60,0)), (0,(0,40))]
        request, _, _ = encoded(original,effective)
        after = wire(effective)
        _, _, proposals, orders = independent_input(after, (0,0), (0,0))
        ordinary, fixed = map(decode, run([command(after,(0,0),(0,0),(0,0),proposals,orders),request]))
        self.assertEqual(ordinary['cash'],(0,0,54,36))
        self.assertEqual(fixed['cash'],(0,0,60,30))
        self.assertEqual(fixed['movements'],((-60,-30),(0,0),(60,0),(0,30)))
        self.assertEqual(fixed['spent'],(0,0))

    def test_fractional_ownership_insurance_and_terminal_cash(self):
        cases = []
        for a,b,cash,reserve in product((3,Fraction(13,4),7),(2,Fraction(7,2),9),(1,2,3),(0,1)):
            original = [(cash,(-a,-b)), (0,(2,0)), (0,(a-2,0)), (0,(0,b))]
            for reduction in (0,1,2):
                effective = [(cash,(-a+reduction,-b)), (0,(2-reduction,0)), *original[2:]]
                if Fraction(cash*a,a+b)>a-reduction:
                    continue
                insurance=(reserve,1-reserve)
                request, collections, common = encoded(original,effective,insurance,(2,3))
                accounts=tuple(Account(c,tuple(map(Fraction,claims))) for c,claims in effective)
                expected=clear_atom_cohort(accounts,(0,0),insurance,(2,3),frozen_collections=collections)
                cases.append((request,collections,common,expected))
        self.assertGreater(len(cases),100)
        for line,(_,collections,common,expected) in zip(run([c[0] for c in cases]),cases,strict=True):
            native=decode(line)
            self.assertEqual((native['cash'],native['spent'],native['movements'],native['common'],native['retained_fees']),
                (expected.cash,expected.insurance_spent,expected.claim_cash_movements,common,(2,3)))
            explicit=tuple(tuple(Fraction(value,native['denominator']) for value in row[3:5]) for row in native['attribution'])
            self.assertEqual(explicit,tuple(collections))

    def test_changes_to_cash_sign_or_reserved_debt_cannot_settle(self):
        before=[(90,(-80,-40)),(0,(20,0)),(0,(60,0)),(0,(0,40))]
        after=[(90,(-60,-40)),(0,(0,0)),(0,(60,0)),(0,(0,40))]
        valid,_,_=encoded(before,after)
        def altered(index,rows):
            fields=valid.split('|')
            fields[index]=';'.join(f'{cash},{btc},{eth}' for cash,(btc,eth) in wire(rows))
            return '|'.join(fields)
        invalid=[
            altered(1, [(89,after[0][1]), *after[1:]]),
            altered(1, [(90,(-59,-40)),(0,(0,0)),(0,(59,0)),after[3]]),
            altered(1, [(90,(-59,-40)),(0,(-1,0)),*after[2:]]),
            altered(1, [(90,(-Fraction(121,2),-40)),(0,(Fraction(1,2),0)),*after[2:]]),
            altered(9, before[:-1]),
            altered(9, [*before[:2],(0,(61,0)),before[3]]),
        ]
        self.assertEqual(run(invalid), ['err:Cohort']*len(invalid))


if __name__ == '__main__':
    unittest.main()
