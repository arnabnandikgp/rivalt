"""P54A compiled completion diagnostics; logical work and CPU, never SBF CU.

Raw JSON stdout stays ignored/local. The untrusted Python proposer and exact
comparison model run separately; native execution is timed without their cost.
"""
import argparse
from functools import cmp_to_key
import json
from time import perf_counter

from measure_scalable_clearing import cohort
from scalable_clearing_candidate import round_plan, solve
from test_scalable_settlement import assert_work_bounds, command, decode, run


def measure(count, shape):
    rows, participating = cohort(count, shape)
    insurance = (0, 1) if shape == "cycle-creditor" else (0, 0)
    started = perf_counter()
    proposals = []
    plan = solve(rows, insurance=insurance, compact=True,
                 proposal_sink=lambda factor, rates: proposals.append((factor, *rates)))
    orders = []
    for market in range(2):
        def compare(first, second):
            left = rows[first][1][market]
            right = rows[second][1][market]
            if (left > 0) != (right > 0):
                return -1 if left > 0 else 1
            if left > 0:
                first_value = left*plan.rate_numerators[market] % plan.denominator
                second_value = right*plan.rate_numerators[market] % plan.denominator
                if first_value != second_value:
                    return -1 if first_value > second_value else 1
            return (first > second) - (first < second)
        orders.append(tuple(sorted(range(count), key=cmp_to_key(compare))))
    proposal_seconds = perf_counter() - started
    request = command(rows, (0, 0), insurance, (17, 23), proposals, orders, full=False)
    started = perf_counter()
    actual = decode(run([request])[0])
    assert_work_bounds(count, actual["metrics"])
    compiled_seconds = perf_counter() - started
    started = perf_counter()
    expected_cash, expected_movements = round_plan(rows, (0, 0), plan, compact=True)
    reference_seconds = perf_counter() - started
    assert actual["cash"] == expected_cash
    assert actual["movements"] == expected_movements
    assert actual["spent"] == plan.insurance_spent
    assert actual["budgets"] == plan.budgets
    assert actual["evaluations"] == plan.evaluations
    assert actual["metrics"][5] == plan.work.augmentations
    assert sum(actual["cash"]) == sum(row[0] for row in rows) + sum(plan.insurance_spent)
    if shape == "repeated-fraction":
        # Independent literal invariant for every populated triple, not a model
        # output: one owned cash atom, two debts 2:1, both recovery rates 1/3.
        assert all(rate.numerator == 1 and rate.denominator == 3 for rate in plan.rates)
        assert actual["spent"] == (0, 0)
        assert sum(actual["cash"]) == participating // 3
    names = ("arithmeticWordSteps", "comparisonWordReads", "largestUsedWords", "graphSteps",
             "arcVisits", "augmentations", "activeWordReads", "activeWordWrites", "nativeGraphPayloadBytes")
    return {
        "registered": str(count), "claimParticipating": str(participating), "empty": str(count-participating),
        "funded": str(sum(row[0] != 0 for row in rows)), "shape": shape,
        "outcome": "complete compiled native kernel; not on-chain qualification",
        "valuation": "synthetic frozen claims; position admission and exposed counts are not measured",
        "commonBits": str(plan.common.bit_length()), "rateBits": str((plan.denominator//10**9).bit_length()),
        "untrustedProposalSeconds": round(proposal_seconds, 6),
        "compiledProcessSeconds": round(compiled_seconds, 6), "referenceRoundSeconds": round(reference_seconds, 6),
        "work": {name: str(value) for name, value in zip(names, actual["metrics"])},
        "insuranceEvaluations": str(actual["evaluations"]),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--counts", type=int, nargs="+", default=[64, 128, 1024, 10000])
    parser.add_argument("--shapes", nargs="+", default=["cycle-creditor", "repeated-fraction", "distinct-fraction", "mixed-wide-links"])
    args = parser.parse_args()
    if min(args.counts) < 3:
        parser.error("counts must be at least three")
    for count in args.counts:
        for shape in args.shapes:
            print(json.dumps(measure(count, shape)), flush=True)
