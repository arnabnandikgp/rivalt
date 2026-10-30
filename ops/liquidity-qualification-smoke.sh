#!/usr/bin/env bash
# P34 uses one owned PostgreSQL cluster, separate fresh profile/replay databases.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
export RIVALT_RUN_DIR="${RIVALT_RUN_DIR:-.local/liquidity-execution/qualification/$(date -u +%Y%m%dT%H%M%SZ)-$$}"
test ! -e "$RIVALT_RUN_DIR"
mkdir -p "$RIVALT_RUN_DIR"
RIVALT_QUALIFICATION_ROOT="$RIVALT_RUN_DIR"
export RIVALT_PG_PORT="${RIVALT_PG_PORT:-15448}"
container system status >/dev/null
trap 'if [[ -n ${RIVALT_PG_CONTAINER:-} ]]; then container stop "$RIVALT_PG_CONTAINER" >/dev/null 2>&1 || true; container delete "$RIVALT_PG_CONTAINER" >/dev/null 2>&1 || true; fi' EXIT
source ops/liquidity-qualification-postgres.sh
# Optional scoped retry selects a declared profile, never alters offer/time counts.
for RIVALT_CONTINUATION_PROFILE in ${RIVALT_QUALIFICATION_PROFILES:-control treatment}; do
  export RIVALT_CONTINUATION_PROFILE
  export RIVALT_RUN_DIR="$RIVALT_QUALIFICATION_ROOT/$RIVALT_CONTINUATION_PROFILE"
  export RIVALT_CONTINUATION_ENTRY=tests/rpc-contract/liquidity-qualification-rpc.ts
  bash ops/liquidity-continuation-smoke.sh
 done
printf 'P34 qualification evidence: %s\n' "$RIVALT_QUALIFICATION_ROOT"
