#!/usr/bin/env bash
# P12 only: provision a fresh environment, without rerunning unrelated suites.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
test "$(surfpool --version)" = 'surfpool 1.6.1'
export RIVALT_RPC_PORT="${RIVALT_RPC_PORT:-18899}" RIVALT_WS_PORT="${RIVALT_WS_PORT:-18900}"
export RIVALT_RPC_URL="http://127.0.0.1:$RIVALT_RPC_PORT" RIVALT_WS_URL="ws://127.0.0.1:$RIVALT_WS_PORT"
export RIVALT_RUN_DIR="${RIVALT_RUN_DIR:-.local/load/$(date -u +%Y%m%dT%H%M%SZ)-$$}"
test ! -e "$RIVALT_RUN_DIR"
mkdir -p "$RIVALT_RUN_DIR"
python3 ops/check-ports.py "$RIVALT_RPC_PORT" "$RIVALT_WS_PORT" 15432 18081 18083 18084
surfpool start --offline --no-deploy --no-tui --no-studio --port "$RIVALT_RPC_PORT" --ws-port "$RIVALT_WS_PORT" \
  --slot-time 50 --airdrop-keypair-path .local/keys/payer.json --log-path "$RIVALT_RUN_DIR/logs" > "$RIVALT_RUN_DIR/surfpool.log" 2>&1 &
RIVALT_SURFPOOL_PID=$!
trap 'if [[ -n "${RIVALT_PG_CONTAINER:-}" ]]; then container logs "$RIVALT_PG_CONTAINER" > "$RIVALT_RUN_DIR/postgres.log" 2>&1 || true; container stop "$RIVALT_PG_CONTAINER" >/dev/null 2>&1 || true; container delete "$RIVALT_PG_CONTAINER" >/dev/null 2>&1 || true; fi; kill "$RIVALT_SURFPOOL_PID" 2>/dev/null || true; wait "$RIVALT_SURFPOOL_PID" 2>/dev/null || true' EXIT
ready=0
for _ in {1..100}; do
  kill -0 "$RIVALT_SURFPOOL_PID" 2>/dev/null || exit 1
  if curl -fsS --connect-timeout 1 --max-time 2 "$RIVALT_RPC_URL" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>/dev/null | grep -q '"ok"'; then ready=1;break;fi
  sleep 0.1
done
test "$ready" = 1
for program in clearing maker_a maker_b oracle_fixture; do
  key="${program//_/-}"
  solana-keygen new --silent --no-bip39-passphrase --outfile "$RIVALT_RUN_DIR/buffer-$key.json" >/dev/null
  solana program deploy "target/deploy/$program.so" --buffer "$RIVALT_RUN_DIR/buffer-$key.json" --program-id ".local/keys/$key.json" \
    --keypair .local/keys/payer.json --url "$RIVALT_RPC_URL" --use-rpc --max-sign-attempts 20 --output json > "$RIVALT_RUN_DIR/deployment-$key.json"
done
source ops/postgres.sh
node ops/record-toolchain.mjs > "$RIVALT_RUN_DIR/toolchain.json"
node --import tsx tests/load/run.ts "$@"
