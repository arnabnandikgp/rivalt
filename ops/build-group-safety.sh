#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
test "$(anchor --version)" = 'anchor-cli 1.2.1'
export CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0
node ops/local-keys.mjs
mkdir -p .local/successor-p18c target/deploy
cp .local/keys/clearing.json target/deploy/clearing-keypair.json
cp .local/keys/maker-a.json target/deploy/maker_a-keypair.json
cp .local/keys/maker-b.json target/deploy/maker_b-keypair.json
cp .local/keys/oracle-fixture.json target/deploy/oracle_fixture-keypair.json
checked_sbf() {
  "$@" 2>&1 | tee .local/successor-p18c/last-sbf.log
  if grep -Eq 'Stack offset .* exceeded|max offset of 4096|overwrites values in the frame' .local/successor-p18c/last-sbf.log; then
    echo 'Rejected unsafe SBF stack frame before continuing builds' >&2; return 1
  elif [[ $? != 1 ]]; then
    echo 'Could not validate SBF stack frames' >&2; return 1
  fi
}
{
  for component in clearing maker_a maker_b; do
    NO_DNA=1 checked_sbf anchor build -p "$component" --no-idl --tools-version v1.52 --arch v0 -- -- --locked
    cp "target/deploy/$component.so" ".local/successor-p18c/$component-default.so"
    NO_DNA=1 checked_sbf anchor build -p "$component" --no-idl --tools-version v1.52 --arch v0 -- -- --locked --features successor-test-profile
    cp "target/deploy/$component.so" ".local/successor-p18c/$component.so"
    NO_DNA=1 anchor idl build -p "$component" -o "packages/sdk/idl/$component.json" -- --locked
  done
  checked_sbf cargo build-sbf --manifest-path tests/fixtures/oracle/Cargo.toml --tools-version v1.52 --arch v0 -- --locked
  cp target/deploy/oracle_fixture.so .local/successor-p18c/oracle_fixture.so
} 2>&1 | tee .local/successor-p18c/build.log
if grep -Eq 'Stack offset .* exceeded|max offset of 4096|overwrites values in the frame' .local/successor-p18c/build.log; then
  echo 'Rejected unsafe SBF stack frame' >&2; exit 1
elif [[ $? != 1 ]]; then
  echo 'Could not validate SBF stack frames' >&2; exit 1
fi
pnpm generate
