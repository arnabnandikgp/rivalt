#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
umask 077
exec node --import tsx packages/local-demo/src/cli.ts "$@"
