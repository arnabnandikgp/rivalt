#!/usr/bin/env bash
# Build the ordinary gated artifacts and a separately named internal candidate.
# No runtime/deployment is started by this script.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
export RIVALT_GROUP_ARTIFACT_DIR=.local/successor-p20
export CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0
bash ops/build-group-safety.sh
trap 'cp "$RIVALT_GROUP_ARTIFACT_DIR/clearing.so" target/deploy/clearing.so' EXIT
NO_DNA=1 anchor build -p clearing --no-idl --tools-version v1.52 --arch v0 -- -- --locked \
  --features cross-safety-qualification 2>&1 | tee "$RIVALT_GROUP_ARTIFACT_DIR/build-cross-qualification.log"
if grep -Eq 'Stack offset .* exceeded|max offset of 4096|overwrites values in the frame' "$RIVALT_GROUP_ARTIFACT_DIR/build-cross-qualification.log"; then
  echo 'Rejected unsafe candidate SBF stack frame' >&2; exit 1
elif [[ $? != 1 ]]; then
  echo 'Could not validate candidate SBF stack frames' >&2; exit 1
fi
cp target/deploy/clearing.so "$RIVALT_GROUP_ARTIFACT_DIR/clearing-cross-qualification.so"
# Generic launchers must never accidentally deploy the unqualified candidate.
