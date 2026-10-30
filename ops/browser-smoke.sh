#!/usr/bin/env bash
# The services fixture includes current-wallet browser signing and recovery checks.
set -euo pipefail
cd "$(dirname "$0")/.."
exec bash ops/liquidity-services-smoke.sh
