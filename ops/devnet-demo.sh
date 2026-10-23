#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
umask 077
export RIVALT_RUN_DIR=".local/devnet/p14-demo-$(date -u +%Y%m%dT%H%M%SZ)-$$"
export RIVALT_PG_PORT=15442
mkdir -p "$RIVALT_RUN_DIR"
cleanup() {
  for pid in "${demo_pid:-}" "${ui_pid:-}"; do
    if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  done
  if [[ -n "${RIVALT_PG_CONTAINER:-}" ]]; then
    container logs "$RIVALT_PG_CONTAINER" > "$RIVALT_RUN_DIR/postgres.log" 2>&1 || true
    container stop "$RIVALT_PG_CONTAINER" >/dev/null 2>&1 || true
    container delete "$RIVALT_PG_CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
source ops/postgres.sh
node --env-file=.env.devnet --import tsx tests/rpc-contract/devnet-demo.ts > "$RIVALT_RUN_DIR/services.log" 2>&1 &
demo_pid=$!
for _ in {1..120}; do
  if [[ -f "$RIVALT_RUN_DIR/ready" ]]; then break; fi
  kill -0 "$demo_pid" 2>/dev/null || { cat "$RIVALT_RUN_DIR/services.log"; exit 1; }
  sleep 1
done
test -f "$RIVALT_RUN_DIR/ready"
export RIVALT_TRADER_CONFIG="$PWD/$RIVALT_RUN_DIR/trader-config.json"
export RIVALT_SERVICE_ORIGIN=http://127.0.0.1:18091
export RIVALT_INDEXER_ORIGIN=http://127.0.0.1:18090
pnpm build:trader > "$RIVALT_RUN_DIR/build-ui.log" 2>&1
node apps/trader/node_modules/vite/bin/vite.js preview apps/trader --host 127.0.0.1 --port 18088 --strictPort > "$RIVALT_RUN_DIR/ui.log" 2>&1 &
ui_pid=$!
echo "Devnet test UI: http://127.0.0.1:18088 (up to 60 minutes; Ctrl-C stops owned services)"
wait "$demo_pid"
