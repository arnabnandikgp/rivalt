"""Select the best protected single-pair charge from finalized local trade postings."""
import json
import sys
from fractions import Fraction

from test_three_market_reduction import compare_reference
from three_market_reference import expected


def select(book):
    baseline = expected(book)
    action = book["reduction"]
    debtor = int(action["debtor"])
    winner = int(action["winner"])
    target = next(i for i, m in enumerate(book["markets"]) if m["id"] == action["market"])
    upper = int(Fraction(baseline["rows"][debtor]["writeoff"][target]))
    assert 0 < upper <= 1000, "this exhaustive replay is for the bounded signed workload"
    best = None
    feasible = 0
    for charge in range(1, upper + 1):
        action["charge"] = str(charge)
        choice = compare_reference(book)
        if choice is None:
            continue
        feasible += 1
        rank = (Fraction(choice["recovery"]), -int(choice["matched"]))
        if best is None or rank > best[0]:
            best = (rank, charge, choice)
        elif rank == best[0]:
            raise AssertionError("the signed fixture must have a unique optimum")
    assert best and winner != debtor
    _, charge, choice = best
    terminal = choice["settlement"]
    return dict(charge=str(charge), matched=choice["matched"], enumerated=upper, feasible=feasible,
                before=[row["cash"] for row in baseline["rows"]],
                payouts=[row["cash"] for row in terminal["rows"]], spent=terminal["spent"])


if __name__ == "__main__":
    print(json.dumps(select(json.load(sys.stdin))))
