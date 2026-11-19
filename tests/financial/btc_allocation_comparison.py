"""An independently enumerated, two-winner book reconstructed from confirmed fills."""
from fractions import Fraction
from hashlib import sha256
import json
import sys

data = json.load(sys.stdin)
rows = data["rows"]
keys = [r["key"] for r in rows]
ids = {int(r["id"]): r["key"] for r in rows}
cost = {key: 0 for key in keys}
lots = cost.copy()
for fill in data["fills"]:
    trader, maker = ids[int(fill["traderId"])], fill["maker"]
    buyer, seller = (trader, maker) if fill["side"] == 0 else (maker, trader)
    size, gross = int(fill["lots"]), int(fill["gross"])
    lots[buyer] += size
    lots[seller] -= size
    cost[buyer] += gross
    cost[seller] -= gross
claims = {k: lots[k] * 70_000 - cost[k] for k in keys}
assert all(lots[r["key"]] == int(r["btcLots"]) and
           [claims[r["key"]] * 10**9, 0] == list(map(int, r["claims"])) for r in rows)
cash = {r["key"]: int(r["cash"]) for r in rows}
debtor, first, second = (data[k] for k in ("debtor", "winner", "otherWinner"))
assert lots[debtor] == -2 and lots[first] == lots[second] == 1 and len(data["fills"]) == 3
assert claims[data["trader"]] == 996 and data["pools"] == ["0","0"] and data["funding"] == ["0","0"]
insurance = int(data["insurance"][0])
assert insurance == 501 and data["insurance"][1] == "0" and data["fees"] == ["30","0"]
loss = -claims[debtor] - cash[debtor] - insurance
assert loss == (1 if data["case"] == "equal" else 3495)
venue = 0
for digit in data["venue"]:
    venue = venue*58 + "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".index(digit)
prefix = b"Rivalt/frozen-member-order/v1\0" + venue.to_bytes(32, "big") + int(data["epoch"]).to_bytes(8, "little")
ordered = sorted([first,second], key=lambda key:sha256(prefix+next(i for i,k in ids.items() if k==key).to_bytes(8,"little")).digest())
def score(charges):
    return (sum(Fraction(charges[k]**2, claims[k]) for k in (first,second)),
            sum(x>0 for x in charges.values()),tuple(-charges[k] for k in ordered))
charges = min(({first:a,second:loss-a} for a in range(loss+1)
                if a<=claims[first] and loss-a<=claims[second]), key=score)
final = {key: cash[key]+claims[key]-charges.get(key,0) for key in keys}
final[debtor] = 0
assert sum(final.values()) == sum(cash.values())+insurance
json.dump(dict(successorModelCash={k:str(v) for k,v in final.items()},
    charges={k:str(charges.get(k,0)) for k in keys}, winnerCharge=str(loss), flatPayout="996"),sys.stdout)
