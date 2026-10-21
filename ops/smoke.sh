#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
# An absolute store keeps npm lifecycle-inherited config from resolving differently
# inside the independent legacy root. CI permits noninteractive node_modules repair.
CI=true pnpm install --frozen-lockfile --store-dir "$PWD/.local/pnpm-store"
CI=true pnpm --dir tests/anchor-conformance install --frozen-lockfile --store-dir "$PWD/.local/pnpm-store"
mkdir -p .local
for program in clearing maker_a maker_b; do
  cp "packages/sdk/idl/$program.json" ".local/expected-$program-idl.json"
done
bash ops/build.sh
for program in clearing maker_a maker_b; do
  cmp "packages/sdk/idl/$program.json" ".local/expected-$program-idl.json"
done
pnpm generate:check
# build.sh regenerates the SDK; determinism alone cannot detect stale commits.
git diff --exit-code HEAD -- packages/sdk/src/generated packages/sdk/src/generatedMakerA packages/sdk/src/generatedMakerB packages/sdk/idl
test -z "$(git status --porcelain -- packages/sdk/src/generated packages/sdk/src/generatedMakerA packages/sdk/src/generatedMakerB packages/sdk/idl)"
pnpm typecheck
pnpm test
pnpm test:financial
pnpm test:svm
pnpm test:makers
pnpm test:routes
node ops/check-dependencies.mjs
bash ops/rpc-smoke.sh
