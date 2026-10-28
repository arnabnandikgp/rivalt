"""Independent exhaustive exact-pair check for P32's native table search.

Table holes model nonprefix financial feasibility; no chain or source evidence is
inferred. Whole-account table construction is separately qualified in P32 clearing.
"""
import itertools
import random
import subprocess


def expected(rows, quantity, side):
    answers = []
    # Enumerate all integer compositions, then explicitly reject three capitals.
    for first in range(quantity+1):
        for second in range(quantity-first+1):
            allocation = (first, second, quantity-first-second)
            selected = tuple(index for index, size in enumerate(allocation) if size)
            if len(selected) > 2 or any(rows[index][allocation[index]] == 0 for index in selected):
                continue
            gross = sum(rows[index][allocation[index]] for index in selected)
            key = (gross if side == 0 else -gross, len(selected), selected, -allocation[selected[0]])
            answers.append((key, gross, allocation))
    if not answers:
        return 'NONE'
    _, gross, allocation = min(answers)
    return 'OK ' + ' '.join(map(str, (gross, *allocation)))


def main():
    rng = random.Random(320032)
    cases = []
    for quantity, side in itertools.product(range(1, 17), (0, 1)):
        for _ in range(20):
            rows = []
            for _maker in range(3):
                offset, slope = rng.randrange(0, 15), rng.randrange(0, 4)
                rows.append([0] + [0 if rng.randrange(4) == 0 else
                    1000*lots + (1 if side == 0 else -1)*(offset*lots+slope*lots*(lots-1)//2)
                    for lots in range(1, quantity+1)])
            cases.append((rows, quantity, side))
    # The full 600-lot domain includes all three candidates and ties/quantity holes.
    for side in (0, 1):
        rows = [[0]+[lots*100 for lots in range(1,601)] for _ in range(3)]
        for row in rows:
            row[600] = 0
        rows[0][599] = 0
        cases.append((rows, 600, side))
    vectors = [' '.join(map(str, [quantity, side, *sum((row[1:] for row in rows), [])]))
               for rows, quantity, side in cases]
    result = subprocess.run(['target/debug/liquidity-sample-driver'],input='\n'.join(vectors)+'\n',
                            text=True,capture_output=True,check=True)
    actual = result.stdout.splitlines()
    assert len(actual) == len(cases), result.stderr
    for index, (line, (rows, quantity, side)) in enumerate(zip(actual, cases)):
        target = expected(rows, quantity, side)
        assert line == target, (index, rows, quantity, side, line, target)
    print(f'P32 native sample allocation: {len(cases)} independent exhaustive cases passed')


if __name__ == '__main__':
    main()
