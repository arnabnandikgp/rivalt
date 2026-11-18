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


def compare(source):
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
    assert pools == (0, 0) and insurance == (498, 0) and fees == (20, 0)
    assert list(map(int, source["funding"])) == [0, 0]
    # Cash is already net of signed trading fees. Replaying just the paired
    # position changes prevents counting either the fee or its insurance share twice.
    cash = tuple(int(row["cash"]) for row in rows)
    history = PaymentHistory.start("closed-first", cash, mark, insurance[0])
    history = replace(history, market=replace(history.market, book=replace(history.market.book, fees=fees)))
    fills = source["fills"]
    assert [(fill["side"], fill["maker"]) for fill in fills] == [(0, keys[debtor]), (1, keys[winner])]
    assert [int(fill["gross"]) for fill in fills] == [60_002, 60_998]
    for fill in fills:
        assert int(fill["traderId"]) == int(rows[trader]["id"]) and int(fill["lots"]) == 1
        maker = keys.index(fill["maker"])
        buyer, seller = (trader, maker) if fill["side"] == 0 else (maker, trader)
        history = history.trade(buyer, seller, 1, int(fill["gross"]))

    assert tuple(int(row["btcLots"]) for row in rows) == history.market.lots
    for row, account in zip(rows, history.market.book.accounts, strict=True):
        assert tuple(Fraction(int(claim), 10**9) for claim in row["claims"]) == account.claims
    current = terminal(freeze(history.market, mark).book)
    successor = history.resolve_at(mark, debtor)

    # Literal independent arithmetic for one lot: both rules distribute 8,498.
    # Pro rata, 996 * 8,498 / 9,998 rounds to 847 for the flat trader; the other
    # creditor receives 7,651. The sole eligible open gain can absorb all 1,500.
    def credits(plan):
        return tuple(after - before for before, after in zip(cash, plan.cash, strict=True))

    assert credits(current)[trader] == 847 and credits(current)[winner] == 7_651
    assert credits(successor.payout)[trader] == 996 and credits(successor.payout)[winner] == 7_502
    for plan in (current, successor.payout):
        delta = credits(plan)
        assert delta[debtor] == -8_000 and sum(delta) == 498
        assert all(value == 0 for index, value in enumerate(delta) if index not in (trader, debtor, winner))
        assert plan.insurance_spent == (498, 0)
    assert successor.charges[winner] == sum(successor.charges) == 1_500
    assert successor.fills == ((winner, 1, 68_500),) and successor.residual == 0
    return {
        "onchainExpectedCash": dict(zip(keys, map(str, current.cash), strict=True)),
        "successorModelCash": dict(zip(keys, map(str, successor.payout.cash), strict=True)),
        "shortfallAfterInsurance": "1500", "winnerCharge": "1500", "forcedClosePrice": "68500",
        "residualAfterForcedClose": str(successor.residual),
    }


if __name__ == "__main__":
    json.dump(compare(json.load(sys.stdin)), sys.stdout)
