#!/usr/bin/env bash
# Diagnostic clearing artifact only. Preserve accepted uninstrumented programs.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
export PATH="$PWD/.tools/anchor-v2-rc2/bin:$PATH"
test "$(anchor --version)" = 'anchor-cli 2.0.0-rc.2'
export CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0
export RIVALT_CU_ARTIFACT_DIR="${RIVALT_CU_ARTIFACT_DIR:-.local/cu-profiling}"
python3 - <<'PY'
import hashlib,json,os,shutil,subprocess
from pathlib import Path
assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],text=True).strip(), 'Record clean diagnostic source first'
assert shutil.disk_usage('.').free >= 1024**3, 'CU build requires 1 GiB free; no files deleted'
source=Path(os.environ['RIVALT_ARTIFACT_DIR']);target=Path(os.environ['RIVALT_CU_ARTIFACT_DIR'])
assert source.resolve()!=target.resolve(), 'Never overwrite accepted artifacts with diagnostic tracing'
target.mkdir(parents=True,exist_ok=True)
manifest=json.loads((source/'build-manifest.json').read_text())
assert manifest['trackedDirty'] is False and not manifest.get('instrumented',False)
for name in ['maker_a.so','maker_b.so','oracle_fixture.so']:
    assert hashlib.sha256((source/name).read_bytes()).hexdigest()==manifest['binaries'][name]
    shutil.copyfile(source/name,target/name)
(target/'parent-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
PY
NO_DNA=1 anchor build -p clearing --no-idl -- --arch v0 -- --locked \
  --features liquidity-execution-qualification,cu-profiling 2>&1 | tee "$RIVALT_CU_ARTIFACT_DIR/build.log"
if rg -q 'Stack offset .* exceeded|max offset of 4096|overwrites values in the frame' "$RIVALT_CU_ARTIFACT_DIR/build.log"; then
  echo 'Rejected unsafe diagnostic stack frame' >&2; exit 1
elif [[ $? != 1 ]]; then
  echo 'Could not validate diagnostic stack frames' >&2; exit 1
fi
cp target/deploy/clearing.so "$RIVALT_CU_ARTIFACT_DIR/clearing.so"
python3 - <<'PY'
import hashlib,json,os,subprocess
from pathlib import Path
target=Path(os.environ['RIVALT_CU_ARTIFACT_DIR'])
parent=json.loads((target/'parent-manifest.json').read_text())
manifest={
 'revision':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
 'trackedDirty':bool(subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],text=True).strip()),
 'profile':'liquidity-execution-qualification','instrumented':True,
 'framework':'anchor-2.0.0-rc.2','accountSchema':8,'makerAccountSchema':5,
 'features':['liquidity-execution-qualification','cu-profiling'],
 'unchangedComponentsSource':parent['revision'],
 'binaries':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(target.glob('*.so'))}}
assert not manifest['trackedDirty']
(target/'build-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
PY
