// Compare like-for-like uninstrumented focused measurements. Runtime changes
// require a separately measured bridge, not a silent percentage comparison.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const [beforePath, afterPath] = process.argv.slice(2);
assert(beforePath && afterPath, 'Usage: compare.ts <before-summary> <after-summary>');
const before = JSON.parse(readFileSync(beforePath, 'utf8'));
const after = JSON.parse(readFileSync(afterPath, 'utf8'));
assert.equal(before.schema, 2);
assert.equal(after.schema, 2);
assert.equal(before.instrumented, false);
assert.equal(after.instrumented, false);
for (const field of ['workload', 'runtime', 'idlHashes', 'independentFinancialCheck', 'accessChecks']) {
  assert.deepEqual(after[field], before[field], `Different comparison ${field}`);
}
assert.equal(after.cases.length, before.cases.length);
const comparison = before.cases.map((previous: any, index: number) => {
  const current = after.cases[index];
  for (const field of ['id', 'samples', 'outcome', 'transactionVersion', 'wireBytes',
    'signatures', 'requestedComputeUnits', 'declaredReads', 'declaredWrites',
    'compiledReads', 'compiledWrites', 'feeLamports', 'priorityBid']) {
    assert.equal(current[field], previous[field], `${previous.id}: incomparable ${field}`);
  }
  return { id: previous.id, beforeCu: previous.computeUnits, afterCu: current.computeUnits,
    savedCu: previous.computeUnits - current.computeUnits,
    actualFeeLamports: current.feeLamports };
});
console.log(JSON.stringify({ before: before.harnessRevision, after: after.harnessRevision,
  scope: 'One observation per named state; no statistical or worst-case gain', comparison }, null, 2));
