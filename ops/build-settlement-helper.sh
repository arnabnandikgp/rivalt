#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
# Build from the same immutable workspace as the admitted program, including its
# Cargo.lock. This also works when the operator checkout contains later changes.
helper_revision="$(node --import tsx --input-type=module -e 'import {SETTLEMENT_HELPER_REVISION} from "./packages/sdk/src/account-deployment.ts";process.stdout.write(SETTLEMENT_HELPER_REVISION)')"
helper_source="$(mktemp -d)"
trap 'rm -rf "$helper_source"' EXIT
git archive "$helper_revision" Cargo.toml Cargo.lock rust-toolchain.toml programs crates tests/fixtures | tar -x -C "$helper_source"
build_target="$PWD/target"
(cd "$helper_source" && cargo build --locked --release --target-dir "$build_target" -p rivalt-settlement-pages)
export RIVALT_SETTLEMENT_HELPER_DIR="${RIVALT_SETTLEMENT_HELPER_DIR:-.local/settlement-helper}"
mkdir -p "$RIVALT_SETTLEMENT_HELPER_DIR"
cp target/release/rivalt-settlement-pages "$RIVALT_SETTLEMENT_HELPER_DIR/rivalt-settlement-pages"
python3 - "$helper_revision" <<'PY'
import hashlib,json,pathlib,sys,os
root=pathlib.Path(os.environ['RIVALT_SETTLEMENT_HELPER_DIR'])
binary=root/'rivalt-settlement-pages'
manifest={'version':2,'accountSchema':10,'programProfile':6,
 'revision':sys.argv[1],
 'trackedDirty':False,
 'binary':'rivalt-settlement-pages','bytes':binary.stat().st_size,'sha256':hashlib.sha256(binary.read_bytes()).hexdigest()}
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest))
PY
