#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
# Broad integration is explicit; ordinary PRs use their affected checks.
exec python3 tests/e2e/run.py "$@"
