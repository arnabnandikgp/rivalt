#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
umask 077
export RIVALT_RUN_DIR=".local/devnet/p14-lifecycle-$(date -u +%Y%m%dT%H%M%SZ)-$$"
export RIVALT_PG_PORT=15442
mkdir -p "$RIVALT_RUN_DIR"
cleanup() {
  if [[ -n "${RIVALT_PG_CONTAINER:-}" ]]; then
    container logs "$RIVALT_PG_CONTAINER" > "$RIVALT_RUN_DIR/postgres.log" 2>&1 || true
    container stop "$RIVALT_PG_CONTAINER" >/dev/null 2>&1 || true
    container delete "$RIVALT_PG_CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
source ops/postgres.sh
caffeinate -i -t 1200 node --env-file=.env.devnet --import tsx tests/rpc-contract/devnet-lifecycle.ts
