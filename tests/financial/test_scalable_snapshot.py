"""Independent frozen-total/continuation arithmetic, not account authentication."""
from pathlib import Path
from random import Random
import subprocess
import unittest
from test_scalable_clearing import samples

DRIVER = Path('target/debug/scalable-snapshot-driver').resolve()


def run(commands):
    output = subprocess.run([str(DRIVER)], input='\n'.join(commands) + '\n', text=True,
                            capture_output=True, check=True).stdout.splitlines()
    if len(output) != len(commands):
        raise AssertionError((len(output), len(commands)))
    return output


def command(rows, pools, insurance, fees=(3, 7), lots=None, **overrides):
    lots = lots or [(0, 0)] * len(rows)
    fields = dict(allocated=sum(cash for cash, _ in rows) + sum(pools + insurance + fees),
                  pools=','.join(map(str, pools)), insurance=','.join(map(str, insurance)),
                  fees=','.join(map(str, fees)), gross=','.join(str(sum(abs(q[m]) for q in lots)) for m in range(2)),
                  count=len(rows), rows=';'.join(f'{2**40 + i*67},{cash},{claims[0]},{claims[1]},{q[0]},{q[1]}'
                                               for i, ((cash, claims), q) in enumerate(zip(rows, lots))))
    fields.update(overrides)
    return '|'.join(('snapshot', *(str(fields[key]) for key in ('allocated', 'pools', 'insurance', 'fees', 'gross', 'count', 'rows'))))


def words(value):
    return [(value >> (64 * index)) % 2**64 for index in range(3)]


class ScalableSnapshot(unittest.TestCase):
    def test_exact_151_bit_total_domain_and_carries(self):
        rng = Random(540201)
        cases = [(2**128 - 1, 1), (2**150, 2**150 - 1), (2**150, 2**150), (2**151, 0)]
        cases += [(rng.randrange(2**151), rng.randrange(2**151)) for _ in range(300)]
        for line, (left, right) in zip(run([f'total|{a:x}|{b:x}' for a, b in cases]), cases):
            if max(left, right, left + right) >= 2**151:
                self.assertTrue(line.startswith('err:'), line)
            else:
                self.assertEqual(int(line, 16), left + right)
        print(f'{len(cases)} independent aggregate domain/carry cases matched')

    def test_every_encoded_prefix_matches_independent_totals(self):
        cases = list(samples())
        cases += [([(10**15, (0, 0))], (0, 0), (0, 0)),
                  ([(0, (100300000000000000000000000, -100300000000000000000000000)),
                    (0, (-100300000000000000000000000, 100300000000000000000000000))], (0, 0), (0, 0))]
        commands = []
        for rows, pools, insurance in cases:
            lots = [(0, 0)] * len(rows)
            if len(rows) > 1:
                lots[0], lots[-1] = (100_000_000, -50_000_000), (-100_000_000, 50_000_000)
            commands.append(command(rows, pools, insurance, (0, 0), lots))
        prefixes = 0
        for line, (rows, pools, insurance) in zip(run(commands), cases):
            self.assertFalse(line.startswith('err:'), line)
            cash, positive, negative, encoded = line.split('|')
            self.assertEqual(int(cash), sum(row[0] for row in rows))
            want_positive = [sum(max(claim[m], 0) for _, claim in rows) for m in range(2)]
            want_negative = [sum(max(-claim[m], 0) for _, claim in rows) for m in range(2)]
            self.assertEqual(list(map(int, positive.split(','))), [word for value in want_positive for word in words(value)])
            self.assertEqual(list(map(int, negative.split(','))), [word for value in want_negative for word in words(value)])
            snapshots = encoded.split(';')
            self.assertEqual(len(snapshots), len(rows))
            for ordinal, snapshot in enumerate(snapshots):
                prefix = rows[:ordinal+1]
                data = bytes.fromhex(snapshot)
                self.assertEqual(len(data), 288)
                integer = lambda start, size=8: int.from_bytes(data[start:start+size], 'little')
                self.assertEqual(integer(16), ordinal+1)
                self.assertEqual(integer(24), 2**40 + ordinal*67)
                self.assertEqual(integer(32), sum(row[0] for row in prefix))
                for m in range(2):
                    self.assertEqual(integer(168+m*24, 24), sum(max(claim[m], 0) for _, claim in prefix))
                    self.assertEqual(integer(216+m*24, 24), sum(max(-claim[m], 0) for _, claim in prefix))
                prefixes += 1
        print(f'{len(cases)} complete valuations / {prefixes} encoded prefixes matched independent totals')

    def test_conservation_membership_and_position_failures_reject(self):
        rows = [(20, (-15*10**9, 0)), (0, (15*10**9, 0))]
        good = command(rows, (0, 0), (2, 3), lots=[(1, 0), (-1, 0)])
        parts = good.split('|')
        cases = []
        for index, value in [(1, '34'), (1, '36'), (2, '1,0'), (5, '0,0'), (5, '4,0'), (5, '200000001,0'), (6, '1'), (6, '3')]:
            changed = parts.copy(); changed[index] = value; cases.append('|'.join(changed))
        first, second = parts[7].split(';')
        for bad_rows in [first, first+';'+first, second+';'+first,
                         first+';'+second.replace(',0,15000000000,', ',0,14000000000,'),
                         first+';'+second.replace(',-1,0', ',1,0'),
                         first.replace(',1,0', ',100000001,0')+';'+second]:
            changed = parts.copy(); changed[7] = bad_rows; cases.append('|'.join(changed))
        self.assertFalse(run([good])[0].startswith('err:'))
        for line, case in zip(run(cases), cases):
            self.assertTrue(line.startswith('err:'), case)
        print(f'{len(cases)} wrong totals, ordering, count and position cases rejected')


if __name__ == '__main__':
    unittest.main()
