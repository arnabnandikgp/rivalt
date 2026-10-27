#!/usr/bin/env bash
# P27 focused schema-3 finalized journal, RPC/WS/PostgreSQL and read API qualification.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
case "${1:-indexer}" in
  indexer) RIVALT_ACCOUNT_CHECK=indexer; RIVALT_ACCOUNT_DRIVER=tests/rpc-contract/account-indexer-rpc.ts ;;
  --direct-sdk) RIVALT_ACCOUNT_CHECK=direct; RIVALT_ACCOUNT_DRIVER=tests/rpc-contract/account-direct-rpc.ts ;;
  *) echo 'Expected indexer or --direct-sdk' >&2; exit 2 ;;
esac
test "$(surfpool --version)" = 'surfpool 1.6.1'
container system status >/dev/null
export RIVALT_RPC_PORT="${RIVALT_RPC_PORT:-18931}"
export RIVALT_WS_PORT="${RIVALT_WS_PORT:-18932}"
export RIVALT_RPC_URL="http://127.0.0.1:$RIVALT_RPC_PORT"
export RIVALT_WS_URL="ws://127.0.0.1:$RIVALT_WS_PORT"
export RIVALT_RUN_DIR="${RIVALT_RUN_DIR:-.local/account-$RIVALT_ACCOUNT_CHECK-rpc/$(date -u +%Y%m%dT%H%M%SZ)-$$}"
test ! -e "$RIVALT_RUN_DIR"
test -f .local/account-safety/clearing.so
for component in maker_a maker_b oracle_fixture; do test -f ".local/account-safety/$component.so"; done
export RIVALT_PG_PORT="${RIVALT_PG_PORT:-15443}"
python3 ops/check-ports.py "$RIVALT_RPC_PORT" "$RIVALT_WS_PORT" "$RIVALT_PG_PORT"
mkdir -p "$RIVALT_RUN_DIR"
surfpool start --offline --no-deploy --no-tui --no-studio --disable-instruction-profiling \
  --port "$RIVALT_RPC_PORT" --ws-port "$RIVALT_WS_PORT" --slot-time 50 \
  --airdrop-keypair-path .local/keys/payer.json --log-path "$RIVALT_RUN_DIR/logs" \
  > "$RIVALT_RUN_DIR/surfpool.log" 2>&1 &
RIVALT_ACCOUNT_SAFETY_SURFPOOL_PID=$!
trap 'if [[ -n ${RIVALT_PG_CONTAINER:-} ]]; then container stop "$RIVALT_PG_CONTAINER" >/dev/null 2>&1 || true; container delete "$RIVALT_PG_CONTAINER" >/dev/null 2>&1 || true; fi; kill "$RIVALT_ACCOUNT_SAFETY_SURFPOOL_PID" 2>/dev/null || true; wait "$RIVALT_ACCOUNT_SAFETY_SURFPOOL_PID" 2>/dev/null || true' EXIT
ready=0
for _ in {1..100}; do
  kill -0 "$RIVALT_ACCOUNT_SAFETY_SURFPOOL_PID" 2>/dev/null || { echo 'Owned Surfpool exited before readiness' >&2; exit 1; }
  if curl -fsS --connect-timeout 1 --max-time 2 "$RIVALT_RPC_URL" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>/dev/null | grep -q '"ok"'; then ready=1; break; fi
  sleep 0.1
done
[[ "$ready" == 1 ]] || { echo 'Owned Surfpool not ready' >&2; exit 1; }
for component in clearing maker_a maker_b oracle_fixture; do
  key="${component//_/-}"
  solana-keygen new --silent --no-bip39-passphrase --outfile "$RIVALT_RUN_DIR/buffer-$key.json" >/dev/null
  artifact=.local/account-safety
  solana program deploy "$artifact/$component.so" --buffer "$RIVALT_RUN_DIR/buffer-$key.json" \
    --program-id ".local/keys/$key.json" --keypair .local/keys/payer.json --url "$RIVALT_RPC_URL" \
    --use-rpc --max-sign-attempts 20 --output json > "$RIVALT_RUN_DIR/deployment-$key.json"
done
source ops/postgres.sh
node --import tsx "$RIVALT_ACCOUNT_DRIVER"
printf 'P27 indexer evidence: %s\n' "$RIVALT_RUN_DIR"
