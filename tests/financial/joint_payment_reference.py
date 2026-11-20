"""Independent whole-book payments after both sets of frozen lot reductions."""
import json
import sys
from math import ceil

from check_populated_recovery_bound import FrozenCase, constrained_targets
from clearing_network_reference import clear_atom_cohort
from recovery_lot_bound import earliest_winners
from test_scalable_settlement import SCALE, independent_input


def joint_payments(source):
    case = FrozenCase(source)
    caps = case.linked_share_bounds()
    choices = [constrained_targets(case.eligible_weights(m), case.ceilings[m], *caps[m], 65536)
               for m in range(2)]
    targets = earliest_winners(case, choices)
    deltas = [[budget[m] - targets[m][i] for m in range(2)] for i, budget in enumerate(case.budgets)]
    changed = [(cash, [claim + delta*SCALE for claim, delta in zip(faces, row)])
               for (cash, faces), row in zip(case.table, deltas)]
    fixed = case.original.benchmark.collections
    accounts, common, proposals, orders = independent_input(changed, *case.inputs, frozen_collections=fixed)
    result = clear_atom_cohort(accounts, *case.inputs, frozen_collections=fixed)
    benchmark, flows, protected = result.benchmark, [], [0, 0]
    for i, account in enumerate(accounts):
        payments = []
        for m, claim in enumerate(account.claims):
            if case.accounts[i].claims[m] > 0:
                assert int(claim * benchmark.rates[m]) + targets[m][i] >= ceil(
                    case.accounts[i].claims[m] * case.original.benchmark.rates[m])
                protected[m] += 1
            if claim > 0:
                amount = claim * benchmark.rates[m]
            else:
                amount = benchmark.collections[i][m] + sum(
                    value for link, value in zip(benchmark.links, benchmark.link_payments)
                    if link.account_index == i and link.destination_market == m)
            payments.append(amount)
        flows.append((*payments, benchmark.cash_entitlements[i]))
    assert all(sum(row[m] for row in deltas) == 0 for m in range(2))
    return dict(common=str(common), proposals=[list(map(str, row)) for row in proposals],
                spent=list(map(str, result.insurance_spent)), protected=protected,
                deltas=[list(map(str, row)) for row in deltas],
                plan=dict(orders=[list(map(str, row)) for row in orders], cash=list(map(str, result.cash)),
                          movements=[list(map(str, row)) for row in result.claim_cash_movements],
                          floors=[[str(int(x)) for x in row] for row in flows],
                          fractions=[[x.denominator != 1 for x in row] for row in flows],
                          localOrders=[sorted(range(3), key=lambda k: (-(row[k] % 1), k)) for row in flows]))


if __name__ == '__main__':
    json.dump(joint_payments(json.load(sys.stdin)), sys.stdout)
