#!/usr/bin/env bash
# Build only the four artifacts required by the internal operator qualification.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
test "$(node --version)" = 'v24.22.0'
test "$(pnpm --version)" = '10.23.0'
test "$(anchor --version)" = 'anchor-cli 1.2.1'
[[ "$(solana --version)" == 'solana-cli 4.1.2 '* ]]
[[ "$(rustc --version)" == 'rustc 1.97.1 '* ]]
pnpm install --frozen-lockfile
node ops/local-keys.mjs
mkdir -p target/deploy
cp .local/keys/clearing.json target/deploy/clearing-keypair.json
cp .local/keys/maker-a.json target/deploy/maker_a-keypair.json
cp .local/keys/maker-b.json target/deploy/maker_b-keypair.json
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0
{
  NO_DNA=1 anchor build -p clearing --no-idl --tools-version v1.52 --arch v0 -- -- --locked --features local-test-profile
  for program in maker_a maker_b; do
    NO_DNA=1 anchor build -p "$program" --no-idl --tools-version v1.52 --arch v0 -- -- --locked
  done
  cargo build-sbf --manifest-path tests/fixtures/oracle/Cargo.toml --tools-version v1.52 --arch v0 -- --locked
} 2>&1 | tee .local/maker-kit-build.log
if grep -Eq 'Stack offset .* exceeded|max offset of 4096|overwrites values in the frame' .local/maker-kit-build.log; then
  echo 'Rejected unsafe SBF stack frame' >&2; exit 1
elif [[ $? != 1 ]]; then
  echo 'Could not validate SBF stack frames' >&2; exit 1
fi
