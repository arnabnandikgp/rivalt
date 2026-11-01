#!/usr/bin/env bash
# Current local artifacts and separately gated default binaries.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
export PATH="$PWD/.tools/anchor-v2-rc2/bin:$PATH"
test "$(anchor --version)" = 'anchor-cli 2.0.0-rc.2'
export CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0
node ops/local-keys.mjs
export RIVALT_LIQUIDITY_ARTIFACTS="${RIVALT_LIQUIDITY_ARTIFACTS:-.local/anchor-rc2/current}"
python3 - <<'PY'
from pathlib import Path
import os
candidate = Path(os.environ['RIVALT_LIQUIDITY_ARTIFACTS']).resolve()
frozen = Path('.local/liquidity-execution').resolve()
assert candidate != frozen and frozen not in candidate.parents, 'RC2 cannot overwrite frozen P44 artifacts'
PY
mkdir -p "$RIVALT_LIQUIDITY_ARTIFACTS" target/deploy
RIVALT_LIQUIDITY_BUILD_LOG="$RIVALT_LIQUIDITY_ARTIFACTS/build-$(date -u +%Y%m%dT%H%M%SZ)-$$.log"
checked_sbf() {
  python3 - <<'PY'
import shutil
assert shutil.disk_usage('.').free >= 1024**3, 'Current build requires at least 1 GiB free; no existing files were deleted'
PY
  "$@" 2>&1 | tee "$RIVALT_LIQUIDITY_ARTIFACTS/last-sbf.log"
  if rg -q 'Stack offset .* exceeded|max offset of 4096|overwrites values in the frame' "$RIVALT_LIQUIDITY_ARTIFACTS/last-sbf.log"; then
    echo 'Rejected unsafe SBF stack frame' >&2; return 1
  elif [[ $? != 1 ]]; then
    echo 'Could not validate SBF stack frames' >&2; return 1
  fi
}
{
  for component in clearing maker_a maker_b; do
    key_name="${component//_/-}"
    cp ".local/keys/$key_name.json" "target/deploy/$component-keypair.json"
    qualification=maker-liquidity-qualification
    if [[ "$component" == clearing ]]; then qualification=liquidity-execution-qualification; fi
    NO_DNA=1 checked_sbf anchor build -p "$component" --no-idl -- --arch v0 -- --locked
    cp "target/deploy/$component.so" "$RIVALT_LIQUIDITY_ARTIFACTS/$component-default.so"
    NO_DNA=1 checked_sbf anchor build -p "$component" --no-idl -- --arch v0 -- --locked --features "$qualification"
    cp "target/deploy/$component.so" "$RIVALT_LIQUIDITY_ARTIFACTS/$component.so"
  done
  cp .local/keys/oracle-fixture.json target/deploy/oracle_fixture-keypair.json
  checked_sbf cargo build-sbf --manifest-path tests/fixtures/oracle/Cargo.toml --tools-version v1.52 --arch v0 -- --locked
  cp target/deploy/oracle_fixture.so "$RIVALT_LIQUIDITY_ARTIFACTS/oracle_fixture.so"
  checked_sbf cargo build-sbf --manifest-path tests/fixtures/hostile-maker/Cargo.toml --tools-version v1.52 --arch v0 -- --locked
  cp target/deploy/hostile_maker.so "$RIVALT_LIQUIDITY_ARTIFACTS/hostile_maker.so"
} 2>&1 | tee "$RIVALT_LIQUIDITY_BUILD_LOG"
python3 - <<'PY'
import hashlib, json, os, subprocess
from pathlib import Path
directory = Path(os.environ['RIVALT_LIQUIDITY_ARTIFACTS'])
manifest = {
    'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
    'trackedDirty': bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], text=True).strip()),
    'profile': 'liquidity-execution-qualification',
    'framework': 'anchor-2.0.0-rc.2',
    'accountSchema': 8,
    'makerAccountSchema': 5,
    'binaries': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(directory.glob('*.so'))},
}
(directory / 'build-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
PY
