"""Check the resumable rate and cash work against the original debt allocation."""
from fractions import Fraction
from itertools import product
import unittest

from clearing_network_reference import clear_rational_cohort
from test_frozen_cash_allocation import encoded, wire
from test_paged_rates import command, run
from test_scalable_settlement import independent_input, SCALE


def paged_flows(original, effective, insurance, budget):
    reduced, collections, common = encoded(original, effective, insurance)
    accounts, _, proposals, _ = independent_input(wire(effective), (0, 0), insurance,
                                                   frozen_collections=collections)
    budgets = list(insurance)
    for proposal in proposals:
        result = clear_rational_cohort(accounts, (0, 0), tuple(budgets), whole_cash_collection=True,
                                       frozen_collections=collections)
        if all(amount.denominator == 1 for amount in result.insurance_spent):
            break
        budgets = [int(spent) if spent.denominator != 1 else available
                   for available, spent in zip(budgets, result.insurance_spent, strict=True)]
    request = command(wire(effective), (0, 0), budgets, common, proposal, budget)
    request = request.replace('rates|', 'reduced-flows|', 1) + '|' + reduced.split('|')[-1]
    expected = []
    for index, account in enumerate(accounts):
        flows = []
        for market, claim in enumerate(account.claims):
            if claim >= 0:
                flows.append(claim * result.rates[market])
            else:
                incoming = sum(paid for edge, paid in zip(result.links, result.link_payments, strict=True)
                               if edge.account_index == index and edge.destination_market == market)
                flows.append(collections[index][market] + incoming)
        expected.append((*flows, result.cash_entitlements[index]))
    return request, expected, common * proposal[0] * SCALE


class PagedFrozenCollections(unittest.TestCase):
    def test_exact_flows_after_restart(self):
        cases = []
        for btc, eth, cash, reduction, step in product(
                (80, Fraction(17, 4)), (40, Fraction(15, 2)), (1, 3), (1, 2), (1, 7)):
            original = [(cash, (-btc, -eth)), (0, (2, 0)), (0, (btc-2, 0)), (0, (0, eth))]
            effective = [(cash, (-btc+reduction, -eth)), (0, (2-reduction, 0)), *original[2:]]
            cases.append(paged_flows(original, effective, (1, 2), step))
        original = [(19_992, (-10_002, -10_002)), (1_000_000, (10_002, 0)), (1_000_000, (0, 10_002))]
        effective = [(19_992, (-9_999, -9_997)), (1_000_000, (9_999, 0)), (1_000_000, (0, 9_997))]
        case = paged_flows(original, effective, (3, 1), 1)
        self.assertEqual(case[1], [(9996, 9996, 0), (9999, 0, 1009999), (0, 9997, 1009997)])
        cases.append(case)
        for result, (request, expected, denominator) in zip(run([case[0] for case in cases]), cases, strict=True):
            with self.subTest(request=request):
                self.assertFalse(result.startswith('err:'), result)
                actual = [tuple(Fraction(int(value, 16), denominator) for value in row.split('|')[2].split(','))
                          for row in result.split(';')]
                self.assertEqual(actual, expected)

    def test_bad_original_or_common_factor_cannot_advance(self):
        original = [(90, (-80, -40)), (0, (20, 0)), (0, (60, 0)), (0, (0, 40))]
        effective = [(90, (-60, -40)), (0, (0, 0)), *original[2:]]
        request, expected, _ = paged_flows(original, effective, (0, 0), 1)
        self.assertEqual(expected[0], (60, 30, 0))
        fields = request.split('|')
        rejected = []
        for replacement in ([(89, (-80, -40)), *original[1:]], [(90, (-53, -40)), *original[1:]],
                            [(90, (-81, -40)), *original[1:]], original[1:]):
            fields[-1] = ';'.join(f'{cash},{btc},{eth}' for cash, (btc, eth) in wire(replacement))
            rejected.append('|'.join(fields))
        self.assertTrue(all(line.startswith('err:') for line in run(rejected)))


if __name__ == '__main__':
    unittest.main()
