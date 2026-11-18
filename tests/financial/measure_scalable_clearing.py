"""P51B diagnostic sweep. JSON stdout belongs at an ignored local evidence path.

Operation counts are abstract native work, NOT CU or landed transaction counts.
Memory/arc budgets prevent a design experiment exhausting the operator machine;
budget exhaustion is reported explicitly and supplies no completed payout plan.
"""

import argparse
from dataclasses import asdict
import json
from time import perf_counter

from scalable_clearing_candidate import MAX_CLAIM, SCALE, Work, common_denominator, round_plan, solve, validate


def cohort(count, shape):
    rows = []
    if shape == "cycle-creditor":
        for index in range(count // 3):
            face, debt = (100 + index % 17) * SCALE, (80 + index % 23) * SCALE
            rows.extend(((0, (face, -debt)), (0, (-face, debt-SCALE)), (0, (0, SCALE))))
    elif shape in ("repeated-fraction", "distinct-fraction", "mixed-wide-links"):
        for index in range(count // (5 if shape == "mixed-wide-links" else 3)):
            if shape == "repeated-fraction":
                btc, eth = 2*SCALE, SCALE
            else:
                btc, eth = MAX_CLAIM//4+index*6+1, MAX_CLAIM//4+index*10+2
            rows.extend(((1, (-btc, -eth)), (0, (btc, 0)), (0, (0, eth))))
            if shape == "mixed-wide-links":
                face, debt = (100 + index % 17)*SCALE, (80 + index % 23)*SCALE
                rows.extend(((0, (face, -debt)), (0, (-face, debt))))
    else:
        raise ValueError("unknown diagnostic shape")
    # Extra empty identities are explicit and do not pad any headline populated count.
    participating = len(rows)
    rows.extend((0, (0, 0)) for _ in range(count - len(rows)))
    return tuple(rows), participating


def measure(count, shape, memory_bytes, arc_visits, compact):
    rows, participating = cohort(count, shape)
    insurance = (0, 1) if shape == "cycle-creditor" else (0, 0)
    validate(rows, (0, 0), insurance)
    result = {"registered": str(count), "participating": str(participating), "shape": shape,
              "candidate": "compact" if compact else "dense",
              "valuation": "already-valued synthetic claims; no position-admission or RPC evidence"}
    for strategy in ("product", "reduced-lcm"):
        work = Work()
        started = perf_counter()
        common_denominator(rows, strategy, work)
        result[strategy] = {"denominatorBits": str(work.common_bits),
                            "denominatorLimbVisits": str(work.denominator_limb_visits),
                            "nativeSeconds": round(perf_counter()-started, 6)}
    # Dense flow baseline: two wide flow cells for every row. This is a lower
    # bound on total runtime storage, not a Python peak-memory measurement.
    width = (int(result["reduced-lcm"]["denominatorBits"]) + 63) // 64 * 8
    dense_bytes = 2 * count * width
    result["denseFlowBytesLowerBound"] = str(dense_bytes)
    if dense_bytes > memory_bytes and not compact:
        result["outcome"] = "denominator-only: dense-flow diagnostic memory budget exceeded"
        return result
    started = perf_counter()
    plan = solve(rows, insurance=insurance, compact=compact)
    result["solveNativeSeconds"] = round(perf_counter()-started, 6)
    started = perf_counter()
    try:
        cash, _ = round_plan(rows, (0, 0), plan, max_arc_visits=arc_visits, compact=compact)
        assert sum(cash) == sum(row[0] for row in rows) + sum(plan.insurance_spent)
        result["outcome"] = "complete native candidate; not runtime qualification"
    except RuntimeError as error:
        result["outcome"] = str(error)
    result["roundNativeSeconds"] = round(perf_counter()-started, 6)
    result["work"] = {key: str(value) for key, value in asdict(plan.work).items()}
    result["insuranceEvaluations"] = str(plan.evaluations)
    result["rates"] = [str(rate) for rate in plan.rates] if shape in ("cycle-creditor", "repeated-fraction") else "large exact rationals omitted"
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--counts", type=int, nargs="+", default=[64, 128, 1024, 10000])
    parser.add_argument("--dense-flow-budget-mib", type=int, default=64)
    parser.add_argument("--arc-visits", type=int, default=2_000_000)
    parser.add_argument("--compact", action="store_true")
    args = parser.parse_args()
    if min(args.counts) < 3 or args.dense_flow_budget_mib <= 0 or args.arc_visits <= 0:
        parser.error("positive diagnostic budgets and counts >=3 required")
    for count in args.counts:
        for shape in ("cycle-creditor", "repeated-fraction", "distinct-fraction", "mixed-wide-links"):
            print(json.dumps(measure(count, shape, args.dense_flow_budget_mib*1024*1024, args.arc_visits, args.compact)), flush=True)
