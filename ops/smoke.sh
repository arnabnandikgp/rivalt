#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
# An absolute store keeps npm lifecycle-inherited config from resolving differently
# inside the independent legacy root. CI permits noninteractive node_modules repair.
CI=true pnpm install --frozen-lockfile --store-dir "$PWD/.local/pnpm-store"
CI=true pnpm --dir tests/anchor-conformance install --frozen-lockfile --store-dir "$PWD/.local/pnpm-store"
mkdir -p .local
for program in clearing maker_a maker_b; do
  cp "packages/sdk/idl/$program.json" ".local/expected-$program-idl.json"
done
bash ops/build.sh
for program in clearing maker_a maker_b; do
  cmp "packages/sdk/idl/$program.json" ".local/expected-$program-idl.json"
done
pnpm generate:check
# build.sh regenerates the SDK; determinism alone cannot detect stale commits.
git diff --exit-code HEAD -- packages/sdk/src/generated packages/sdk/src/generatedMakerA packages/sdk/src/generatedMakerB packages/sdk/idl
test -z "$(git status --porcelain -- packages/sdk/src/generated packages/sdk/src/generatedMakerA packages/sdk/src/generatedMakerB packages/sdk/idl)"
pnpm typecheck
pnpm test
pnpm test:financial
pnpm test:svm
pnpm test:makers
node ops/check-dependencies.mjs
test "$(surfpool --version)" = "surfpool 1.6.1"
export RIVALT_RPC_PORT="${RIVALT_RPC_PORT:-18899}"
export RIVALT_WS_PORT="${RIVALT_WS_PORT:-18900}"
export RIVALT_RPC_URL="http://127.0.0.1:$RIVALT_RPC_PORT"
export RIVALT_WS_URL="ws://127.0.0.1:$RIVALT_WS_PORT"
export RIVALT_RUN_DIR=".local/runs/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$RIVALT_RUN_DIR"
cp .local/p02-financial.json "$RIVALT_RUN_DIR/financial.json"
cp .local/p02-svm.json "$RIVALT_RUN_DIR/svm.json"
cp .local/p03-svm.json "$RIVALT_RUN_DIR/maker-svm.json"
# Refuse occupied ports rather than connecting to or stopping someone else's runtime.
python3 - "$RIVALT_RPC_PORT" "$RIVALT_WS_PORT" <<'PY'
import socket, sys
for port in sys.argv[1:]:
    with socket.socket() as s:
        s.bind(("127.0.0.1", int(port)))
PY
surfpool start --offline --no-deploy --no-tui --no-studio \
  --port "$RIVALT_RPC_PORT" --ws-port "$RIVALT_WS_PORT" --slot-time "${RIVALT_SLOT_TIME:-100}" \
  --airdrop-keypair-path .local/keys/payer.json \
  --log-path "$RIVALT_RUN_DIR/logs" > "$RIVALT_RUN_DIR/surfpool.log" 2>&1 &
RIVALT_SURFPOOL_PID=$!
trap 'kill "$RIVALT_SURFPOOL_PID" 2>/dev/null || true; wait "$RIVALT_SURFPOOL_PID" 2>/dev/null || true' EXIT
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
solana program deploy target/deploy/clearing.so --program-id .local/keys/clearing.json \
  --keypair .local/keys/payer.json --url "$RIVALT_RPC_URL" --use-rpc --output json \
  > "$RIVALT_RUN_DIR/deployment.json"
for maker in a b; do
  solana program deploy "target/deploy/maker_$maker.so" --program-id ".local/keys/maker-$maker.json" \
    --keypair .local/keys/payer.json --url "$RIVALT_RPC_URL" --use-rpc --output json \
    > "$RIVALT_RUN_DIR/deployment-maker-$maker.json"
done
node --import tsx tests/rpc-contract/smoke.ts
node --import tsx tests/rpc-contract/custody-rpc.ts
node --import tsx tests/rpc-contract/maker-rpc.ts
node ops/record-toolchain.mjs > "$RIVALT_RUN_DIR/toolchain.json"
printf 'Evidence: %s\n' "$RIVALT_RUN_DIR"
