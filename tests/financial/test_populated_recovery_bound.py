"""Independent checks for the bounds used on the populated successor freeze."""
from fractions import Fraction
from itertools import product
import json
import os
import subprocess
import unittest

from check_populated_recovery_bound import FrozenCase, SCALE, allocations, bounded_shares, constrained_targets, proportional_targets, tied_shares
from test_scalable_settlement import independent_input
from frozen_plan_selection import FrozenIdentity


def history(entry):
    encoded = (entry*SCALE).to_bytes(5, 'little').rstrip(b'\x00')
    return list(len(encoded).to_bytes(2, 'little') + bytes([0, 0, 1, 0]) + encoded + bytes([1]))


class RecoveryCeilings(unittest.TestCase):
    def test_search_does_not_silently_skip_requested_proposal_checks(self):
        pair = dict(venue_hex='00'*32, epoch='invalid')
        search = dict(venue_hex='00'*32, epoch='1', limit='1', witnesses=[], reflections=[])
        base = dict(rows=[], marks=['1','1'], pools=['0','0'], insurance=['0','0'], fees=['0','0'],
                    charges=[], original=dict(rates=[],orders=[[],[]]), effective=dict(rates=[],orders=[[],[]]))
        requests = [dict(base,search=search,**options) for options in (
            dict(pair_order=pair), dict(measure_recovery_bound=True), dict(check_original_page_budgets=True),
            dict(check_dense_sharing=True))]
        requests.append(dict(base,check_dense_sharing=True))
        binary = os.environ.get('RIVALT_JOINT_AUDIT','target/release/examples/joint_reduction_audit')
        output = subprocess.check_output([binary],input=''.join(json.dumps(r)+'\n' for r in requests),text=True)
        errors = [json.loads(line)['error'] for line in output.splitlines()]
        self.assertEqual(errors, ['Search and individual proposal checks must be requested separately']*4+
                         ['Dense sharing requires a frozen episode for winner order'])

    def test_one_debtor_supplies_spare_lots_to_three_winners(self):
        from types import SimpleNamespace
        from recovery_lot_bound import lot_witness
        case = SimpleNamespace(budgets=[[9,0],[0,0],[0,0],[0,0]], lots=[[3,0],[-1,0],[-1,0],[-1,0]],
                               rates=[[0,0],[10,0],[10,0],[10,0]])
        self.assertEqual(lot_witness(case, [[0,3,3,3],[0,0,0,0]]),
                         [(0,0,1,3),(0,0,2,3),(0,0,3,3)])

    def test_discrete_sharing_against_complete_allocations(self):
        for weights in ([1, 2], [0, 2, 3], [1, 8, 2], [3, 3, 3], [4, 1, 3, 2]):
            options = list(product(*(range(weight+1) for weight in weights)))
            cost = lambda shares: sum(Fraction(value*value, weight) for value,weight in zip(shares,weights) if weight)
            for total in range(sum(weights)+1):
                result = proportional_targets(weights,total)
                self.assertEqual(sum(result),total)
                best = min(cost(option) for option in options if sum(option)==total)
                self.assertEqual(cost(result),best)
                expected = {option for option in options if sum(option)==total and cost(option)==best}
                self.assertEqual({tuple(option) for option in allocations(*tied_shares(weights,total))},expected)

    def test_linked_cap_against_every_integer_allocation(self):
        weights = [2,4,3,1]
        group = {0,2}
        choices = list(product(*(range(w+1) for w in weights)))
        cost = lambda shares: sum(Fraction(x*x,w) for x,w in zip(shares,weights))
        for cap in range(6):
            for total in range(sum(weights)+1):
                possible = [x for x in choices if sum(x)==total and sum(x[i] for i in group)<=cap]
                if possible:
                    chosen = bounded_shares(weights,total,group,cap)
                    best=min(map(cost,possible))
                    self.assertEqual(cost(chosen),best)
                    self.assertEqual(set(map(tuple,constrained_targets(weights,total,group,cap,100))),
                                     {option for option in possible if cost(option)==best})

    def test_admitted_pairings_with_identical_balances_follow_frozen_identity(self):
        table = [(0,(sign*2*SCALE,0)) for sign in (-1,-1,1,1)]
        _, _, rates, orders = independent_input(table,(0,0),(0,0))
        ids = (7, 11, 32, 93)
        rows = [dict(id=str(ids[i]),cash='0',claims=list(map(str,claims)),
                     lots=[str(-1 if i<2 else 1),'0'],history=[history(8),[]])
                for i,(_,claims) in enumerate(table)]
        binary = os.environ.get('RIVALT_JOINT_AUDIT','target/release/examples/joint_reduction_audit')
        results = set()
        for epoch in range(8):
            venue = bytes(32)
            case = FrozenCase(dict(rows=rows,marks=['10','10'],pools=['0','0'],insurance=['0','0'],
                                   fees=['0','0'],venue=list(venue),epoch=str(epoch),
                                   original=dict(rates=list(map(str,rates[0])),additionalRates=[],orders=orders)))
            order = FrozenIdentity(venue,epoch,ids).order()
            first = (next(i for i in order if i<2),next(i for i in order if i>=2))
            for pair in ((0,1),(1,0)):
                plan = [(0,pair[1],3,2),(0,pair[0],2,2)]
                receipt = case.assess(binary,plan,check_pair_order=True)
                self.assertEqual(receipt['lots'],['2','0'])
                expected = any((d,w)==first for _,d,w,_ in plan)
                self.assertEqual(receipt['pairOrderAtFixedTotals'],expected)
                if expected:
                    results.add(pair)
        self.assertEqual(len(results),2)

    def test_recovery_ceiling_requires_an_admitted_plan_reaching_the_net_loss_bound(self):
        # The debtor can pay four of ten atoms. Each winner has two opposite lots.
        # Entry 5 supplies enough unpaid gain for the whole six-atom shortfall.
        # Entry 9 gives only two eligible atoms, with eight from earlier closed claims.
        table = [(4,(-10*SCALE,0)),(0,(10*SCALE,0))]
        _,_,rates,orders = independent_input(table,(0,0),(0,0))
        for winner_entry, expected, saturated in [(5,6,True),(9,2,False)]:
            rows = [dict(id=str(i), cash=str(cash), claims=list(map(str,claims)),
                         lots=[str(qty),'0'], history=[history(entry), []])
                    for i,((cash,claims),qty,entry) in enumerate(zip(table,(-2,2),(5,winner_entry)))]
            case = FrozenCase(dict(rows=rows,marks=['10','10'],pools=['0','0'],insurance=['0','0'],fees=['0','0'],
                                   original=dict(rates=list(map(str,rates[0])), additionalRates=[], orders=orders)))
            self.assertEqual(case.ceilings,[6,0])
            receipt = case.assess(os.environ.get('RIVALT_JOINT_AUDIT','target/release/examples/joint_reduction_audit'),
                                  case.proposal(False))
            self.assertEqual(receipt['recovered'],[str(expected),'0'])
            self.assertEqual(receipt['bothCeilingsReached'],saturated)


if __name__ == '__main__':
    unittest.main()
