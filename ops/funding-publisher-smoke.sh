#!/usr/bin/env bash
# D76 scoped publisher gate; reuses the owned local deployment lifecycle.
set -euo pipefail
export RIVALT_LIQUIDITY_PROBE=funding-publisher
exec bash "$(dirname "$0")/liquidity-sampling-smoke.sh"
