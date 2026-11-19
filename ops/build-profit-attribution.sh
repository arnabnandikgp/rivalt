#!/usr/bin/env bash
# Build only the local candidate clearing program. Maker deployments are the
# selected, hash-verified P56 artifacts. The output is separate from the demo.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
revision="$(git rev-parse HEAD)"
test -z "$(git status --porcelain --untracked-files=no)"
output="${RIVALT_ATTRIBUTION_DIR:-.local/profit-attribution/build-$revision}"
test ! -e "$output"
profile="${RIVALT_ATTRIBUTION_PROFILE:-profit-attribution-qualification}"
case "$profile" in profit-attribution-qualification|single-pair-default-qualification|btc-residual-qualification|btc-allocation-qualification|linked-pair-qualification|linked-allocation-qualification|foreign-creditor-qualification|shared-inventory-qualification|partial-inventory-qualification|book-inventory-qualification) ;; *) exit 2 ;; esac
mkdir -p "$output"
node --import tsx ops/verify-liquidity-artifacts.ts .local/anchor-rc2/current
cargo build-sbf --manifest-path programs/clearing/Cargo.toml --arch v0 --tools-version v1.52 \
  --sbf-out-dir "$output" -- --locked --offline --features "$profile" > "$output/build.log" 2>&1
if rg 'Stack offset .* exceeded|max offset of 4096|overwrites values in the frame' "$output/build.log"; then exit 1; fi
cp .local/anchor-rc2/current/{maker_a,maker_b}.so "$output/"
python3 - "$output" "$revision" "$profile" <<'PY'
from hashlib import sha256
import json
from pathlib import Path
import sys
directory, revision = Path(sys.argv[1]), sys.argv[2]
binaries = {p.name: sha256(p.read_bytes()).hexdigest() for p in directory.glob('*.so')}
manifest = dict(revision=revision, trackedDirty=False, profile=sys.argv[3],
                accountSchema=10, profileVersion=6, framework='anchor-2.0.0-rc.2', binaries=binaries)
(directory/'build-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
print(directory)
PY
