"""Actual persisted graph execution vs independent rational/atom owners.

Native construction remains a separate unqualified on-chain prerequisite. The
cursor itself reads only its declared bounded records and restores byte checkpoints.
"""
import unittest
from clearing_network_reference import clear_atom_cohort
from test_scalable_settlement import independent_input, command, run, decode
from test_scalable_clearing import samples
from scalable_clearing_candidate import SCALE, MAX_CLAIM


class PagedRounding(unittest.TestCase):
    def test_complete_graph_payouts_match_independent_atom_ownership(self):
        commands, expected = [], []
        edges = [(((10**15-40, (0, 0)),), (0, 0), (0, 0)),
                 (((0, (0, 0)),), (0, 0), (40, 80)),
                 (((0, (MAX_CLAIM, -MAX_CLAIM)), (0, (-MAX_CLAIM, MAX_CLAIM))), (0, 0), (13, 17)),
                 (((10**15-70, (-MAX_CLAIM, -MAX_CLAIM)), (0, (MAX_CLAIM, 0)), (0, (0, MAX_CLAIM))), (0, 0), (13, 17))]
        for rows, pools, insurance in [*samples(), *edges]:
            fees = (17, 23)
            accounts, _, proposals, orders = independent_input(rows, pools, insurance, fees)
            oracle = clear_atom_cohort(accounts, pools, insurance, fees)
            for budget in (1, 7, 128):
                commands.append(command(rows, pools, insurance, fees, proposals, orders, budget).replace('full|', 'paged|', 1))
                expected.append((oracle, insurance))
        maximum, reads, writes, augmentations = 0, 0, 0, 0
        for case, (line, (oracle, insurance)) in enumerate(zip(run(commands), expected)):
            with self.subTest(case=case):
                self.assertFalse(line.startswith('err:'), (line, commands[case]))
                got = decode(line)
                self.assertEqual(got['cash'], oracle.cash)
                self.assertEqual(got['movements'], oracle.claim_cash_movements)
                self.assertEqual(got['spent'], oracle.insurance_spent)
                self.assertEqual(got['remaining_insurance'], tuple(insurance[market]-oracle.insurance_spent[market] for market in range(2)))
                self.assertEqual(got['retained_fees'], (17, 23))
                steps, actual_reads, actual_writes, actual_augmentations, build_steps, build_reads, build_writes = map(int, line.split('|')[-1].split(','))
                self.assertEqual(actual_augmentations, oracle.augmentations)
                self.assertLessEqual(actual_reads+actual_writes, 4*steps)
                self.assertGreater(build_steps, 0)
                self.assertLessEqual(build_reads+build_writes, 3*build_steps)
                maximum = max(maximum, steps)
                reads += actual_reads
                writes += actual_writes
                augmentations += actual_augmentations
        print(f'{len(expected)} persisted canonical graph executions match independent exact atom owners; '
              f'{augmentations} augmentations, max {maximum} steps, {reads} reads and {writes} writes across fixtures')


if __name__ == '__main__':
    unittest.main()
