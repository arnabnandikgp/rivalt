"""Independent Fraction expectations for actual frozen RPC rows; no state injection."""
import json
import sys
from fractions import Fraction
from clearing_network_reference import clear_rational_cohort
from test_scalable_settlement import independent_input

source = json.load(sys.stdin)
rows = tuple((int(row['cash']), tuple(map(int, row['claims']))) for row in source['rows'])
pools, insurance = tuple(map(int, source['pools'])), tuple(map(int, source['insurance']))
accounts, common, proposals, _ = independent_input(rows, pools, insurance)
budgets, results = list(insurance), []
for proposal in proposals:
    oracle = clear_rational_cohort(accounts, pools, tuple(budgets), whole_cash_collection=True)
    denominator = common * proposal[0] * 10**9
    incoming, prefixes = [Fraction(0), Fraction(0)], []
    for index in range(len(rows)):
        for market in range(2):
            incoming[market] += oracle.collections[index][market]
            incoming[market] += sum(payment for link, payment in zip(oracle.links, oracle.link_payments)
                                    if link.account_index == index and link.destination_market == market)
        prefix = [value * denominator for value in incoming]
        assert all(value.denominator == 1 for value in prefix)
        prefixes.append([str(int(value)) for value in prefix])
    result = {'proposal': list(map(str, proposal)), 'budgets': list(map(str, budgets)),
              'spent': [str(int(value)) for value in oracle.insurance_spent],
              'fractional': [value.denominator != 1 for value in oracle.insurance_spent],
              'prefixes': prefixes,
              'residuals': [str(int((sum(max(-account.claims[market], 0) for account in accounts) - incoming[market]) * denominator)) for market in range(2)],
              'losses': [str(int(sum(row[market] for row in oracle.creditor_impairments) * denominator)) for market in range(2)]}
    results.append(result)
    for market, spent in enumerate(oracle.insurance_spent):
        if spent.denominator != 1:
            budgets[market] = int(spent)
json.dump({'common': str(common), 'evaluations': results}, sys.stdout)
