"""Compare frozen candidate bytes to exact survivor accounting from finalized events."""
from fractions import Fraction
import json
import sys

from frozen_attribution_input import Fill, Payment, SCALE, Survivor


def check(source):
    rows = source["rows"]
    keys = {int(row["id"]): row["key"] for row in rows}
    assert len(keys) == len(rows) == 8
    histories = {row["key"]: Survivor() for row in rows}
    for event in source["economic"]:
        data = event["data"]
        if event["kind"] == "LiquidityRouteExecutedV4":
            sign = 1 if data["side"] == 0 else -1
            trader = keys[int(data["rootStates"][0]["id"])]
            def apply(key, lots, gross):
                price, remainder = divmod(int(gross), abs(lots))
                assert remainder == 0  # This constructed book has flat signed quotes.
                histories[key] = histories[key].apply(Fill(lots, price))
            apply(trader, sign*int(data["lots"]), data["grossQuote"])
            for leg in data["legs"]:
                apply(leg["capital"], -sign*int(leg["lots"]), leg["gross"])
        else:
            assert data["kind"] == 3 and data["marketIndex"] == 0
            key, = data["roots"]
            state, = data["rootStates"]
            market, = [market for market in data["markets"] if market["index"] == 0]
            amount, mark = int(data["amount"]), int(market["referencePrice"])
            position = state["positions"][0]
            assert int(position["fundingCheckpointScaled"]) == int(market["fundingIndexScaled"]) == 0
            prior_claim = int(position["lots"])*mark*SCALE + int(position["virtualScaled"]) + amount*SCALE
            assert (prior_claim, amount, mark) == (3988*SCALE, 2492, 61000)
            histories[key] = histories[key].apply(Payment(mark, prior_claim, amount))
    for row in rows:
        expected = histories[row["key"]]
        assert list(map(int, row["lots"])) == [expected.lots, 0]
        for index, state in enumerate((expected, Survivor())):
            observed = row["positions"][index]
            den = int(observed["denominator"])*SCALE
            assert Fraction(int(observed["entryScaled"]), den)*state.lots == state.entry_cost
            assert Fraction(int(observed["paidScaled"]), den)*abs(state.lots) == state.unpaid_basis-state.entry_cost
    assert histories[source["trader"]].unpaid_basis == 60252
    print("All 16 frozen market slots agree with independent finalized-fill and payment replay.")


if __name__ == "__main__":
    check(json.load(sys.stdin))
