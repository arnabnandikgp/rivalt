#!/usr/bin/env bash
# Focused pre-redesign resources/access sets, not a throughput or financial qualification.
set -euo pipefail
cd "$(dirname "$0")/.."
export RIVALT_LIQUIDITY_PROBE=performance
exec bash ops/current-runtime-smoke.sh
