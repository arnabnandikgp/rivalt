#!/usr/bin/env bash
# Install the four qualified local programs without checking out another branch.
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
export RIVALT_DEMO_DEPLOYMENT="${RIVALT_DEMO_DEPLOYMENT:-bounded-entry}"
case "$RIVALT_DEMO_DEPLOYMENT" in
  unified-recovery-candidate) feature=unified-recovery-qualification ;;
  bounded-entry|funded-routing) feature=bounded-entry-settlement ;;
  closed-quantity) feature=closed-quantity-settlement ;;
  bounded-router-candidate|execution-router-candidate) feature=execution-router-qualification ;;
  *) echo 'Unsupported local build selection' >&2; exit 1 ;;
esac
read -r revision artifact_set baseline_revision < <(node --import tsx --input-type=module -e '
  import {accountDeployment} from "./packages/sdk/src/account-deployment.ts";
  const successor=accountDeployment(process.env.RIVALT_DEMO_DEPLOYMENT);
  console.log(successor.programRevision??successor.helperRevision,successor.artifactSet,accountDeployment("selected").helperRevision)')
directory="${RIVALT_DEMO_PROGRAMS:-$PWD/.local/demo-programs/$artifact_set}"
directory="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$directory")"
verify() { node --import tsx packages/local-demo/src/artifacts.ts "$1"; }
if [[ -e "$directory" ]]; then
  verify "$directory"
else
  mkdir -p "$(dirname "$directory")"
  stage="$(mktemp -d "$(dirname "$directory")/.install-XXXXXXXX")"
  source_dir="$(mktemp -d)"
  trap 'rm -rf "$source_dir" "$stage"' EXIT
  archive_source() {
    mkdir "$source_dir/$1"
    local paths=(Cargo.toml Cargo.lock rust-toolchain.toml programs crates tests/fixtures)
    if git cat-file -e "$1:tests/programs" 2>/dev/null; then paths+=(tests/programs); fi
    git archive "$1" "${paths[@]}" |
      tar -x -C "$source_dir/$1"
  }
  mkdir "$source_dir/binaries"
  export CARGO_TARGET_DIR="$PWD/target"
  build_program() {
    local commit="$1" manifest="$2" program="$3"
    shift 3
    if [[ ! -d "$source_dir/$commit" ]]; then archive_source "$commit"; fi
    (cd "$source_dir/$commit" && cargo build-sbf --manifest-path "$manifest" --arch v0 --tools-version v1.52 \
      --sbf-out-dir "$source_dir/binaries" -- --locked "$@") >"$stage/$program.log" 2>&1 || { tail -30 "$stage/$program.log" >&2; return 1; }
    if rg 'Stack offset .* exceeded|max offset of 4096|overwrites values in the frame' "$stage/$program.log"; then return 1; fi
    cp "$source_dir/binaries/$program.so" "$stage/"
  }
  maker_revision="$baseline_revision"
  if [[ "$feature" == execution-router-qualification || "$feature" == closed-quantity-settlement || "$feature" == bounded-entry-settlement ]]; then maker_revision="$revision"; fi
  build_program "$revision" programs/clearing/Cargo.toml clearing --features "$feature"
  for component in maker-a maker-b; do
    build_program "$maker_revision" "programs/$component/Cargo.toml" "${component//-/_}" --features maker-liquidity-qualification
  done
  build_program "$baseline_revision" tests/fixtures/oracle/Cargo.toml oracle_fixture
  verify "$stage" > "$stage/build-manifest.json"
  python3 -c 'import os,sys; os.rename(sys.argv[1],sys.argv[2])' "$stage" "$directory"
fi
node ops/local-keys.mjs --missing
if ! node --import tsx --input-type=module -e 'import {SettlementPages} from "./packages/services/src/settlement-pages.ts"; new SettlementPages(undefined,"unified-recovery-candidate")' 2>/dev/null; then
  bash ops/build-settlement-helper.sh unified-recovery-candidate
fi
cargo build --locked --release -p default-plan-selection --features keeper --bin rivalt-recovery-selector
