#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
test "$(surfpool --version)" = "surfpool 1.6.1"
export RIVALT_RPC_PORT="${RIVALT_RPC_PORT:-18899}"
export RIVALT_WS_PORT="${RIVALT_WS_PORT:-18900}"
export RIVALT_RPC_URL="http://127.0.0.1:$RIVALT_RPC_PORT"
export RIVALT_WS_URL="ws://127.0.0.1:$RIVALT_WS_PORT"
export RIVALT_RUN_DIR="${RIVALT_RUN_DIR:-.local/runs/$(date -u +%Y%m%dT%H%M%SZ)-$$}"
test ! -e "$RIVALT_RUN_DIR" # Never reuse an earlier run as fresh evidence.
mkdir -p "$RIVALT_RUN_DIR"
cp .local/p02-financial.json "$RIVALT_RUN_DIR/financial.json"
cp .local/p02-svm.json "$RIVALT_RUN_DIR/svm.json"
cp .local/p03-svm.json "$RIVALT_RUN_DIR/maker-svm.json"
cp .local/p04-svm.json "$RIVALT_RUN_DIR/route-svm.json"
# Refuse occupied ports rather than connecting to or stopping someone else's runtime.
python3 ops/check-ports.py "$RIVALT_RPC_PORT" "$RIVALT_WS_PORT"
surfpool start --offline --no-deploy --no-tui --no-studio \
  --port "$RIVALT_RPC_PORT" --ws-port "$RIVALT_WS_PORT" --slot-time "${RIVALT_SLOT_TIME:-100}" \
  --airdrop-keypair-path .local/keys/payer.json \
  --log-path "$RIVALT_RUN_DIR/logs" > "$RIVALT_RUN_DIR/surfpool.log" 2>&1 &
RIVALT_SURFPOOL_PID=$!
trap 'if [[ -n "${RIVALT_PG_CONTAINER:-}" ]]; then container logs "$RIVALT_PG_CONTAINER" > "$RIVALT_RUN_DIR/postgres.log" 2>&1 || true; container stop "$RIVALT_PG_CONTAINER" >/dev/null 2>&1 || true; container delete "$RIVALT_PG_CONTAINER" >/dev/null 2>&1 || true; fi; kill "$RIVALT_SURFPOOL_PID" 2>/dev/null || true; wait "$RIVALT_SURFPOOL_PID" 2>/dev/null || true' EXIT
ready=0
for _ in {1..100}; do
  if ! kill -0 "$RIVALT_SURFPOOL_PID" 2>/dev/null; then
    echo "Surfpool exited before readiness; see $RIVALT_RUN_DIR/surfpool.log" >&2
    exit 1
  fi
  if curl -fsS --connect-timeout 1 --max-time 2 "$RIVALT_RPC_URL" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>/dev/null | grep -q '"ok"'; then ready=1; break; fi
  sleep 0.1
done
if [[ "$ready" != 1 ]]; then
  echo "Surfpool did not become healthy; see $RIVALT_RUN_DIR/surfpool.log" >&2
  exit 1
fi
solana-keygen new --silent --no-bip39-passphrase --outfile "$RIVALT_RUN_DIR/deploy-buffer.json" >/dev/null
solana program deploy target/deploy/clearing.so --buffer "$RIVALT_RUN_DIR/deploy-buffer.json" --program-id .local/keys/clearing.json \
  --keypair .local/keys/payer.json --url "$RIVALT_RPC_URL" --use-rpc --max-sign-attempts 20 --output json \
  > "$RIVALT_RUN_DIR/deployment.json"
for maker in a b; do
  solana-keygen new --silent --no-bip39-passphrase --outfile "$RIVALT_RUN_DIR/deploy-buffer-$maker.json" >/dev/null
  solana program deploy "target/deploy/maker_$maker.so" --buffer "$RIVALT_RUN_DIR/deploy-buffer-$maker.json" --program-id ".local/keys/maker-$maker.json" \
    --keypair .local/keys/payer.json --url "$RIVALT_RPC_URL" --use-rpc --max-sign-attempts 20 --output json \
    > "$RIVALT_RUN_DIR/deployment-maker-$maker.json"
done
node --import tsx tests/rpc-contract/smoke.ts
node --import tsx tests/rpc-contract/custody-rpc.ts
source ops/postgres.sh
node --import tsx tests/rpc-contract/indexer-rpc.ts
node --import tsx tests/rpc-contract/indexer-reset.ts
node ops/record-toolchain.mjs > "$RIVALT_RUN_DIR/toolchain.json"
printf 'Evidence: %s\n' "$RIVALT_RUN_DIR"
