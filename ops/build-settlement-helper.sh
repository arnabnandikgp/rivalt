#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
# Build from the same immutable workspace as the admitted program, including its
# Cargo.lock. This also works when the operator checkout contains later changes.
selection="${1:-selected}"
set --
helper_dir=.local/settlement-helper
case "$selection" in
  selected) ;;
  book-inventory-candidate)
    set -- --features clearing/book-inventory-qualification
    helper_dir=.local/settlement-helper-book-inventory ;;
  partial-inventory-candidate)
    set -- --features clearing/partial-inventory-qualification
    helper_dir=.local/settlement-helper-partial-inventory ;;
  shared-inventory-candidate)
    set -- --features clearing/shared-inventory-qualification
    helper_dir=.local/settlement-helper-shared-inventory ;;
  foreign-creditor-candidate)
    set -- --features clearing/foreign-creditor-qualification
    helper_dir=.local/settlement-helper-foreign-creditor ;;
  linked-allocation-candidate)
    set -- --features clearing/linked-allocation-qualification
    helper_dir=.local/settlement-helper-linked-allocation ;;
  linked-flat-candidate)
    set -- --features clearing/linked-pair-qualification
    helper_dir=.local/settlement-helper-linked-flat ;;
  linked-pair-candidate)
    set -- --features clearing/linked-pair-qualification
    helper_dir=.local/settlement-helper-linked-pair ;;
  btc-allocation-candidate)
    set -- --features clearing/btc-allocation-qualification
    helper_dir=.local/settlement-helper-btc-allocation ;;
  btc-residual-candidate)
    set -- --features clearing/btc-residual-qualification
    helper_dir=.local/settlement-helper-btc-residual ;;
  verified-pair-candidate)
    set -- --features clearing/single-pair-default-qualification
    helper_dir=.local/settlement-helper-verified-pair ;;
  *) echo 'Unknown settlement helper selection' >&2; exit 2 ;;
esac
helper_revision="$(node --import tsx --input-type=module -e 'import {accountDeployment} from "./packages/sdk/src/account-deployment.ts";process.stdout.write(accountDeployment(process.argv[1]).helperRevision)' "$selection")"
helper_source="$(mktemp -d)"
trap 'rm -rf "$helper_source"' EXIT
program_paths=(tests/fixtures)
if git cat-file -e "$helper_revision:tests/programs" 2>/dev/null; then program_paths+=(tests/programs); fi
git archive "$helper_revision" Cargo.toml Cargo.lock rust-toolchain.toml programs crates "${program_paths[@]}" | tar -x -C "$helper_source"
build_target="$PWD/target"
(cd "$helper_source" && cargo build --locked --release --target-dir "$build_target" -p rivalt-settlement-pages "$@")
export RIVALT_SETTLEMENT_HELPER_DIR="${RIVALT_SETTLEMENT_HELPER_DIR:-$helper_dir}"
mkdir -p "$RIVALT_SETTLEMENT_HELPER_DIR"
cp target/release/rivalt-settlement-pages "$RIVALT_SETTLEMENT_HELPER_DIR/rivalt-settlement-pages"
python3 - "$helper_revision" "$selection" <<'PY'
import hashlib,json,pathlib,sys,os
root=pathlib.Path(os.environ['RIVALT_SETTLEMENT_HELPER_DIR'])
binary=root/'rivalt-settlement-pages'
manifest={'version':2,'accountSchema':10,'programProfile':6,
 'revision':sys.argv[1],
 'trackedDirty':False,
 'binary':'rivalt-settlement-pages','bytes':binary.stat().st_size,'sha256':hashlib.sha256(binary.read_bytes()).hexdigest()}
if sys.argv[2]=='book-inventory-candidate':
    manifest['feature']='book-inventory-qualification'
elif sys.argv[2]=='partial-inventory-candidate':
    manifest['feature']='partial-inventory-qualification'
elif sys.argv[2]=='shared-inventory-candidate':
    manifest['feature']='shared-inventory-qualification'
elif sys.argv[2]=='foreign-creditor-candidate':
    manifest['feature']='foreign-creditor-qualification'
elif sys.argv[2]=='linked-allocation-candidate':
    manifest['feature']='linked-allocation-qualification'
elif sys.argv[2] in ('linked-pair-candidate','linked-flat-candidate'):
    manifest['feature']='linked-pair-qualification'
elif sys.argv[2]=='btc-allocation-candidate':
    manifest['feature']='btc-allocation-qualification'
elif sys.argv[2]=='btc-residual-candidate':
    manifest['feature']='btc-residual-qualification'
elif sys.argv[2]=='verified-pair-candidate':
    manifest['feature']='single-pair-default-qualification'
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest))
PY
