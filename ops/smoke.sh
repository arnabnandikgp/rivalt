#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
# An absolute store keeps npm lifecycle-inherited config from resolving differently
# inside the independent legacy root. CI permits noninteractive node_modules repair.
CI=true pnpm install --frozen-lockfile --store-dir "$PWD/.local/pnpm-store"
CI=true pnpm --dir tests/anchor-conformance install --frozen-lockfile --store-dir "$PWD/.local/pnpm-store"
mkdir -p .local
cp packages/sdk/idl/clearing.json .local/expected-clearing-idl.json
bash ops/build.sh
cmp packages/sdk/idl/clearing.json .local/expected-clearing-idl.json
pnpm generate:check
pnpm typecheck
pnpm test
node ops/check-dependencies.mjs
test "$(surfpool --version)" = "surfpool 1.6.1"
export RIVALT_RPC_PORT="${RIVALT_RPC_PORT:-18899}"
export RIVALT_WS_PORT="${RIVALT_WS_PORT:-18900}"
export RIVALT_RPC_URL="http://127.0.0.1:$RIVALT_RPC_PORT"
export RIVALT_WS_URL="ws://127.0.0.1:$RIVALT_WS_PORT"
export RIVALT_RUN_DIR=".local/runs/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$RIVALT_RUN_DIR"
# Refuse occupied ports rather than connecting to or stopping someone else's runtime.
python3 - "$RIVALT_RPC_PORT" "$RIVALT_WS_PORT" <<'PY'
import socket, sys
for port in sys.argv[1:]:
    with socket.socket() as s:
        s.bind(("127.0.0.1", int(port)))
PY
surfpool start --offline --no-deploy --no-tui --no-studio \
  --port "$RIVALT_RPC_PORT" --ws-port "$RIVALT_WS_PORT" --slot-time 100 \
  --airdrop-keypair-path .local/keys/payer.json \
  --log-path "$RIVALT_RUN_DIR/logs" > "$RIVALT_RUN_DIR/surfpool.log" 2>&1 &
RIVALT_SURFPOOL_PID=$!
trap 'kill "$RIVALT_SURFPOOL_PID" 2>/dev/null || true; wait "$RIVALT_SURFPOOL_PID" 2>/dev/null || true' EXIT
for attempt in {1..100}; do
  kill -0 "$RIVALT_SURFPOOL_PID"
  if curl -fsS "$RIVALT_RPC_URL" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>/dev/null | rg -q '"ok"'; then break; fi
  sleep 0.1
done
solana program deploy target/deploy/clearing.so --program-id .local/keys/clearing.json \
  --keypair .local/keys/payer.json --url "$RIVALT_RPC_URL" --use-rpc --output json \
  > "$RIVALT_RUN_DIR/deployment.json"
node --import tsx tests/rpc-contract/smoke.ts
node ops/record-toolchain.mjs > "$RIVALT_RUN_DIR/toolchain.json"
printf 'Evidence: %s\n' "$RIVALT_RUN_DIR"
