#!/usr/bin/env bash
# Fresh P33 finalized accounting reconstruction, RPC/WS and PostgreSQL.
set -euo pipefail
cd "$(dirname "$0")/.."
export RIVALT_LIQUIDITY_PROBE=indexer RIVALT_LIQUIDITY_POSTGRES=1
export RIVALT_PG_PORT="${RIVALT_PG_PORT:-15447}"
exec bash ops/current-runtime-smoke.sh
