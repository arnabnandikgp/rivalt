#!/usr/bin/env bash
# Local diagnostic alongside a pinned, separately deployed clearing program.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
test "${RIVALT_SETTLEMENT_PROBE:-}" = profit-attribution-linked-contested
test "$RIVALT_RPC_URL" = "http://127.0.0.1:$RIVALT_RPC_PORT"
: "${RIVALT_RUN_DIR:?}"
cargo build-sbf --manifest-path tests/programs/frozen-plan/Cargo.toml --tools-version v1.52 --arch v0 \
  --sbf-out-dir "$RIVALT_RUN_DIR" -- --locked --offline > "$RIVALT_RUN_DIR/proof-build.log" 2>&1
if rg 'Stack offset .* exceeded|max offset of 4096|overwrites values in the frame' "$RIVALT_RUN_DIR/proof-build.log"; then exit 1; fi
node --import tsx tests/rpc-contract/frozen-plan-rpc.ts write-key
solana-keygen new --silent --no-bip39-passphrase --outfile "$RIVALT_RUN_DIR/proof-buffer.json" >/dev/null
solana program deploy "$RIVALT_RUN_DIR/frozen_plan_probe.so" --buffer "$RIVALT_RUN_DIR/proof-buffer.json" \
  --program-id "$RIVALT_RUN_DIR/proof-key.json" --keypair .local/keys/payer.json --url "$RIVALT_RPC_URL" \
  --use-rpc --max-sign-attempts 20 --output json > "$RIVALT_RUN_DIR/proof-deployment.json"
solana program dump --url "$RIVALT_RPC_URL" 92GA4Cm7NZq8GEwY5r7zLwdLeYLuQYa79Ut9f3gAQ8U7 "$RIVALT_RUN_DIR/proof-fetched.so"
python3 - "$RIVALT_RUN_DIR" <<'PY'
from pathlib import Path
import sys
run = Path(sys.argv[1])
local = (run/'frozen_plan_probe.so').read_bytes()
fetched = (run/'proof-fetched.so').read_bytes()
assert fetched.startswith(local) and not any(fetched[len(local):])
PY
