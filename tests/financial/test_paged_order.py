"""Paged exact market order vs independently derived rational remainders."""
import unittest
from fractions import Fraction
from random import Random
from test_paged_rates import command, run
from test_scalable_settlement import independent_input
from test_scalable_clearing import samples
from clearing_network_reference import clear_rational_cohort


class PagedOrder(unittest.TestCase):
    def test_complete_orders_remainders_ties_and_permutation_transport(self):
        commands, expected = [], []
        rng = Random(540_004)
        for rows, pools, insurance in samples():
            accounts, common, proposals, orders = independent_input(rows, pools, insurance)
            budgets = list(insurance)
            for proposal in proposals:
                oracle = clear_rational_cohort(accounts, pools, tuple(budgets), whole_cash_collection=True)
                if any(value.denominator != 1 for value in oracle.insurance_spent):
                    for market, value in enumerate(oracle.insurance_spent):
                        if value.denominator != 1:
                            budgets[market] = int(value)
                    continue
                base = command(rows, pools, budgets, common, proposal, 1).replace('rates|', 'orders|', 1)
                mutations = [orders, [list(reversed(order)) for order in orders], [list(range(len(rows))) for _ in range(2)]]
                shuffled = [list(order) for order in orders]
                for order in shuffled:
                    rng.shuffle(order)
                mutations.append(shuffled)
                duplicate = [list(order) for order in orders]
                duplicate[0][-1] = duplicate[0][0]
                mutations.append(duplicate)
                missing = [list(order) for order in orders]
                missing[1].pop()
                mutations.append(missing)
                for sequences in mutations:
                    valid = all(sorted(order) == list(range(len(rows))) for order in sequences)
                    for market, order in enumerate(sequences):
                        positives = [index for index in order if accounts[index].claims[market] > 0]
                        keys = [(-(accounts[index].claims[market]*oracle.rates[market] % 1), index) for index in positives]
                        valid &= keys == sorted(keys)
                    commands.append(base + '|' + ':'.join(','.join(map(str, order)) for order in sequences))
                    expected.append(valid)
                for budget in (7, 128):
                    commands.append(command(rows, pools, budgets, common, proposal, budget).replace('rates|', 'orders|', 1)
                                    + '|' + ':'.join(','.join(map(str, order)) for order in orders))
                    expected.append(True)
        accepted, rejected, maximum = 0, 0, 0
        for index, (line, valid) in enumerate(zip(run(commands), expected)):
            with self.subTest(case=index):
                if valid:
                    self.assertTrue(line.startswith('orders|'), (line, commands[index]))
                    accepted += 1
                    maximum = max(maximum, int(line.split('|')[1]))
                else:
                    self.assertTrue(line.startswith('err:'), line)
                    rejected += 1
        print(f'{accepted} exact paged market orders accepted; {rejected} reversed/tied/duplicate/incomplete orders rejected; '
              f'maximum {maximum} word steps/cohort; permutation storage remains native transport')


if __name__ == '__main__':
    unittest.main()
