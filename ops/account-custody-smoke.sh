#!/usr/bin/env bash
# Scoped fresh P23 custody runtime; no maker/service/load/full-matrix launch.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
test "$(surfpool --version)" = 'surfpool 1.6.1'
export RIVALT_RPC_PORT="${RIVALT_RPC_PORT:-18881}"
export RIVALT_WS_PORT="${RIVALT_WS_PORT:-18882}"
export RIVALT_RPC_URL="http://127.0.0.1:$RIVALT_RPC_PORT"
export RIVALT_WS_URL="ws://127.0.0.1:$RIVALT_WS_PORT"
export RIVALT_RUN_DIR="${RIVALT_RUN_DIR:-.local/account-custody/$(date -u +%Y%m%dT%H%M%SZ)-$$}"
test ! -e "$RIVALT_RUN_DIR"
test -f .local/account-centric/clearing.so
python3 ops/check-ports.py "$RIVALT_RPC_PORT" "$RIVALT_WS_PORT"
mkdir -p "$RIVALT_RUN_DIR"
surfpool start --offline --no-deploy --no-tui --no-studio --disable-instruction-profiling \
  --port "$RIVALT_RPC_PORT" --ws-port "$RIVALT_WS_PORT" --slot-time 50 \
  --airdrop-keypair-path .local/keys/payer.json --log-path "$RIVALT_RUN_DIR/logs" \
  > "$RIVALT_RUN_DIR/surfpool.log" 2>&1 &
RIVALT_ACCOUNT_SURFPOOL_PID=$!
trap 'kill "$RIVALT_ACCOUNT_SURFPOOL_PID" 2>/dev/null || true; wait "$RIVALT_ACCOUNT_SURFPOOL_PID" 2>/dev/null || true' EXIT
ready=0
for _ in {1..100}; do
  kill -0 "$RIVALT_ACCOUNT_SURFPOOL_PID" 2>/dev/null || { echo 'Owned Surfpool exited before readiness' >&2; exit 1; }
  if curl -fsS --connect-timeout 1 --max-time 2 "$RIVALT_RPC_URL" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>/dev/null | grep -q '"ok"'; then ready=1; break; fi
  sleep 0.1
done
[[ "$ready" == 1 ]] || { echo 'Owned Surfpool not ready' >&2; exit 1; }
solana-keygen new --silent --no-bip39-passphrase --outfile "$RIVALT_RUN_DIR/deploy-buffer.json" >/dev/null
solana program deploy .local/account-centric/clearing.so --buffer "$RIVALT_RUN_DIR/deploy-buffer.json" \
  --program-id .local/keys/clearing.json --keypair .local/keys/payer.json --url "$RIVALT_RPC_URL" \
  --use-rpc --max-sign-attempts 20 --output json > "$RIVALT_RUN_DIR/deployment.json"
node --import tsx tests/rpc-contract/account-custody-rpc.ts
python3 tests/financial/account-custody-reference.py "$RIVALT_RUN_DIR/summary.json"
printf 'P23 evidence: %s\n' "$RIVALT_RUN_DIR"
