"""Independent full-corner/large-integer oracle against the actual Rust kernel.

No production arithmetic or the P51B candidate model is imported. The transport's
row list assumes authentication; this is not on-chain lifecycle/authority evidence.
"""
from itertools import product
from pathlib import Path
from random import Random
import subprocess
import unittest

DRIVER = Path('target/debug/backing-driver').resolve()
SCALE = 10**9
MAX_FIXED = 10**26 + 10**8 * 10**15
REGION = ((9, 11, -3*SCALE, 3*SCALE), (19, 21, -3*SCALE, 3*SCALE))


def run(commands):
    result = subprocess.run([str(DRIVER)], input='\n'.join(commands)+'\n',
                            text=True, capture_output=True, check=True).stdout.splitlines()
    if len(result) != len(commands):
        raise AssertionError((len(result), len(commands)))
    return result


def csv(values):
    return ','.join(map(str, values))


def bounds(region):
    return csv(value for market in region for value in market)


def row(cash=500, quantities=(1, -1), fixed=(-10*SCALE, 20*SCALE), checkpoints=(0, 0), reserve=0, mode=2):
    return (cash, quantities[0], fixed[0]-quantities[0]*checkpoints[0], checkpoints[0],
            quantities[1], fixed[1]-quantities[1]*checkpoints[1], checkpoints[1], reserve, mode)


def expectation(root, region, selected):
    cash, first_q, first_v, first_f, second_q, second_v, second_f, _, _ = root
    quantities = (first_q, second_q)
    stored = (first_v, second_v)
    checkpoints = (first_f, second_f)
    corners = []
    # Enumerate 16 complete corners with the direct unpaid-claim formula, rather
    # than the kernel's sign-selected minimum and checkpoint-adjusted formula.
    for prices in product(*(market[:2] for market in region)):
        for funding in product(*(market[2:] for market in region)):
            corners.append(tuple(stored[index] - quantities[index]*(funding[index]-checkpoints[index])
                                 + quantities[index]*prices[index]*SCALE for index in range(2)))
    owes = any(claims[selected] < 0 for claims in corners)
    worst_debt = max(sum(-claim for claim in claims if claim < 0) for claims in corners)
    mask = sum(1 << index for index in range(2) if quantities[index] and (index == selected or owes))
    return quantities[selected], stored[selected]+quantities[selected]*checkpoints[selected], int(owes and cash*SCALE < worst_debt), mask


def encoded_summary(count, bad, quantity, positive, negative, required):
    # Literal checkpoint layout, independently encoded with Python big integers.
    return (b'RVBACK01' + count.to_bytes(8, 'little') + bad.to_bytes(8, 'little')
            + quantity.to_bytes(16, 'little', signed=True) + positive.to_bytes(24, 'little')
            + negative.to_bytes(24, 'little') + required[0].to_bytes(8, 'little')
            + required[1].to_bytes(8, 'little')).hex()


class MaintainedBacking(unittest.TestCase):
    def test_contributions_match_complete_corner_enumeration(self):
        rng = Random(550501)
        examples = [row(100, (0, 0), (-60*SCALE, -60*SCALE)),
                    row(0, (0, 0), (10**26, -1)), row(0, (0, 0), (0, -SCALE)),
                    row(1, (0, 0), (-SCALE, 0)), row(1, (0, 0), (-SCALE-1, 0)),
                    row(8, reserve=8), row(7, reserve=0),
                    row(100, (1, -1), (-10*SCALE, 20*SCALE), (3*SCALE, -3*SCALE)),
                    row(1, (0, 0), (0, 0), mode=0), row(1, (0, 0), (0, 0), mode=1)]
        examples += [row(rng.randrange(500), tuple(rng.randrange(-10, 11) for _ in range(2)),
                         tuple(rng.randrange(-200*SCALE, 201*SCALE) for _ in range(2)),
                         tuple(rng.randrange(-3*SCALE, 3*SCALE+1) for _ in range(2)),
                         reserve=rng.randrange(500)) for _ in range(600)]
        cases = [(selected, root, REGION) for root in examples for selected in range(2)]
        extreme_region = ((1, 10**6, -10**15, 10**15),)*2
        for quantity, virtual, checkpoint in product((-10**8, 0, 10**8), (-10**26, 0, 10**26), (-10**15, 0, 10**15)):
            for selected in range(2):
                cases.append((selected, (10**15, quantity, virtual, checkpoint, -quantity, -virtual, -checkpoint, 10**15, 2), extreme_region))
        results = run([f'contribution|{selected}|{bounds(region)}|{csv(root)}' for selected, root, region in cases])
        for result, (selected, root, region) in zip(results, cases):
            self.assertEqual(tuple(map(int, result.split(','))), expectation(root, region, selected))
        print(f'{len(cases)} actual Rust contributions match independent 16-corner arithmetic')

    def test_numeric_modes_and_region_boundaries_reject(self):
        invalid = [row(10**15+1), row(quantities=(10**8+1, 0)), row(fixed=(10**26+1, 0)),
                   row(checkpoints=(10**15+1, 0)), row(reserve=10**15+1), row(mode=0), row(mode=1)]
        commands = [f'contribution|0|{bounds(REGION)}|{csv(value)}' for value in invalid]
        for bad_region in [((0, 1, 0, 0), REGION[1]), ((12, 11, 0, 0), REGION[1]),
                           ((1, 10**6+1, 0, 0), REGION[1]), ((9, 11, 1, 0), REGION[1]),
                           ((9, 11, -10**15-1, 0), REGION[1])]:
            commands.append(f'contribution|0|{bounds(bad_region)}|{csv(row())}')
        commands.append(f'contribution|2|{bounds(REGION)}|{csv(row())}')
        for result in run(commands): self.assertTrue(result.startswith('err:'), result)
        cases = [('3','9,11,19,21',f'{-3*SCALE},{3*SCALE},{-3*SCALE},{3*SCALE}', '1'),
                 ('3','8,11,19,21','0,0,0,0', '0'),
                 ('3','9,12,19,21','0,0,0,0', '0'),
                 ('3','9,11,19,21',f'0,{3*SCALE+1},0,0', '0'),
                 ('3','9,11,19,21',f'0,0,{-3*SCALE-1},0', '0'),
                 ('1','9,11,0,0','0,0,0,0', '1'),  # Irrelevant market need not have a live source.
                 ('0','0,0,0,0','0,0,0,0', '1'),
                 ('4','9,11,19,21','0,0,0,0', 'err:'),
                 ('3','11,9,19,21','0,0,0,0', 'err:')]
        for actual, (_, _, _, expected) in zip(run([f'contains|{mask}|{bounds(REGION)}|{prices}|{funding}'
                                                  for mask, prices, funding, _ in cases]), cases):
            self.assertTrue(actual.startswith(expected), (actual, expected))
        print(f'{len(commands)} invalid contributions/regions rejected; {len(cases)} held-region boundary cases matched')

    def test_mutations_restarts_bad_repairs_and_funding_checkpoint_equivalence(self):
        cases = []
        for population in (64, 128, 1024, 10000):
            roots = [row(500, (1, -1) if index % 2 == 0 else (-1, 1),
                         (-10*SCALE, 20*SCALE) if index % 2 == 0 else (10*SCALE, -20*SCALE)) for index in range(population)]
            for selected in range(2):
                operations = []
                expected = []
                contributions = {}
                live = list(roots)
                count = bad = quantity = positive = negative = 0
                required = [0, 0]
                def update(index):
                    nonlocal count, bad, quantity, positive, negative
                    after = expectation(live[index], REGION, selected)
                    before = contributions.get(index, (0, 0, 0, 0))
                    if index not in contributions: count += 1
                    quantity += after[0] - before[0]
                    positive += max(after[1], 0)-max(before[1], 0)
                    negative += max(-after[1], 0)-max(-before[1], 0)
                    bad += after[2]-before[2]
                    for market in range(2): required[market] += bool(after[3] & (1<<market))-bool(before[3] & (1<<market))
                    contributions[index] = after
                def record():
                    expected.append(encoded_summary(count, bad, quantity, positive, negative, required)
                                    + ',' + str(int(count == population and bad == 0 and quantity == 0 and positive == negative)))
                for index in range(population):
                    operations.append(f'scan:{index}'); update(index); record()
                    # An already scanned root becomes unsafe, then is repaired.
                    previous = index // 2
                    for cash in (0, 500):
                        live[previous] = (cash, *live[previous][1:])
                        operations.append(f'mutate:{previous}:{csv(live[previous])}')
                        update(previous); record()
                    if index+1 < population:
                        # Advance BOTH consumed funding checkpoints for an unscanned
                        # root; z stays exact, including fractional units.
                        next_index = index+1
                        old = live[next_index]
                        funding = (SCALE+1, -SCALE-1)
                        new = (old[0], old[1], old[2]-old[1]*(funding[0]-old[3]), funding[0],
                               old[4], old[5]-old[4]*(funding[1]-old[6]), funding[1], old[7], old[8])
                        self.assertEqual(expectation(old, REGION, selected), expectation(new, REGION, selected))
                        live[next_index] = new
                        operations.append(f'mutate:{next_index}:{csv(new)}'); record()
                cases.append((population, selected, f'sequence|{selected}|{bounds(REGION)}|'
                              + ';'.join(map(csv, roots))+'|'+';'.join(operations)+'|0', expected))
        comparisons = 0
        for actual, (population, selected, _, expected) in zip(run([case[2] for case in cases]), cases):
            self.assertEqual(actual.split(';'), expected, (population, selected))
            self.assertTrue(expected[-1].endswith(',1'))
            comparisons += len(expected)
        print(f'{len(cases)} native cohort/market cases up to 10000 roots; {comparisons} exact prefix/restoration comparisons')

    def test_large_totals_carry_removal_and_checked_checkpoint_failures(self):
        # Direct arithmetic checkpoint diagnostic, NOT evidence of a u64-size
        # authenticated or funded cohort. The total exceeds u128 deliberately.
        population = 2**64-1
        amount = (population//2)*MAX_FIXED
        checkpoint = encoded_summary(population, 0, 0, amount, amount, (0, 0))
        self.assertEqual(run([f'decode|{checkpoint}|{population}|0'])[0], checkpoint+'|1')
        before = (0, MAX_FIXED, 0, 0)
        after = (0, -MAX_FIXED, 1, 3)
        updated = encoded_summary(population, 1, 0, amount-MAX_FIXED, amount+MAX_FIXED, (1, 1))
        self.assertEqual(run([f'replace|{checkpoint}|{csv(before)}|{csv(after)}'])[0], updated)
        self.assertEqual(run([f'replace|{updated}|{csv(after)}|{csv(before)}'])[0], checkpoint)
        neutral = encoded_summary(1, 0, 0, 0, 0, (0, 0))
        invalid = [encoded_summary(0, 1, 0, 0, 0, (0, 0)),
                   encoded_summary(1, 0, 10**8+1, 0, 0, (0, 0)),
                   encoded_summary(1, 0, 0, MAX_FIXED+1, 0, (0, 0)),
                   encoded_summary(1, 0, 0, MAX_FIXED, 1, (0, 0)),
                   encoded_summary(1, 0, 0, 0, 0, (2, 0)), checkpoint[:-2], '00'+checkpoint[2:],
                   encoded_summary(population, 0, 0, 2**151, 0, (0, 0))]
        for result in run([f'decode|{value}|1|0' for value in invalid]): self.assertTrue(result.startswith('err:'))
        self.assertTrue(run([f'replace|{neutral}|0,1,0,0|0,0,0,0'])[0].startswith('err:'))
        # Fractional ownership is never rounded to make a pool identity match.
        fractional = encoded_summary(2, 0, 0, 7*SCALE+1, 1, (0, 0))
        self.assertEqual(run([f'decode|{fractional}|2|7'])[0], fractional+'|1')
        self.assertTrue(run([f'decode|{fractional}|2|6'])[0].endswith('|0'))
        self.assertTrue(run([f'decode|{fractional}|3|7'])[0].endswith('|0'))
        self.assertTrue(run([f'decode|{fractional}|0|7'])[0].startswith('err:'))
        print('151-bit aggregate carry/borrow, fractional identity and nine malformed/underflow cases checked')

    def test_loss_payment_netting_inventory_and_post_fee_bad_transitions(self):
        # Literal accounting transitions, not claims that these inputs passed
        # program authority, source, health or liquidation-progress admission.
        debt = row(120, (0, 0), (-60*SCALE, -60*SCALE))
        mixed = row(0, (0, 0), (80*SCALE, -20*SCALE))
        third = row(20, (0, 0), (-20*SCALE, 80*SCALE))
        original = [debt, mixed, third]
        collect = row(90, (0, 0), (-30*SCALE, -60*SCALE))
        pay = row(20, (0, 0), (60*SCALE, -20*SCALE))
        collected_sibling = row(0, (0, 0), (60*SCALE, 0))
        netted = collected_sibling
        sequences = [
            (0, [(0, collect), ('pool', 30), (1, pay), ('pool', 10)]),
            (1, [(0, collect), (1, pay), (1, collected_sibling), ('pool', 20)]),
            (0, [(0, collect), ('pool', 30), (1, netted), ('pool', 10)]),
            (1, [(0, collect), (1, netted), ('pool', 20)]),
        ]
        # Balanced fills and liquidation-style inventory/cash transfers alter
        # both counterparties; the summary must track fee-driven cash as well.
        full = [row(1000, (1,-1), (-10*SCALE,20*SCALE)),
                row(1000, (-1,1), (10*SCALE,-20*SCALE))]
        for selected in range(2):
            cases = [(original, sequence) for market, sequence in sequences if market == selected]
            cases.append((full, [(0, row(999,(2,-1),(-20*SCALE,20*SCALE))),
                                (1, row(1000,(-2,1),(20*SCALE,-20*SCALE))),
                                (0, row(0,(1,-1),(-10*SCALE,20*SCALE))),
                                (1, row(1999,(-1,1),(10*SCALE,-20*SCALE))),
                                (0, row(1000,(1,-1),(-10*SCALE,20*SCALE))),
                                (1, row(999,(-1,1),(10*SCALE,-20*SCALE)))]))
            for roots, sequence in cases:
                live = list(roots)
                operations = [f'scan:{index}' for index in range(len(roots))]
                pool = 0
                expected = []
                for index, replacement in sequence:
                    if index == 'pool':
                        pool = replacement
                        operations.append(f'pool:{pool}')
                    else:
                        live[index] = replacement
                        operations.append(f'mutate:{index}:{csv(replacement)}')
                    values = [expectation(root, REGION, selected) for root in live]
                    quantity = sum(item[0] for item in values)
                    positive = sum(max(item[1],0) for item in values)
                    negative = sum(max(-item[1],0) for item in values)
                    bad = sum(item[2] for item in values)
                    required = [sum(bool(item[3] & (1<<market)) for item in values) for market in range(2)]
                    expected.append(encoded_summary(len(roots),bad,quantity,positive,negative,required)
                                    + ','+str(int(bad == 0 and quantity == 0 and positive-negative == pool*SCALE)))
                command = f'sequence|{selected}|{bounds(REGION)}|'+ ';'.join(map(csv,roots))+'|'+ ';'.join(operations)+'|0'
                self.assertEqual(run([command])[0].split(';')[len(roots):],expected)
                self.assertTrue(expected[-1].endswith(',1'))
        print('six literal mixed-market collection/payment/netting/fill/fee paths match every changed summary')


if __name__ == '__main__':
    unittest.main()
