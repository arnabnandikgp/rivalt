#!/usr/bin/env bash
# Scoped P32 sampler probe; no full-phase acceptance or trading activation.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
test "$(surfpool --version)" = 'surfpool 1.6.1'
export RIVALT_RPC_PORT="${RIVALT_RPC_PORT:-18941}"
export RIVALT_WS_PORT="${RIVALT_WS_PORT:-18942}"
export RIVALT_RPC_URL="http://127.0.0.1:$RIVALT_RPC_PORT"
export RIVALT_WS_URL="ws://127.0.0.1:$RIVALT_WS_PORT"
export RIVALT_RUN_DIR="${RIVALT_RUN_DIR:-.local/liquidity-execution/runs/$(date -u +%Y%m%dT%H%M%SZ)-$$}"
test ! -e "$RIVALT_RUN_DIR"
test -f .local/liquidity-execution/clearing.so
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
for component in clearing maker_a maker_b oracle_fixture; do
  key_name="${component//_/-}"
  solana-keygen new --silent --no-bip39-passphrase --outfile "$RIVALT_RUN_DIR/$component-buffer.json" >/dev/null
  solana program deploy ".local/liquidity-execution/$component.so" --buffer "$RIVALT_RUN_DIR/$component-buffer.json" \
    --program-id ".local/keys/$key_name.json" --keypair .local/keys/payer.json --url "$RIVALT_RPC_URL" \
    --use-rpc --max-sign-attempts 20 --output json > "$RIVALT_RUN_DIR/$component-deployment.json"
done
case "${RIVALT_LIQUIDITY_PROBE:-sampling}" in
  sampling) node --import tsx tests/rpc-contract/liquidity-sampling-rpc.ts ;;
  funding-publisher) node --import tsx tests/rpc-contract/funding-publisher-rpc.ts ;;
  execution) node --import tsx tests/rpc-contract/liquidity-execution-rpc.ts ;;
  resources) node --import tsx tests/rpc-contract/liquidity-resource-rpc.ts ;;
  *) echo 'Unknown scoped liquidity probe' >&2; exit 1 ;;
esac
printf 'P32 sampler probe evidence: %s\n' "$RIVALT_RUN_DIR"
