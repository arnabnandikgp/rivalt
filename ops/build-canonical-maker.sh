#!/usr/bin/env bash
# P30 quote/control artifacts only; no financial activation or database launch.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
test "$(anchor --version)" = 'anchor-cli 1.2.1'
export CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0
node ops/local-keys.mjs
mkdir -p .local/canonical-maker target/deploy
cp .local/keys/clearing.json target/deploy/clearing-keypair.json
cp .local/keys/maker-a.json target/deploy/maker_a-keypair.json
cp .local/keys/maker-b.json target/deploy/maker_b-keypair.json
checked_sbf() {
  python3 - <<'PY'
import shutil
assert shutil.disk_usage('.').free >= 1024**3, 'P30 build requires at least 1 GiB free; no existing files were deleted'
PY
  "$@" 2>&1 | tee .local/canonical-maker/last-sbf.log
  if rg -q 'Stack offset .* exceeded|max offset of 4096|overwrites values in the frame' .local/canonical-maker/last-sbf.log; then
    echo 'Rejected unsafe SBF stack frame' >&2
    return 1
  elif [[ $? != 1 ]]; then
    echo 'Could not validate SBF stack frames' >&2
    return 1
  fi
}
{
  for component in clearing maker_a maker_b; do
    NO_DNA=1 checked_sbf anchor build -p "$component" --no-idl --tools-version v1.52 --arch v0 -- -- --locked
    cp "target/deploy/$component.so" ".local/canonical-maker/$component-default.so"
    NO_DNA=1 checked_sbf anchor build -p "$component" --no-idl --tools-version v1.52 --arch v0 -- -- --locked --features maker-liquidity-qualification
    cp "target/deploy/$component.so" ".local/canonical-maker/$component.so"
    NO_DNA=1 anchor idl build -p "$component" -o "packages/sdk/idl/$component.json" -- --locked
  done
} 2>&1 | tee .local/canonical-maker/build.log
pnpm generate
python3 - <<'PY'
import hashlib
import json
from pathlib import Path
import subprocess
directory = Path('.local/canonical-maker')
manifest = {
    'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
    'trackedDirty': bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], text=True).strip()),
    'binaries': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(directory.glob('*.so'))},
}
(directory / 'build-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
PY
