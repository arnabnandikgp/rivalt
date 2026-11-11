#!/usr/bin/env bash
# P55A2 intermediate storage probe; never promotes the candidate runtime.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
export RIVALT_MEMBERSHIP_ARTIFACT_DIR="${RIVALT_MEMBERSHIP_ARTIFACT_DIR:?explicit pinned candidate required}"
python3 - <<'PY'
from pathlib import Path
import hashlib,json,os
root=Path(os.environ['RIVALT_MEMBERSHIP_ARTIFACT_DIR'])
manifest=json.loads((root/'build-manifest.json').read_text())
assert manifest['revision']=='174b3b2a9659b873b6ac037f9050fee27d3ac31f'
assert manifest['trackedDirty'] is False and manifest['scratchSchema']==9
expected='189320a7a9ed4ebf419dd421f8b3aee639775827535f2afa25ac854092cde85f'
assert manifest['binaries']['clearing.so']==expected
assert hashlib.sha256((root/'clearing.so').read_bytes()).hexdigest()==expected
PY
test "$(surfpool --version)" = 'surfpool 1.7.0'
export RIVALT_RPC_PORT="${RIVALT_RPC_PORT:-18961}"
export RIVALT_WS_PORT="${RIVALT_WS_PORT:-18962}"
export RIVALT_RPC_URL="http://127.0.0.1:$RIVALT_RPC_PORT"
export RIVALT_WS_URL="ws://127.0.0.1:$RIVALT_WS_PORT"
export RIVALT_RUN_DIR="${RIVALT_RUN_DIR:-.local/scalable-settlement/runs/p55a2-storage-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
test ! -e "$RIVALT_RUN_DIR"
python3 ops/check-ports.py "$RIVALT_RPC_PORT" "$RIVALT_WS_PORT"
mkdir -p "$RIVALT_RUN_DIR"
if command -v caffeinate >/dev/null; then caffeinate -i -w $$ & fi
surfpool start --offline --no-deploy --no-tui --no-studio --disable-instruction-profiling \
  --port "$RIVALT_RPC_PORT" --ws-port "$RIVALT_WS_PORT" --slot-time 50 \
  --airdrop-keypair-path .local/keys/payer.json --log-path "$RIVALT_RUN_DIR/logs" \
  > "$RIVALT_RUN_DIR/surfpool.log" 2>&1 &
RIVALT_MEMBERSHIP_SURFPOOL_PID=$!
trap 'kill "$RIVALT_MEMBERSHIP_SURFPOOL_PID" 2>/dev/null || true; wait "$RIVALT_MEMBERSHIP_SURFPOOL_PID" 2>/dev/null || true' EXIT
ready=0
for _ in {1..100}; do
  kill -0 "$RIVALT_MEMBERSHIP_SURFPOOL_PID" 2>/dev/null || { echo 'Owned Surfpool exited' >&2; exit 1; }
  if curl -fsS --connect-timeout 1 --max-time 2 "$RIVALT_RPC_URL" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>/dev/null | rg -q '"ok"'; then ready=1; break; fi
  sleep 0.1
done
[[ "$ready" == 1 ]] || { echo 'Owned Surfpool not ready' >&2; exit 1; }
solana-keygen new --silent --no-bip39-passphrase --outfile "$RIVALT_RUN_DIR/clearing-buffer.json" >/dev/null
solana program deploy "$RIVALT_MEMBERSHIP_ARTIFACT_DIR/clearing.so" --buffer "$RIVALT_RUN_DIR/clearing-buffer.json" \
  --program-id .local/keys/clearing.json --keypair .local/keys/payer.json --url "$RIVALT_RPC_URL" \
  --use-rpc --max-sign-attempts 20 --output json > "$RIVALT_RUN_DIR/clearing-deployment.json"
node --import tsx tests/rpc-contract/account-membership-storage-rpc.ts
printf 'Membership storage probe: %s\n' "$RIVALT_RUN_DIR"
