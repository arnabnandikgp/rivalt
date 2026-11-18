"""Persisted per-root payment/cash schedule vs independent rational flows."""
from fractions import Fraction
import unittest
from clearing_network_reference import clear_rational_cohort
from test_paged_rates import command, run
from test_scalable_settlement import independent_input
from test_scalable_clearing import samples
from scalable_clearing_candidate import SCALE, MAX_CLAIM


class PagedFlows(unittest.TestCase):
    def test_every_payment_retained_cash_floor_and_fraction(self):
        edges = [(((10**15, (0, 0)),), (0, 0), (0, 0)),
                 (((0, (MAX_CLAIM, -MAX_CLAIM)), (0, (-MAX_CLAIM, MAX_CLAIM))), (0, 0), (13, 17)),
                 (((10**15-70, (-MAX_CLAIM, -MAX_CLAIM)), (0, (MAX_CLAIM, 0)), (0, (0, MAX_CLAIM))), (0, 0), (13, 17))]
        commands, expectations = [], []
        for rows, pools, insurance in [*samples(), *edges]:
            accounts, common, proposals, _ = independent_input(rows, pools, insurance)
            budgets = list(insurance)
            for proposal in proposals:
                oracle = clear_rational_cohort(accounts, pools, tuple(budgets), whole_cash_collection=True)
                if any(value.denominator != 1 for value in oracle.insurance_spent):
                    # A completed fractional evaluation cannot authorize flow planning.
                    commands.append(command(rows, pools, budgets, common, proposal, 1).replace('rates|', 'flows|', 1))
                    expectations.append(None)
                    for market, value in enumerate(oracle.insurance_spent):
                        if value.denominator != 1:
                            budgets[market] = int(value)
                    continue
                expected = []
                for index, account in enumerate(accounts):
                    payments = []
                    for market in range(2):
                        if account.claims[market] >= 0:
                            payments.append(account.claims[market] * oracle.rates[market])
                        else:
                            linked = sum(payment for link, payment in zip(oracle.links, oracle.link_payments)
                                         if link.account_index == index and link.destination_market == market)
                            payments.append(oracle.collections[index][market] + linked)
                    cash = Fraction(account.cash)
                    for claim, payment in zip(account.claims, payments):
                        cash += payment if claim >= 0 else -payment
                    debt = sum(max(-claim, 0) for claim in account.claims)
                    self.assertGreaterEqual(cash, account.cash-min(account.cash, int(debt)))
                    expected.append((*payments, cash))
                for budget in (1, 7, 128):
                    commands.append(command(rows, pools, budgets, common, proposal, budget).replace('rates|', 'flows|', 1))
                    expectations.append((common*proposal[0]*SCALE, expected))
        checked, rejected, maximum = 0, 0, 0
        for index, (line, expected) in enumerate(zip(run(commands), expectations)):
            with self.subTest(case=index):
                if expected is None:
                    self.assertTrue(line.startswith('err:'), line)
                    rejected += 1
                    continue
                self.assertFalse(line.startswith('err:'), (line, commands[index]))
                denominator, rows = expected
                actual_rows = line.split(';')
                self.assertEqual(len(actual_rows), len(rows))
                for actual, amounts in zip(actual_rows, rows):
                    whole, fractional, numerators, remainders, order, steps = actual.split('|')
                    self.assertEqual(tuple(map(int, whole.split(','))), tuple(int(value) for value in amounts))
                    self.assertEqual(tuple(map(int, fractional.split(','))), tuple(int(value.denominator != 1) for value in amounts))
                    self.assertEqual(tuple(Fraction(int(value, 16), denominator) for value in numerators.split(',')), amounts)
                    expected_remainders = tuple(value-int(value) for value in amounts)
                    self.assertEqual(tuple(Fraction(int(value, 16), denominator) for value in remainders.split(',')), expected_remainders)
                    self.assertEqual(tuple(map(int, order.split(','))), tuple(sorted(range(3), key=lambda kind: (-expected_remainders[kind], kind))))
                    maximum = max(maximum, int(steps))
                    checked += 1
        print(f'{checked} persisted per-root flows match independent exact payments, retained cash, floors and fractions; '
              f'{rejected} fractional insurance evaluations cannot authorize flows; maximum {maximum} word steps/root')


if __name__ == '__main__':
    unittest.main()
