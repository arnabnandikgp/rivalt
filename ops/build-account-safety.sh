#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
test "$(anchor --version)" = 'anchor-cli 1.2.1'
export CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0
node ops/local-keys.mjs
mkdir -p .local/account-safety target/deploy
cp .local/keys/clearing.json target/deploy/clearing-keypair.json
cp .local/keys/maker-a.json target/deploy/maker_a-keypair.json
cp .local/keys/maker-b.json target/deploy/maker_b-keypair.json
cp .local/keys/oracle-fixture.json target/deploy/oracle_fixture-keypair.json
checked_sbf() {
  "$@" 2>&1 | tee .local/account-safety/last-sbf.log
  if grep -Eq 'Stack offset .* exceeded|max offset of 4096|overwrites values in the frame' .local/account-safety/last-sbf.log; then
    echo 'Rejected unsafe SBF stack frame before continuing builds' >&2; return 1
  elif [[ $? != 1 ]]; then
    echo 'Could not validate SBF stack frames' >&2; return 1
  fi
}
{
  for component in clearing maker_a maker_b; do
    qualification=account-trading-qualification
    if [[ "$component" == clearing ]]; then qualification=account-safety-qualification; fi
    NO_DNA=1 checked_sbf anchor build -p "$component" --no-idl --tools-version v1.52 --arch v0 -- -- --locked
    cp "target/deploy/$component.so" ".local/account-safety/$component-default.so"
    NO_DNA=1 checked_sbf anchor build -p "$component" --no-idl --tools-version v1.52 --arch v0 -- -- --locked --features "$qualification"
    cp "target/deploy/$component.so" ".local/account-safety/$component.so"
    NO_DNA=1 anchor idl build -p "$component" -o "packages/sdk/idl/$component.json" -- --locked
  done
  checked_sbf cargo build-sbf --manifest-path tests/fixtures/oracle/Cargo.toml --tools-version v1.52 --arch v0 -- --locked
  cp target/deploy/oracle_fixture.so .local/account-safety/oracle_fixture.so
} 2>&1 | tee .local/account-safety/build.log
if grep -Eq 'Stack offset .* exceeded|max offset of 4096|overwrites values in the frame' .local/account-safety/build.log; then
  echo 'Rejected unsafe SBF stack frame' >&2; exit 1
elif [[ $? != 1 ]]; then
  echo 'Could not validate SBF stack frames' >&2; exit 1
fi
pnpm generate
python3 - <<'PY'
import hashlib, json, pathlib, subprocess
directory = pathlib.Path('.local/account-safety')
manifest = {
    'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
    'trackedDirty': bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], text=True).strip()),
    'binaries': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(directory.glob('*.so'))},
}
(directory / 'build-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
PY
