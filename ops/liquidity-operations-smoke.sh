#!/usr/bin/env bash
# Current paged default, recovery, exit and fresh PostgreSQL replay qualification.
# Historical schema-8 all-account drain evidence remains at its pinned revision.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
export RIVALT_ARTIFACT_DIR="${RIVALT_ARTIFACT_DIR:-.local/anchor-rc2/current}"
export RIVALT_SETTLEMENT_ARTIFACT_DIR="$RIVALT_ARTIFACT_DIR"
export RIVALT_SETTLEMENT_PROBE=default-worker
export RIVALT_DEFAULT_POPULATION="${RIVALT_DEFAULT_POPULATION:-128}"
export RIVALT_PG_PORT="${RIVALT_PG_PORT:-15448}"
exec bash ops/scalable-settlement-smoke.sh
