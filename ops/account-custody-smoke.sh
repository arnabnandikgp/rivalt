#!/usr/bin/env bash
# Current custody transitions and independent conservation checks.
set -euo pipefail
cd "$(dirname "$0")/.."
export RIVALT_LIQUIDITY_PROBE=custody
exec bash ops/current-runtime-smoke.sh
