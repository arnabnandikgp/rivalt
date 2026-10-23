"""Independent rational complete-cohort oracle for actual signed chain snapshots.
No SDK, Rust implementation, generated account code, or resolution record imports.
"""
from fractions import Fraction
import json
import sys

S = 10**9
x = json.load(sys.stdin)
ps = sorted(x['participants'], key=lambda p: p['id'])
ids = [p['id'] for p in ps]
assert len(ids) == len(set(ids)) and 0 < len(ids) <= 64
F, M = int(x['funding']), int(x['price'])
cash = [int(p['cash']) for p in ps]
claims = [Fraction(int(p['virtualScaled']) - int(p['lots']) * (F - int(p['fundingCheckpointScaled'])), S) + int(p['lots']) * M for p in ps]
pool, insurance = int(x['settlement']), int(x['insurance'])
assert sum(int(p['lots']) for p in ps) == 0
assert sum(claims) == pool

def allocate(total, weights):
    if not sum(weights):
        assert total == 0
        return [0] * len(weights)
    exact = [total * Fraction(w, sum(weights)) for w in weights]
    result = [v.numerator // v.denominator for v in exact]
    rank = sorted(range(len(ids)), key=lambda i: (-(exact[i] - result[i]), ids[i]))
    for i in rank[:total - sum(result)]:
        result[i] += 1
    assert sum(result) == total
    return result

collected = [min(c, int(-min(u, 0))) for c, u in zip(cash, claims)]
claims = [u + c for u, c in zip(claims, collected)]
pool += sum(collected)
debts = [-min(u, 0) for u in claims]
z = min(insurance, int(sum(debts)))
insured = allocate(z * S, debts)
remaining = sum(debts) - z
losses = allocate(int(remaining * S), [max(u, 0) for u in claims])
entitlements = [max(u, 0) - Fraction(loss, S) for u, loss in zip(claims, losses)]
paid = allocate(pool + z, entitlements)
rounding = [int((a - u) * S) for a, u in zip(paid, entitlements)]
assert sum(rounding) == 0 and all(abs(v) < S for v in rounding)
rows = [dict(id=p['id'], cash=str(c-col+pay), collected=str(col), claim=str(int(u*S)),
             insuredScaled=str(ins), impairedScaled=str(loss), paid=str(pay), roundingScaled=str(delta))
        for p,c,col,u,ins,loss,pay,delta in zip(ps,cash,collected,claims,insured,losses,paid,rounding)]
assert sum(int(r['cash']) for r in rows) + insurance - z == sum(cash) + int(x['settlement']) + insurance
print(json.dumps(dict(insurance=str(insurance-z), insuredAtoms=str(z), planPool=str(pool+z), rows=rows)))
