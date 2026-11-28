"""Select the best protected charge allocation from finalized local trade postings."""
from copy import deepcopy
import json
import sys
from fractions import Fraction

from test_three_market_competition import reference as competing_reference
from test_three_market_reduction import compare_reference, protected_settlement
from market_indexed_reference import expected


def select(book):
    baseline = expected(book)
    if "competition" in book:
        best, enumerated, feasible = competing_reference(book)
        winners = best["winners"]
        assert [winner["id"] for winner in winners] == ["0", "2"]
        # Explain two refused originals independently of the optimum. Both fully
        # cover BTC; only one preserves the other markets' original entitlements.
        target = next(i for i, market in enumerate(book["markets"]) if market["id"] == book["competition"]["market"])
        by_id = {row["id"]: i for i, row in enumerate(book["rows"])}
        controls = {}
        for first, second in ((3, 7), (5, 5)):
            candidate = deepcopy(book)
            for member, delta in [(best["debtor"], first + second), (winners[0]["id"], -first), (winners[1]["id"], -second)]:
                claims = candidate["rows"][by_id[member]]["claims"]
                claims[target] = str(int(claims[target]) + delta * 10**9)
            controls[f"{first}/{second}"] = protected_settlement(book, candidate, baseline, target) is not None
        terminal = best["settlement"]
        return dict(charge=str(sum(int(w["charge"]) for w in winners)), winners=winners,
                    matched=str(sum(int(w["matched"]) for w in winners)), protectedControls=controls,
                    enumerated=enumerated, feasible=feasible, before=[r["cash"] for r in baseline["rows"]],
                    payouts=[r["cash"] for r in terminal["rows"]], spent=terminal["spent"])
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
