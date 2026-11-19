"""Replay the two finalized BTC fills and compare terminal rules at the same cutoff.

This is the one-debtor, one-open-winner case. Every account starts flat. No
ordinary claim payment precedes the freeze and both funding indexes are zero.
"""
import json
import sys
from dataclasses import replace
from fractions import Fraction

from adl_eligibility_model import freeze
from payment_attribution_model import PaymentHistory
from settlement_liquidation_model import terminal


# opening lots, final maker entry, funded debtor, protected fees, BTC insurance,
# flat and winner payouts before/after the change, ADL charge and residual loss.
CASES = {
    "full": (1, 60_998, 8_000, 20, 498, 847, 7_651, 996, 7_502, 1_500, 0),
    "partial": (1, 69_498, 8_000, 21, 498, 8_071, 427, 8_498, 0, 502, 998),
    "none": (1, 70_000, 8_000, 21, 498, 8_498, 0, 8_498, 0, 0, 1_500),
    "multi": (3, 68_998, 27_000, 60, 511, 24_754, 2_757, 26_988, 523, 2_483, 0),
}


def compare(source):
    case = source.get("case", "full")
    lots, entry, funded, protected_fees, reserve, flat_before, maker_before, flat_after, maker_after, charge, residual = CASES[case]
    rows = source["rows"]
    keys = [row["key"] for row in rows]
    assert len(set(keys)) == len(keys)
    debtor, winner, trader = (keys.index(source[key]) for key in ("debtor", "winner", "trader"))
    assert len({debtor, winner, trader}) == 3
    mark = int(source["mark"])
    assert mark == 70_000
    pools = tuple(map(int, source["pools"]))
    insurance = tuple(map(int, source["insurance"]))
    fees = tuple(map(int, source["fees"]))
    assert pools == (0, 0) and insurance == (reserve, 0) and fees == (protected_fees, 0)
    assert list(map(int, source["funding"])) == [0, 0]
    # Cash is already net of signed trading fees. Replaying just the paired
    # position changes prevents counting either the fee or its insurance share twice.
    cash = tuple(int(row["cash"]) for row in rows)
    history = PaymentHistory.start("closed-first", cash, mark, insurance[0])
    history = replace(history, market=replace(history.market, book=replace(history.market.book, fees=fees)))
    fills = source["fills"]
    assert [(fill["side"], fill["maker"]) for fill in fills] == [(0, keys[debtor]), (1, keys[winner])]
    assert [int(fill["gross"]) for fill in fills] == [lots * 60_002, lots * entry]
    for fill in fills:
        assert int(fill["traderId"]) == int(rows[trader]["id"]) and int(fill["lots"]) == lots
        maker = keys.index(fill["maker"])
        buyer, seller = (trader, maker) if fill["side"] == 0 else (maker, trader)
        history = history.trade(buyer, seller, lots, int(fill["gross"]) // lots)

    assert tuple(int(row["btcLots"]) for row in rows) == history.market.lots
    for row, account in zip(rows, history.market.book.accounts, strict=True):
        assert tuple(Fraction(int(claim), 10**9) for claim in row["claims"]) == account.claims
    current = terminal(freeze(history.market, mark).book)
    successor = history.resolve_at(mark, debtor)

    # Expected balances and fills are literal, independently worked from the two
    # trades and the funded budgets. Compare the entire cohort under both rules.
    def credits(plan):
        return tuple(after - before for before, after in zip(cash, plan.cash, strict=True))

    assert credits(current)[trader] == flat_before and credits(current)[winner] == maker_before
    assert credits(successor.payout)[trader] == flat_after and credits(successor.payout)[winner] == maker_after
    for plan in (current, successor.payout):
        delta = credits(plan)
        assert delta[debtor] == -funded and sum(delta) == reserve
        assert all(value == 0 for index, value in enumerate(delta) if index not in (trader, debtor, winner))
        assert plan.insurance_spent == (reserve, 0)
    assert successor.charges[winner] == sum(successor.charges) == charge
    expected_fills = {
        "full": ((winner, 1, 68_500),), "partial": ((winner, 1, 69_498),),
        "none": (), "multi": ((winner, 1, 69_173), (winner, 2, 69_172)),
    }[case]
    assert successor.fills == expected_fills and successor.residual == residual
    return {
        "onchainExpectedCash": dict(zip(keys, map(str, current.cash), strict=True)),
        "successorModelCash": dict(zip(keys, map(str, successor.payout.cash), strict=True)),
        "shortfallAfterInsurance": str(charge + residual), "winnerCharge": str(charge),
        "forcedClosePrice": str(expected_fills[0][2] if expected_fills else 0),
        "matchedLots": str(sum(size for _, size, _ in expected_fills)),
        "extraTickLots": str(expected_fills[1][1] if len(expected_fills) > 1 else 0),
        "flatPayout": str(flat_after),
        "residualAfterForcedClose": str(successor.residual),
    }


if __name__ == "__main__":
    json.dump(compare(json.load(sys.stdin)), sys.stdout)
