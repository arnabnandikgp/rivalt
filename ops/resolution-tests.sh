#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ops/env.sh
export CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0
cargo test --locked -p clearing --lib resolution::tests
for page in 1 2 3 4; do
  node --import tsx tests/rpc-contract/resolution-svm.ts "$page" 5
done
node --import tsx tests/rpc-contract/resolution-svm.ts 4 64 emergency
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const results=[1,2,3,4].map(n=>JSON.parse(readFileSync(`.local/p09-svm-${n}-5.json`)));
for(const r of results.slice(1))assert.deepEqual(r.result.expected,results[0].result.expected,'same real signed economic setup, identical independent expected payout across legal pages');
results.push(JSON.parse(readFileSync('.local/p09-svm-4-64.json')));
writeFileSync('.local/p09-svm.json',JSON.stringify({revision:results[0].revision,sourceDirty:results.some(r=>r.sourceDirty),pageEquivalence:true,results},null,2)+'\n');
console.log('P09: all four page sizes agree; actual 64-member cohort and source emergency pass.');
JS
