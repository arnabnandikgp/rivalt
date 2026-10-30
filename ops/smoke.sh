#!/usr/bin/env bash
# Current integration matrix. Does not build, run historical profiles or start endurance.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
for probe in account-custody canonical-maker funding-publisher liquidity-execution liquidity-safety liquidity-indexer liquidity-journal liquidity-services liquidity-resource liquidity-operations; do
  bash "ops/$probe-smoke.sh"
done
