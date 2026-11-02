#!/usr/bin/env bash
# Isolated candidate CLI. Does not replace .tools/bin/anchor or global installs.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
export CARGO_TARGET_DIR="$PWD/.local/anchor-v2-build/cli"
export CARGO_INCREMENTAL=0 CARGO_PROFILE_RELEASE_DEBUG=0 CARGO_PROFILE_RELEASE_STRIP=debuginfo
cargo install anchor-cli --version 2.0.0-rc.2 --locked --root "$PWD/.tools/anchor-v2-rc2"
test "$(.tools/anchor-v2-rc2/bin/anchor --version)" = 'anchor-cli 2.0.0-rc.2'
