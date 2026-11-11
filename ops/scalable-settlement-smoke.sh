#!/usr/bin/env bash
# Dedicated P54 verifier probe. This does not admit a candidate to normal runtime.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
export RIVALT_SETTLEMENT_ARTIFACT_DIR="${RIVALT_SETTLEMENT_ARTIFACT_DIR:?explicit pinned candidate required}"
export RIVALT_ARTIFACT_DIR="${RIVALT_ARTIFACT_DIR:-.local/anchor-rc2/current}"
node --import tsx ops/verify-liquidity-artifacts.ts "$RIVALT_ARTIFACT_DIR"
python3 - <<'PY'
from pathlib import Path
import hashlib,json,os
folder=Path(os.environ['RIVALT_SETTLEMENT_ARTIFACT_DIR'])
manifest=json.loads((folder/'build-manifest.json').read_text())
assert manifest['revision']=='60f7ec8e140dc75873f30fcdf7ce41c58dc65e09'
assert manifest['trackedDirty'] is False and manifest['scratchSchema']==9
expected='c3ebb47d243888bdb38d750309401cf85447b1bf76e6cea38108135198892f27'
assert manifest['binaries']['clearing.so']==expected
assert hashlib.sha256((folder/'clearing.so').read_bytes()).hexdigest()==expected
PY
test "$(surfpool --version)" = 'surfpool 1.7.0'
export RIVALT_RPC_PORT="${RIVALT_RPC_PORT:-18951}"
export RIVALT_WS_PORT="${RIVALT_WS_PORT:-18952}"
export RIVALT_RPC_URL="http://127.0.0.1:$RIVALT_RPC_PORT"
export RIVALT_WS_URL="ws://127.0.0.1:$RIVALT_WS_PORT"
export RIVALT_RUN_DIR="${RIVALT_RUN_DIR:-.local/scalable-settlement/runs/$(date -u +%Y%m%dT%H%M%SZ)-$$}"
test ! -e "$RIVALT_RUN_DIR"
python3 ops/check-ports.py "$RIVALT_RPC_PORT" "$RIVALT_WS_PORT"
mkdir -p "$RIVALT_RUN_DIR"
if command -v caffeinate >/dev/null; then caffeinate -i -w $$ & fi
surfpool start --offline --no-deploy --no-tui --no-studio --disable-instruction-profiling \
  --port "$RIVALT_RPC_PORT" --ws-port "$RIVALT_WS_PORT" --slot-time 50 \
  --airdrop-keypair-path .local/keys/payer.json --log-path "$RIVALT_RUN_DIR/logs" \
  > "$RIVALT_RUN_DIR/surfpool.log" 2>&1 &
RIVALT_SETTLEMENT_SURFPOOL_PID=$!
trap 'kill "$RIVALT_SETTLEMENT_SURFPOOL_PID" 2>/dev/null || true; wait "$RIVALT_SETTLEMENT_SURFPOOL_PID" 2>/dev/null || true' EXIT
ready=0
for _ in {1..100}; do
  kill -0 "$RIVALT_SETTLEMENT_SURFPOOL_PID" 2>/dev/null || { echo 'Owned Surfpool exited' >&2; exit 1; }
  if curl -fsS --connect-timeout 1 --max-time 2 "$RIVALT_RPC_URL" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>/dev/null | rg -q '"ok"'; then ready=1; break; fi
  sleep 0.1
done
[[ "$ready" == 1 ]] || { echo 'Owned Surfpool not ready' >&2; exit 1; }
for component in clearing maker_a maker_b oracle_fixture; do
  key_name="${component//_/-}"
  artifact="$RIVALT_ARTIFACT_DIR/$component.so"
  if [[ "$component" == clearing ]]; then artifact="$RIVALT_SETTLEMENT_ARTIFACT_DIR/clearing.so"; fi
  solana-keygen new --silent --no-bip39-passphrase --outfile "$RIVALT_RUN_DIR/$component-buffer.json" >/dev/null
  solana program deploy "$artifact" --buffer "$RIVALT_RUN_DIR/$component-buffer.json" \
    --program-id ".local/keys/$key_name.json" --keypair .local/keys/payer.json --url "$RIVALT_RPC_URL" \
    --use-rpc --max-sign-attempts 20 --output json > "$RIVALT_RUN_DIR/$component-deployment.json"
done
node --import tsx tests/rpc-contract/scalable-settlement-rpc.ts
printf 'Frozen verifier probe: %s\n' "$RIVALT_RUN_DIR"
