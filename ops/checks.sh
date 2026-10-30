#!/usr/bin/env bash
# Explicit broad current-client/reference check; scoped PR checks stay separate.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
pnpm generate:check
python3 ops/wire_contract.py
pnpm typecheck
pnpm test
pnpm build:trader
bash ops/financial.sh
node ops/check-dependencies.mjs
