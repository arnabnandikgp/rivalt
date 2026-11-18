"""Independent exhaustive owner/charge selection and frozen payout controls."""
from fractions import Fraction
from functools import lru_cache
from itertools import combinations, combinations_with_replacement, product
from math import prod
from pathlib import Path
import json
import os
import subprocess
import sys
import unittest

from default_plan_certificate import AssignmentProof, ThreeLotBook, verify
from frozen_plan_selection import FrozenIdentity
from test_scalable_settlement import decode, frozen_book_command, run

DRIVER = Path(os.environ.get("RIVALT_PROOF_DRIVER", "target/debug/examples/measure")).resolve()


def exhaustive(venue, episode, budget, gains):
    """Enumerate both debtor labels and integer charges. Use rational score and full pair order."""
    members = FrozenIdentity(venue, episode, tuple(range(9))).order()
    winners = [member - 2 for member in members if 2 <= member < 8]
    debtors = [member for member in members if member < 2]

    @lru_cache(None)
    def triples(group):
        candidates = []
        for charges in product(*(range(gains[i]+1) for i in group)):
            total = sum(charges)
            if total <= budget:
                cost = sum(Fraction(q*q, gains[i]) for i, q in zip(group, charges))
                candidates.append(((total, -cost), charges))
        score = max(rank for rank, _ in candidates)
        return [charges for rank, charges in candidates if rank == score]

    best, result = None, None
    for first in combinations(range(6), 3):
        second = tuple(i for i in range(6) if i not in first)
        mask = sum(1 << i for i in second)
        for left, right in product(triples(first), triples(second)):
            quantities = dict(zip(first+second, left+right))
            cost = sum(Fraction(q*q, gains[i]) for i, q in quantities.items())
            score = (sum(quantities.values()), -cost, -sum(q > 0 for q in quantities.values()),
                     tuple(quantities[i] for i in winners),
                     tuple(quantities[i] if debtor == ((mask >> i) & 1) else 0
                           for i in winners for debtor in debtors))
            if best is None or score > best:
                best = score
                result = dict(recovered=score[0], mask=mask, charges=[quantities[i] for i in range(6)],
                              cost=str(int(cost * prod(gains))))
    return result


def payout(budget, gains, cash, selected):
    case = ThreeLotBook(budget, tuple(gains), cash)
    assignment = tuple(((selected['mask'] >> i) & 1, q) for i, q in enumerate(selected['charges']))
    terminal_book = verify(case, AssignmentProof(assignment)).book
    original, _ = case.frozen()
    outcomes = [decode(line) for line in run([frozen_book_command(book) for book in (original, terminal_book)])]
    assert all(sum(outcome['cash']) == 2*cash and outcome['spent'] == (0, 0) for outcome in outcomes)
    return [outcome['cash'][-1] for outcome in outcomes]


class MeteredProof(unittest.TestCase):
    def test_native_matches_independent_full_selection(self):
        books = []
        for budget in range(6, 22):
            for gains in combinations_with_replacement(range(budget//4+1, (budget+1)//2), 6):
                if sum(gains) == 2 * budget:
                    # Vary the stable placement of unequal claims.
                    books.append((len(books) % 7, budget, gains[2:] + gains[:2]))
        books += [(episode, 17, (5, 5, 5, 5, 6, 8)) for episode in range(8)]
        lines = [' '.join(map(str, (episode, budget, *gains))) for episode, budget, gains in books]
        rows = subprocess.run([str(DRIVER)], input='\n'.join(lines)+'\n', capture_output=True,
                              text=True, check=True).stdout.splitlines()
        for (episode, budget, gains), row in zip(books, rows, strict=True):
            recovered, mask, charges, cost, _ = row.split()
            self.assertEqual(dict(recovered=int(recovered), mask=int(mask), cost=cost,
                                  charges=list(map(int, charges.split(',')))),
                             exhaustive(bytes([7])*32, episode, budget, gains))
        print(f"{len(books)} complete native plan comparisons")

    def test_numeric_endpoint(self):
        gains = [21845] * 6
        recovered, mask, charges, cost, _ = subprocess.check_output(
            [str(DRIVER)], input='0 65535 '+' '.join(map(str, gains))+'\n', text=True).split()
        self.assertEqual((int(recovered), list(map(int, charges.split(','))), int(cost)),
                         (131070, gains, 131070*prod(gains)))
        self.assertEqual(int(mask).bit_count(), 3)

    def test_flat_creditor(self):
        gains = (5, 5, 5, 5, 6, 8)
        chosen = exhaustive(bytes([7])*32, 1, 17, gains)
        self.assertEqual((chosen['recovered'], payout(17, gains, 10, chosen)), (33, [7, 19]))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'rpc-expected':
        _, _, venue_hex, episode, budget, cash, *gain_args = sys.argv
        gains = tuple(map(int, gain_args))
        chosen = exhaustive(bytes.fromhex(venue_hex), int(episode), int(budget), gains)
        chosen['flat'] = payout(int(budget), gains, int(cash), chosen)
        print(json.dumps(chosen))
    else:
        unittest.main()
