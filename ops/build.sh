#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
test "$(node --version)" = "v24.22.0"
test "$(pnpm --version)" = "10.23.0"
test "$(anchor --version)" = "anchor-cli 1.2.1"
[[ "$(solana --version)" == "solana-cli 4.1.2 "* ]]
[[ "$(rustc --version)" == "rustc 1.97.1 "* ]]
export CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0
node ops/local-keys.mjs
mkdir -p target/deploy
cp .local/keys/clearing.json target/deploy/clearing-keypair.json
cp .local/keys/maker-a.json target/deploy/maker_a-keypair.json
cp .local/keys/maker-b.json target/deploy/maker_b-keypair.json
mkdir -p .local
{
  NO_DNA=1 anchor build -p clearing --no-idl --tools-version v1.52 --arch v0 -- -- --locked
  cp target/deploy/clearing.so .local/clearing-no-routes.so
  NO_DNA=1 anchor build -p clearing --no-idl --tools-version v1.52 --arch v0 -- -- --locked --features local-test-profile
  for program in maker_a maker_b; do
    NO_DNA=1 anchor build -p "$program" --no-idl --tools-version v1.52 --arch v0 -- -- --locked
  done
  cargo build-sbf --manifest-path tests/fixtures/hostile-maker/Cargo.toml --tools-version v1.52 --arch v0 -- --locked
} 2>&1 | tee .local/sbf-build.log
# LLVM can print these diagnostics yet return success. Never accept such an artifact.
if grep -Eq 'Stack offset .* exceeded|max offset of 4096|overwrites values in the frame' .local/sbf-build.log; then
  echo 'Rejected unsafe SBF stack frame; see .local/sbf-build.log' >&2
  exit 1
elif [[ $? != 1 ]]; then
  echo 'Could not validate SBF stack frames; see .local/sbf-build.log' >&2
  exit 1
fi
mkdir -p packages/sdk/idl
for program in clearing maker_a maker_b; do
  anchor idl build -p "$program" -o "packages/sdk/idl/$program.json" -- --locked
done
pnpm generate
