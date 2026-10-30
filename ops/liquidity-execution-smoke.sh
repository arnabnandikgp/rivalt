#!/usr/bin/env bash
# Scoped P32 canonical routes/orders; not the full phase continuation gate.
set -euo pipefail
cd "$(dirname "$0")/.."
export RIVALT_LIQUIDITY_PROBE=execution
exec bash ops/current-runtime-smoke.sh
