#!/usr/bin/env bash
# P21A focused fresh group service/RPC/WS/PostgreSQL integration. Test assets only.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
case "${1:-indexer}" in
  indexer) RIVALT_GROUP_CHECK=indexer; RIVALT_GROUP_DRIVER=tests/rpc-contract/group-indexer-rpc.ts ;;
  --direct-sdk) RIVALT_GROUP_CHECK=direct; RIVALT_GROUP_DRIVER=tests/rpc-contract/group-direct-rpc.ts ;;
  --market-workers) RIVALT_GROUP_CHECK=workers; RIVALT_GROUP_DRIVER=tests/rpc-contract/group-market-workers-rpc.ts ;;
  --trading-services) RIVALT_GROUP_CHECK=trading-services; RIVALT_GROUP_DRIVER=tests/rpc-contract/group-trading-services-rpc.ts ;;
  --settlement-services) RIVALT_GROUP_CHECK=settlement-services; RIVALT_GROUP_DRIVER=tests/rpc-contract/group-settlement-rpc.ts ;;
  --risk-services) RIVALT_GROUP_CHECK=risk-services; RIVALT_GROUP_DRIVER=tests/rpc-contract/group-risk-services-rpc.ts ;;
  *) echo 'Expected indexer, --direct-sdk, --market-workers, --trading-services, --settlement-services or --risk-services' >&2; exit 2 ;;
esac
test "$(surfpool --version)" = 'surfpool 1.6.1'
export RIVALT_RPC_PORT="${RIVALT_RPC_PORT:-18921}"
export RIVALT_WS_PORT="${RIVALT_WS_PORT:-18922}"
export RIVALT_RPC_URL="http://127.0.0.1:$RIVALT_RPC_PORT"
export RIVALT_WS_URL="ws://127.0.0.1:$RIVALT_WS_PORT"
export RIVALT_RUN_DIR="${RIVALT_RUN_DIR:-.local/group-$RIVALT_GROUP_CHECK-rpc/$(date -u +%Y%m%dT%H%M%SZ)-$$}"
test ! -e "$RIVALT_RUN_DIR"
for component in clearing maker_a maker_b oracle_fixture; do test -f ".local/successor-p20/${component/clearing/clearing-cross-qualification}.so"; done
export RIVALT_PG_PORT="${RIVALT_PG_PORT:-15442}"
python3 ops/check-ports.py "$RIVALT_RPC_PORT" "$RIVALT_WS_PORT" "$RIVALT_PG_PORT"
mkdir -p "$RIVALT_RUN_DIR"
surfpool start --offline --no-deploy --no-tui --no-studio --disable-instruction-profiling \
  --port "$RIVALT_RPC_PORT" --ws-port "$RIVALT_WS_PORT" --slot-time 50 \
  --airdrop-keypair-path .local/keys/payer.json --log-path "$RIVALT_RUN_DIR/logs" \
  > "$RIVALT_RUN_DIR/surfpool.log" 2>&1 &
RIVALT_GROUP_SURFPOOL_PID=$!
trap 'if [[ -n ${RIVALT_PG_CONTAINER:-} ]]; then container stop "$RIVALT_PG_CONTAINER" >/dev/null 2>&1 || true; container delete "$RIVALT_PG_CONTAINER" >/dev/null 2>&1 || true; fi; kill "$RIVALT_GROUP_SURFPOOL_PID" 2>/dev/null || true; wait "$RIVALT_GROUP_SURFPOOL_PID" 2>/dev/null || true' EXIT
ready=0
for _ in {1..100}; do
  kill -0 "$RIVALT_GROUP_SURFPOOL_PID" 2>/dev/null || { echo 'Owned Surfpool exited before readiness' >&2; exit 1; }
  if curl -fsS --connect-timeout 1 --max-time 2 "$RIVALT_RPC_URL" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>/dev/null | grep -q '"ok"'; then ready=1; break; fi
  sleep 0.1
done
[[ "$ready" == 1 ]] || { echo 'Owned Surfpool not ready' >&2; exit 1; }
for component in clearing maker_a maker_b oracle_fixture; do
  key="${component//_/-}"
  solana-keygen new --silent --no-bip39-passphrase --outfile "$RIVALT_RUN_DIR/buffer-$key.json" >/dev/null
  solana program deploy ".local/successor-p20/${component/clearing/clearing-cross-qualification}.so" --buffer "$RIVALT_RUN_DIR/buffer-$key.json" \
    --program-id ".local/keys/$key.json" --keypair .local/keys/payer.json --url "$RIVALT_RPC_URL" \
    --use-rpc --max-sign-attempts 20 --output json > "$RIVALT_RUN_DIR/deployment-$key.json"
done
source ops/postgres.sh
node --import tsx "$RIVALT_GROUP_DRIVER"
printf 'P21A scoped group evidence: %s\n' "$RIVALT_RUN_DIR"
