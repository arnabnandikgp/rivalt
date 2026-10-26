#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
test "$(anchor --version)" = 'anchor-cli 1.2.1'
export CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0
node ops/local-keys.mjs
mkdir -p .local/successor target/deploy
cp .local/keys/clearing.json target/deploy/clearing-keypair.json
{
  NO_DNA=1 anchor build -p clearing --no-idl --tools-version v1.52 --arch v0 -- -- --locked
  cp target/deploy/clearing.so .local/successor/clearing-default.so
  NO_DNA=1 anchor build -p clearing --no-idl --tools-version v1.52 --arch v0 -- -- --locked --features successor-test-profile
  cp target/deploy/clearing.so .local/successor/clearing.so
  NO_DNA=1 anchor idl build -p clearing -o packages/sdk/idl/clearing.json -- --locked
} 2>&1 | tee .local/successor/build.log
if grep -Eq 'Stack offset .* exceeded|max offset of 4096|overwrites values in the frame' .local/successor/build.log; then
  echo 'Rejected unsafe SBF stack frame' >&2; exit 1
elif [[ $? != 1 ]]; then
  echo 'Could not validate SBF stack frames' >&2; exit 1
fi
pnpm generate
