#!/usr/bin/env bash
# One fresh G22 profile. Run baseline/control/treatment sequentially on this host.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
export RIVALT_CONTINUATION_PROFILE="${RIVALT_CONTINUATION_PROFILE:?baseline, control or treatment required}"
case "$RIVALT_CONTINUATION_PROFILE" in
  baseline) export RIVALT_ARTIFACT_DIR=.local/account-safety ;;
  control|treatment) export RIVALT_ARTIFACT_DIR=.local/liquidity-execution ;;
  *) echo 'Unknown comparison profile' >&2; exit 1 ;;
esac
# Retained binaries are explicit pinned build artifacts, never retained runtime
# state. Every deployment starts empty and proves actual hashes before use.
python3 - <<'PY'
import hashlib,json,os,pathlib
root=pathlib.Path(os.environ['RIVALT_ARTIFACT_DIR'])
manifest=json.loads((root/'build-manifest.json').read_text())
assert manifest['trackedDirty'] is False
for component in ['clearing','maker_a','maker_b','oracle_fixture']:
    name=component+'.so'
    assert hashlib.sha256((root/name).read_bytes()).hexdigest()==manifest['binaries'][name],name
PY
test "$(surfpool --version)" = 'surfpool 1.6.1'
export RIVALT_RPC_PORT="${RIVALT_RPC_PORT:-18941}"
export RIVALT_WS_PORT="${RIVALT_WS_PORT:-18942}"
export RIVALT_RPC_URL="http://127.0.0.1:$RIVALT_RPC_PORT"
export RIVALT_WS_URL="ws://127.0.0.1:$RIVALT_WS_PORT"
export RIVALT_RUN_DIR="${RIVALT_RUN_DIR:-.local/liquidity-execution/comparison/$(date -u +%Y%m%dT%H%M%SZ)-$RIVALT_CONTINUATION_PROFILE-$$}"
test ! -e "$RIVALT_RUN_DIR"
python3 ops/check-ports.py "$RIVALT_RPC_PORT" "$RIVALT_WS_PORT"
mkdir -p "$RIVALT_RUN_DIR"
surfpool start --offline --no-deploy --no-tui --no-studio --disable-instruction-profiling \
  --port "$RIVALT_RPC_PORT" --ws-port "$RIVALT_WS_PORT" --slot-time 50 \
  --airdrop-keypair-path .local/keys/payer.json --log-path "$RIVALT_RUN_DIR/logs" \
  > "$RIVALT_RUN_DIR/surfpool.log" 2>&1 &
RIVALT_COMPARISON_PID=$!
trap 'kill "$RIVALT_COMPARISON_PID" 2>/dev/null || true; wait "$RIVALT_COMPARISON_PID" 2>/dev/null || true' EXIT
ready=0
for _ in {1..100}; do
  kill -0 "$RIVALT_COMPARISON_PID" 2>/dev/null || exit 1
  if curl -fsS --connect-timeout 1 --max-time 2 "$RIVALT_RPC_URL" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>/dev/null | grep -q '"ok"'; then ready=1; break; fi
  sleep 0.1
done
test "$ready" == 1
for component in clearing maker_a maker_b oracle_fixture; do
  key_name="${component//_/-}"
  solana-keygen new --silent --no-bip39-passphrase --outfile "$RIVALT_RUN_DIR/$component-buffer.json" >/dev/null
  solana program deploy "$RIVALT_ARTIFACT_DIR/$component.so" --buffer "$RIVALT_RUN_DIR/$component-buffer.json" \
    --program-id ".local/keys/$key_name.json" --keypair .local/keys/payer.json --url "$RIVALT_RPC_URL" \
    --use-rpc --max-sign-attempts 20 --output json > "$RIVALT_RUN_DIR/$component-deployment.json"
done
node --import tsx "${RIVALT_CONTINUATION_ENTRY:-tests/rpc-contract/liquidity-continuation-rpc.ts}"
printf 'Scoped comparison evidence: %s\n' "$RIVALT_RUN_DIR"
