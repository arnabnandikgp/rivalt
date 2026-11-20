"""Expected cap and every page prefix, from the independent frozen-book solver."""
import json
import sys
from math import ceil
from check_populated_recovery_bound import FrozenCase, SCALE


def scan_reference(source):
    case = FrozenCase(source)
    original = case.original.benchmark
    groups = case.linked_share_bounds()
    fields = {key: [0, 0] for key in ('ownCashUpper', 'linkedFace', 'incomingDebt', 'budget')}
    prefixes = []
    for index in range(len(case.rows)):
        for market in range(2):
            fields['ownCashUpper'][market] += ceil(original.collections[index][market] * SCALE)
            fields['budget'][market] += case.budgets[index][market]
        for link in original.links:
            if link.account_index == index:
                fields['linkedFace'][link.source_market] += int(link.claim * SCALE)
                remaining = link.debt - case.budgets[index][link.destination_market]
                assert (remaining * SCALE).denominator == 1
                fields['incomingDebt'][link.destination_market] += int(remaining * SCALE)
        if (index + 1) % 8 == 0 or index + 1 == len(case.rows):
            prefixes.append({key: list(map(str, pair)) for key, pair in fields.items()})
    return dict(prefixes=prefixes, caps=[str(cap) for _, cap in groups])


if __name__ == '__main__':
    json.dump(scan_reference(json.load(sys.stdin)), sys.stdout)
