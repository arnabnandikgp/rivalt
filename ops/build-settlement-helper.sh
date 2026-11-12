#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
cargo build --locked --release -p rivalt-settlement-pages
export RIVALT_SETTLEMENT_HELPER_DIR="${RIVALT_SETTLEMENT_HELPER_DIR:-.local/settlement-helper}"
mkdir -p "$RIVALT_SETTLEMENT_HELPER_DIR"
cp target/release/rivalt-settlement-pages "$RIVALT_SETTLEMENT_HELPER_DIR/rivalt-settlement-pages"
python3 - <<'PY'
import hashlib,json,pathlib,subprocess,os
root=pathlib.Path(os.environ['RIVALT_SETTLEMENT_HELPER_DIR'])
binary=root/'rivalt-settlement-pages'
manifest={'version':2,'accountSchema':10,'programProfile':6,
 'revision':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
 'trackedDirty':bool(subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],text=True).strip()),
 'binary':'rivalt-settlement-pages','bytes':binary.stat().st_size,'sha256':hashlib.sha256(binary.read_bytes()).hexdigest()}
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest))
PY
