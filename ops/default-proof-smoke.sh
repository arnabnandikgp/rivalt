#!/usr/bin/env bash
# Meter only the frozen-book research fixture, on a fresh local validator.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
test "$(surfpool --version)" = 'surfpool 1.7.0'
export RIVALT_RPC_PORT="${RIVALT_RPC_PORT:-19110}" RIVALT_WS_PORT="${RIVALT_WS_PORT:-19111}" RIVALT_PG_PORT="${RIVALT_PG_PORT:-15452}"
export RIVALT_RPC_URL="http://127.0.0.1:$RIVALT_RPC_PORT" RIVALT_WS_URL="ws://127.0.0.1:$RIVALT_WS_PORT"
export RIVALT_RUN_DIR="${RIVALT_RUN_DIR:-.local/default-proof/$(date -u +%Y%m%dT%H%M%SZ)-$$}"
test ! -e "$RIVALT_RUN_DIR"
python3 ops/check-ports.py "$RIVALT_RPC_PORT" "$RIVALT_WS_PORT" "$RIVALT_PG_PORT"
mkdir -p "$RIVALT_RUN_DIR"
git rev-parse HEAD > "$RIVALT_RUN_DIR/revision"
proof_features=()
if [[ "${RIVALT_PROOF_SCOPE:-selection}" == *three-market-default ]]; then
  proof_features+=(--features signed-three-market-default)
elif [[ "${RIVALT_PROOF_SCOPE:-selection}" == *indexed-default ]]; then
  proof_features+=(--features signed-indexed-default)
fi
cargo build-sbf --manifest-path tests/programs/default-proof/Cargo.toml --tools-version v1.52 --arch v0 ${proof_features[@]+"${proof_features[@]}"} \
  --sbf-out-dir "$RIVALT_RUN_DIR" -- --locked --offline > "$RIVALT_RUN_DIR/build.log" 2>&1
if rg 'Stack offset .* exceeded|max offset of 4096|overwrites values in the frame' "$RIVALT_RUN_DIR/build.log"; then exit 1; fi
node --import tsx tests/rpc-contract/default-proof-rpc.ts write-fixture-key
surfpool start --offline --no-deploy --no-tui --no-studio --disable-instruction-profiling \
  --port "$RIVALT_RPC_PORT" --ws-port "$RIVALT_WS_PORT" --slot-time 50 \
  --airdrop-keypair-path .local/keys/payer.json --log-path "$RIVALT_RUN_DIR/logs" > "$RIVALT_RUN_DIR/surfpool.log" 2>&1 &
validator=$!
trap 'if [[ -n "${RIVALT_PG_CONTAINER:-}" ]]; then container stop "$RIVALT_PG_CONTAINER" >/dev/null 2>&1 || true; fi; kill "$validator" 2>/dev/null || true; wait "$validator" 2>/dev/null || true' EXIT
for _ in {1..100}; do
  kill -0 "$validator"
  if curl -fsS --max-time 1 "$RIVALT_RPC_URL" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>/dev/null | rg -q '"ok"'; then break; fi
  sleep 0.1
done
solana-keygen new --silent --no-bip39-passphrase --outfile "$RIVALT_RUN_DIR/buffer.json" >/dev/null
solana program deploy "$RIVALT_RUN_DIR/default_proof_probe.so" --buffer "$RIVALT_RUN_DIR/buffer.json" \
  --program-id "$RIVALT_RUN_DIR/fixture.json" --keypair .local/keys/payer.json --url "$RIVALT_RPC_URL" \
  --use-rpc --max-sign-attempts 20 --output json > "$RIVALT_RUN_DIR/deployment.json"
solana program dump --url "$RIVALT_RPC_URL" sDPXvpEPwCzVKHdpxntiM1khVvtCj2V6ozCr5euajBi "$RIVALT_RUN_DIR/fetched.so"
python3 - "$RIVALT_RUN_DIR" <<'PY'
from pathlib import Path
import sys
root = Path(sys.argv[1])
built, fetched = ((root/name).read_bytes() for name in ('default_proof_probe.so', 'fetched.so'))
assert fetched.startswith(built) and not any(fetched[len(built):]), 'deployed fixture differs'
PY
source ops/postgres.sh
case "${RIVALT_PROOF_SCOPE:-selection}" in
  selection)
    cargo build --locked --offline -p financial-core --bin scalable-settlement-driver
    node --import tsx tests/rpc-contract/default-proof-rpc.ts start
    node --import tsx tests/rpc-contract/default-proof-rpc.ts resume ;;
  mirror)
    cargo build --locked --offline -p financial-core --bin scalable-settlement-driver
    node --import tsx tests/rpc-contract/mirror-order-rpc.ts ;;
  indexed-default|insured-indexed-default|residual-indexed-default|competing-indexed-default|partial-indexed-default|joint-competing-indexed-default) node --import tsx tests/rpc-contract/indexed-default-rpc.ts ;;
  coverage) node --import tsx tests/rpc-contract/payout-coverage-rpc.ts ;;
  three-market-default|competing-three-market-default) node --import tsx tests/rpc-contract/three-market-default-rpc.ts ;;
  slot-orders|slot-liquidation) node --import tsx tests/rpc-contract/slot-orders-rpc.ts ;;
  slot-custody) node --import tsx tests/rpc-contract/slot-custody-rpc.ts ;;
  withdrawal-width) node --import tsx tests/rpc-contract/withdrawal-width-rpc.ts ;;
  attribution) node --import tsx tests/rpc-contract/attribution-storage-rpc.ts ;;
  *) echo 'Unknown local proof scope' >&2; exit 1 ;;
esac
echo "Proof measurements retained in $RIVALT_RUN_DIR"
