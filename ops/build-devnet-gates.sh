#!/usr/bin/env bash
# Compile negative-gate binaries only; never deploy or enable financial paths.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
export PATH="$PWD/.tools/anchor-v2-rc2/bin:$PATH"
test "$(anchor --version)" = 'anchor-cli 2.0.0-rc.2'
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0
export RIVALT_DEVNET_GATE_ARTIFACTS="${RIVALT_DEVNET_GATE_ARTIFACTS:-.local/anchor-rc2/devnet-gates}"
test ! -e "$RIVALT_DEVNET_GATE_ARTIFACTS"
test -z "$(git status --porcelain --untracked-files=no)"
mkdir -p "$RIVALT_DEVNET_GATE_ARTIFACTS"
for component in clearing maker_a maker_b; do
  NO_DNA=1 anchor build -p "$component" --no-idl -- --arch v0 -- --locked --features devnet-test-profile \
    > "$RIVALT_DEVNET_GATE_ARTIFACTS/$component-build.log" 2>&1
  if rg -q 'Stack offset .* exceeded|max offset of 4096|overwrites values in the frame' "$RIVALT_DEVNET_GATE_ARTIFACTS/$component-build.log"; then
    echo 'Rejected unsafe SBF stack frame' >&2; exit 1
  elif [[ $? != 1 ]]; then exit 1; fi
  cp "target/deploy/$component.so" "$RIVALT_DEVNET_GATE_ARTIFACTS/$component.so"
  qualification=maker-liquidity-qualification
  if [[ "$component" == clearing ]]; then qualification=liquidity-execution-qualification; fi
  if NO_DNA=1 anchor build -p "$component" --no-idl -- --arch v0 -- --locked --features "devnet-test-profile,$qualification" \
    > "$RIVALT_DEVNET_GATE_ARTIFACTS/$component-mixed-rejected.log" 2>&1; then
    echo 'Mixed local/devnet profiles unexpectedly compiled' >&2; exit 1
  fi
  rg -q 'local and devnet financial profiles are mutually exclusive|Local maker qualification cannot be combined with the devnet profile' \
    "$RIVALT_DEVNET_GATE_ARTIFACTS/$component-mixed-rejected.log"
done
python3 - <<'PYTHON'
from pathlib import Path
import hashlib,json,os,subprocess
root=Path(os.environ['RIVALT_DEVNET_GATE_ARTIFACTS'])
assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],text=True).strip()
(root/'build-manifest.json').write_text(json.dumps(dict(revision=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
    trackedDirty=False,profile='devnet-test-profile',framework='anchor-2.0.0-rc.2',platformTools='v1.52',architecture='v0',
    binaries={path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(root.glob('*.so'))}),indent=2)+'\n')
PYTHON
node --import tsx tests/rpc-contract/devnet-gates-svm.ts
