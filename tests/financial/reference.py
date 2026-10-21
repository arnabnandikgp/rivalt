"""Independent Fraction oracle; no imports of protocol or generated implementation."""
from fractions import Fraction
import json
import random
import subprocess
from pathlib import Path

SCALE = 10**9
rng = random.Random(0x524956414C54)
commands, expected = [], []
profile = json.loads(Path("scenarios/local-profile-v1.json").read_text())
commands.append("profile")
expected.append([int(v) for v in profile["limits"].values()])

def allocation(total, ids, weights):
    if not sum(weights):
        assert total == 0
        return [0] * len(weights)
    exact = [Fraction(total * w, sum(weights)) for w in weights]
    floor = [x.numerator // x.denominator for x in exact]
    rank = sorted(range(len(ids)), key=lambda i: (-(exact[i] - floor[i]), ids[i]))
    for i in rank[:total - sum(floor)]:
        floor[i] += 1
    assert sum(floor) == total
    assert all(abs(exact[i] - floor[i]) < 1 for i in range(len(ids)))
    return floor

for _ in range(1200):
    count = rng.randint(1, 64)
    ids = rng.sample(range(64), count)
    weights = [rng.randrange(10**26) for _ in ids]
    total = rng.randrange(sum(weights) + 1)
    commands.append("allocate " + str(total) + " " + " ".join(f"{i} {w}" for i, w in zip(ids, weights)))
    expected.append(allocation(total, ids, weights))

for _ in range(1200):
    lots = rng.randint(-10**8, 10**8)
    virtual = rng.randint(-10**23, 10**23)
    indices = [rng.randint(-10**15, 10**15) for _ in range(rng.randint(2, 12))]
    claim = Fraction(virtual, SCALE)
    for start, end in zip(indices, indices[1:]):
        claim -= lots * (Fraction(end, SCALE) - Fraction(start, SCALE))
    commands.append("fund " + " ".join(map(str, [lots, virtual, *indices])))
    expected.append([int(claim * SCALE)])

for _ in range(600):
    count = rng.randint(2, 64)
    ids = rng.sample(range(64), count)
    original_cash = [rng.randrange(10**6) for _ in ids]
    original = [Fraction(rng.randint(-10**7 * SCALE, 10**7 * SCALE), SCALE) for _ in ids[:-1]]
    initial_settlement = rng.randrange(10**5)
    original.append(Fraction(initial_settlement) - sum(original))
    initial_insurance = rng.randrange(10**6)
    def resolve(cash_in, claims_in, ins, pool):
        balances, vals = cash_in[:], claims_in[:]
        for i, c in enumerate(vals):
            take = min(balances[i], int(-min(c, 0)))
            balances[i] -= take
            vals[i] += take
            pool += take
        debts = [-min(v, 0) for v in vals]
        cover = min(ins, int(sum(debts)))
        pool += cover
        insured = allocation(cover * SCALE, ids, [int(v * SCALE) for v in debts])
        vals = [v + Fraction(x, SCALE) for v, x in zip(vals, insured)]
        debt = -sum(min(v, 0) for v in vals)
        losses = allocation(int(debt * SCALE), ids, [int(max(v, 0) * SCALE) for v in vals])
        vals = [max(v, 0) - Fraction(x, SCALE) for v, x in zip(vals, losses)]
        paid = allocation(pool, ids, vals)
        result = [ins - cover]
        for i in range(count):
            delta = int((paid[i] - vals[i]) * SCALE)
            assert abs(delta) < SCALE
            result.extend([balances[i] + paid[i], losses[i], delta])
        assert sum(result[3::3]) == 0
        assert sum(result[1::3]) + result[0] == sum(cash_in) + ins + initial_settlement
        return result
    commands.append("default " + f"{initial_insurance} {initial_settlement} " + " ".join(f"{i} {c} {int(v*SCALE)}" for i, c, v in zip(ids, original_cash, original)))
    expected.append(resolve(original_cash, original, initial_insurance, initial_settlement))

run = subprocess.run(["target/debug/reference-driver"], input="\n".join(commands) + "\n", text=True, capture_output=True, check=True)
actual = [[int(x) for x in row.split()] for row in run.stdout.splitlines()]
assert len(actual) == len(expected)
for i, (got, want) in enumerate(zip(actual, expected)):
    assert got == want, (i, commands[i], got, want)
print(json.dumps({
    "revision": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
    "sourceDirty": bool(subprocess.check_output(["git", "status", "--porcelain"], text=True).strip()),
    "seed": "0x524956414c54", "profile": "scenarios/local-profile-v1.json",
    "allocation_cases": 1200, "funding_cases": 1200, "default_cases": 600, "profile_checks": 1,
    "result": "pass"
}))
