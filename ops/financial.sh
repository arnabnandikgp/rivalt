#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
export CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0
cargo test --locked -p financial-core
cargo build --locked -p financial-core --bin reference-driver
python3 tests/financial/reference.py | tee .local/p02-financial.json
