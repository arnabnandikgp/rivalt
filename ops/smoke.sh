#!/usr/bin/env bash
# Current integration matrix. Does not build, run historical profiles or start endurance.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
export RIVALT_ARTIFACT_DIR="${RIVALT_ARTIFACT_DIR:-.local/anchor-rc2/current}"
node --import tsx ops/verify-liquidity-artifacts.ts "$RIVALT_ARTIFACT_DIR"
node --import tsx tests/rpc-contract/liquidity-hostile-svm.ts
for probe in account-custody canonical-maker funding-publisher liquidity-execution liquidity-safety liquidity-indexer liquidity-journal liquidity-services liquidity-resource liquidity-operations; do
  bash "ops/$probe-smoke.sh"
done
