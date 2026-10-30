#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export RIVALT_LIQUIDITY_PROBE=safety
exec bash ops/current-runtime-smoke.sh
