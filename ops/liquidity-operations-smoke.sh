#!/usr/bin/env bash
# Separate P34 default/recovery/complete-exit fixture on the canonical artifacts.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
export RIVALT_RUN_DIR="${RIVALT_RUN_DIR:-.local/liquidity-execution/qualification/$(date -u +%Y%m%dT%H%M%SZ)-operations-$$}"
test ! -e "$RIVALT_RUN_DIR"
mkdir -p "$RIVALT_RUN_DIR"
RIVALT_OPERATIONS_ROOT="$RIVALT_RUN_DIR"
export RIVALT_PG_PORT="${RIVALT_PG_PORT:-15448}"
container system status >/dev/null
trap 'if [[ -n ${RIVALT_PG_CONTAINER:-} ]]; then container stop "$RIVALT_PG_CONTAINER" >/dev/null 2>&1 || true; container delete "$RIVALT_PG_CONTAINER" >/dev/null 2>&1 || true; fi' EXIT
source ops/liquidity-qualification-postgres.sh
export RIVALT_RUN_DIR="$RIVALT_OPERATIONS_ROOT/operations"
export RIVALT_CONTINUATION_PROFILE=treatment
export RIVALT_CONTINUATION_ENTRY=tests/rpc-contract/liquidity-qualification-operations.ts
bash ops/liquidity-continuation-smoke.sh
