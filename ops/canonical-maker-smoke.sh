#!/usr/bin/env bash
# Current maker control/quote or adapter acceptance against the same runtime.
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-}" in
  '') export RIVALT_LIQUIDITY_PROBE=makers ;;
  --adapters) export RIVALT_LIQUIDITY_PROBE=adapters ;;
  *) echo 'Usage: canonical-maker-smoke.sh [--adapters]' >&2; exit 2 ;;
esac
exec bash ops/current-runtime-smoke.sh
