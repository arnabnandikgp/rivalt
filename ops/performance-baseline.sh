#!/usr/bin/env bash
# Focused current resources/access sets; select p43-before, p43-after or p43-trace.
# Historical P39 reproduction uses its pinned revision, never overwrites its fixture.
set -euo pipefail
cd "$(dirname "$0")/.."
export RIVALT_LIQUIDITY_PROBE=performance
exec bash ops/current-runtime-smoke.sh
