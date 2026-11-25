#!/usr/bin/env bash
# Independent 12-wallet replay on Agave's native leader and scheduler.
set -euo pipefail
source ops/env.sh
: "${RIVALT_AGAVE_VALIDATOR:?path to the 4.2.2 test validator}"
: "${RIVALT_SETTLEMENT_ARTIFACT_DIR:?wide-atomic-routes build directory}"
: "${RIVALT_RUN_DIR:?fresh local evidence directory}"
case "${RIVALT_CONTENTION_MARKETS:-}" in btc|eth|split) ;; *) exit 2 ;; esac
export RIVALT_CONTENTION_RUNTIME=agave RIVALT_SETTLEMENT_PROBE=execution-router-wallet-contention
export RIVALT_ROUTER_REVISION=b0e1a43f22699bb67335011ef7acfb2edf48b0d2
export RIVALT_PG_PORT="${RIVALT_PG_PORT:-19871}"
export RIVALT_RPC_URL=http://127.0.0.1:19861 RIVALT_WS_URL=ws://127.0.0.1:19862
export RIVALT_AGAVE_QUEUE_TRACE="$PWD/$RIVALT_RUN_DIR/scheduler.trace"
[[ "$RIVALT_RUN_DIR" == .local/* && ! -e "$RIVALT_RUN_DIR" ]]
mkdir -p "$RIVALT_RUN_DIR"
"$RIVALT_AGAVE_VALIDATOR" --version > "$RIVALT_RUN_DIR/validator-version.txt"
rg -q '^solana-test-validator 4\.2\.2 \(src:c9c6f328;' "$RIVALT_RUN_DIR/validator-version.txt"
shasum -a 256 "$RIVALT_AGAVE_VALIDATOR" > "$RIVALT_RUN_DIR/validator-sha256.txt"
node --import tsx ops/verify-liquidity-artifacts.ts .local/anchor-rc2/current
node --import tsx --input-type=module -e 'import {routerBuild} from "./tests/rpc-contract/execution-router-build.ts";routerBuild();'
python3 ops/check-ports.py 19861 19862 19865 19868 "$RIVALT_PG_PORT"
programs=()
for component in clearing maker_a maker_b oracle_fixture; do
  directory="$RIVALT_SETTLEMENT_ARTIFACT_DIR"
  if [[ "$component" == oracle_fixture ]]; then directory=.local/anchor-rc2/current; fi
  programs+=(--upgradeable-program ".local/keys/${component//_/-}.json" "$directory/$component.so" .local/keys/payer.json)
done
"$RIVALT_AGAVE_VALIDATOR" --ledger "$RIVALT_RUN_DIR/ledger" --bind-address 127.0.0.1 \
  --rpc-port 19861 --gossip-port 19868 --faucet-port 19865 --dynamic-port-range 19900-19940 \
  --mint "$(solana-keygen pubkey .local/keys/payer.json)" "${programs[@]}" \
  --limit-ledger-size 20000 --log-messages-bytes-limit 131072 --quiet > "$RIVALT_RUN_DIR/startup.log" 2>&1 &
validator_pid=$!
cleanup() {
  kill "$validator_pid" 2>/dev/null || true
  wait "$validator_pid" 2>/dev/null || true
  if [[ -n "${RIVALT_PG_CONTAINER:-}" ]]; then container stop "$RIVALT_PG_CONTAINER" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
for _ in {1..100}; do
  kill -0 "$validator_pid"
  if curl -fsS --max-time 1 "$RIVALT_RPC_URL" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>/dev/null | rg -q '"ok"'; then break; fi
  sleep 0.25
done
rg -q 'block-production-method: central-scheduler-greedy' "$RIVALT_RUN_DIR/ledger/validator.log"
source ops/postgres.sh
node --import tsx tests/rpc-contract/wallet-contention-rpc.ts > "$RIVALT_RUN_DIR/workload.log" 2>&1
