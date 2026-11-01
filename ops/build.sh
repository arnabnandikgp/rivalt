#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
export PATH="$PWD/.tools/anchor-v2-rc2/bin:$PATH"
bash ops/build-liquidity-execution.sh
for program in clearing maker_a maker_b; do
  NO_DNA=1 anchor idl build -p "$program" -o "packages/sdk/idl/$program.json" -- --locked
done
pnpm generate
python3 ops/anchor_rc2_wire_contract.py
