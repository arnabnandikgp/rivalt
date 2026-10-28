"""Compare independent P29B pricing expectations against actual native Rust code.

Run after cargo build --locked -p maker-interface --bin curve-reference-driver.
The rust/sdk selections are host parity. Explicit sbf-a/sbf-b selections execute
the deployed program artifacts in LiteSVM; neither selection claims RPC acceptance.
No broad inherited tests run.
"""
import itertools
from dataclasses import replace
import argparse
from pathlib import Path
import random
import struct
import subprocess

from maker_curve_reference import Curve, Region, capacity, quote
from test_maker_curve_contract import walk_quote


def wire_shape(curve):
    header = struct.pack("<BHqQQQQBB", 3 if curve.reduce_only else 1, 150,
                         curve.target, curve.step, curve.tick, curve.long_cap,
                         curve.short_cap, len(curve.bids), len(curve.asks))
    regions = b""
    for side in (curve.bids, curve.asks):
        for region in side:
            regions += struct.pack("<QQQ", region.end, region.offset, region.slope)
        regions += bytes(24 * (8 - len(side)))
    assert len(header + regions) == 429
    return (header + regions).hex()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--implementation", choices=("rust", "sdk", "both", "sbf-a", "sbf-b"), default="both")
    selected = parser.parse_args().implementation
    cases, expected = [], []

    def case(curve, anchor, side, lots, inventory, consumed):
        cases.append(f"{wire_shape(curve)} {anchor} {side} {lots} {inventory} {consumed}")
        try:
            gross = quote(curve, anchor, side, lots, inventory, consumed)
            # Three independent paths: cumulative model, per-lot derivation, Rust.
            walked, _ = walk_quote(curve, anchor, side, lots, inventory, consumed)
            assert gross == walked
            expected.append(f"OK {gross} {capacity(curve, side, inventory, consumed) - lots}")
        except ValueError:
            expected.append("ERR")

    golden = Curve((Region(3, 2, 1), Region(8, 8, 0)),
                   (Region(3, 3, 2), Region(8, 12, 0)), step=2, tick=2)
    for side, inventory, consumed in itertools.product((0, 1), range(-8, 9), range(9)):
        for lots in range(10 - consumed):
            case(golden, 100, side, lots, inventory, consumed)

    # One-sided books need compiled coverage, including their unavailable side,
    # fragmented consumption and inventory-reducing limits in both directions.
    for empty_side, reduce_only, inventory, side, lots, consumed in itertools.product(
            ("bids", "asks"), (False, True), (-3, 0, 3), (0, 1), (0, 1, 3, 4), (0, 2, 3)):
        one_sided = replace(golden, **{empty_side: (), "reduce_only": reduce_only})
        case(one_sided, 100, side, lots, inventory, consumed)

    rng = random.Random(3001)
    for _ in range(1000):
        sides = []
        for _side in range(2):
            regions, end, last_offset = [], 0, 0
            for _region in range(rng.randrange(1, 9)):
                width = rng.randrange(1, 80)
                end += width
                offset, slope = last_offset + rng.randrange(0, 6), rng.randrange(0, 5)
                regions.append(Region(end, offset, slope))
                last_offset = offset + (width - 1) * slope
            sides.append(tuple(regions))
        curve = Curve(*sides, target=rng.randrange(-50, 51), step=rng.randrange(1, 80),
                      tick=rng.randrange(0, 20), long_cap=100, short_cap=100,
                      reduce_only=bool(rng.randrange(2)))
        case(curve, rng.choice((1, 100, 60_000, 1_000_000)), rng.randrange(2),
             rng.randrange(1, 100), rng.randrange(-120, 121), rng.randrange(0, 90))

    for side, inventory, tick, lots, consumed in itertools.product(
            (0, 1), (-100_000_000, 0, 100_000_000), (0, 1000), (1, 4096), (0, 4096)):
        extreme = Curve((Region(4096, 0, 0),), (Region(4096, 0, 0),),
                        target=-100_000_000, step=1, tick=tick)
        case(extreme, 1_000_000, side, lots, inventory, consumed)

    binary = Path(__file__).resolve().parents[2] / "target/debug/curve-reference-driver"
    root = Path(__file__).resolve().parents[2]
    commands = {}
    if selected in ("rust", "both"):
        commands["Rust"] = [str(binary)]
    if selected in ("sdk", "both"):
        commands["SDK"] = ["node", "--import", "tsx", str(root / "tests/financial/maker-curve-sdk-driver.ts")]
    if selected in ("sbf-a", "sbf-b"):
        commands[selected] = ["env", f"RIVALT_CANONICAL_PROGRAM=maker_{selected[-1]}", "node", "--import", "tsx",
                              str(root / "tests/rpc-contract/canonical-maker-svm-driver.ts")]
    for name, command in commands.items():
        result = subprocess.run(command, input="\n".join(cases) + "\n", text=True,
                                capture_output=True, check=True, cwd=root)
        actual = result.stdout.splitlines()
        assert len(actual) == len(expected), (name, len(actual), len(expected), result.stderr)
        for index, (want, got) in enumerate(zip(expected, actual)):
            assert got == want or (want == "ERR" and got.startswith("ERR ")), (name, index, cases[index], want, got)
        successes = sum(value != "ERR" for value in expected)
        print(f"Canonical {name} parity: {len(cases)} vectors, {successes} exact quotes, "
              f"{len(cases) - successes} expected rejections")


if __name__ == "__main__":
    main()
