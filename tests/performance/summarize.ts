// Publish only bounded metrics/provenance; retain transaction bytes and logs locally.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { transactionLocks, conflicts } from './lock-model.js';

const run = process.argv[2];
assert(run, 'Usage: node --import tsx tests/performance/summarize.ts <local-run-directory> [--write]');
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const raw = readFileSync(resolve(run, 'performance.json'));
const report = JSON.parse(raw.toString());
assert.equal(report.schema, 1);
assert.equal(report.trackedDirty, false, 'Publish metrics from a clean recorded harness revision');
assert.equal(report.build.trackedDirty, false);
assert.equal(report.samples.length, 12, 'Complete focused scenario set');
assert.deepEqual(report.samples.map((sample: any) => sample.label).sort(), [
  'trade btc-single', 'trade eth-single', 'trade isolated-single',
  'trade btc-pair-shared-program', 'trade btc-pair-distinct-programs',
  'trade stale-account-rejection', 'order place', 'order cancel',
  'reprice 0', 'reprice 1', 'funding 0', 'funding 1',
].map(label => `P39 ${label}`).sort());
assert.equal(report.samples.filter((sample: any) => sample.error !== null).length, 1);
const cases = report.samples.map((sample: any) => {
  const transaction = JSON.parse(readFileSync(resolve(run, sample.receipt), 'utf8'));
  assert.equal(transaction.transaction.signatures[0], sample.signature);
  assert.equal(transaction.meta.computeUnitsConsumed, sample.computeUnits);
  assert.deepEqual(transaction.meta.err, sample.error);
  assert.equal(String(transaction.meta.fee), sample.feeLamports);
  const wirePath = sample.receipt.replace('transaction-', 'wire-');
  const wire = Buffer.from(JSON.parse(readFileSync(resolve(run, wirePath), 'utf8')).wireBase64, 'base64');
  assert.equal(hash(wire), sample.wireSha256);
  assert.deepEqual(transactionLocks(wire), sample.compiled);
  assert(sample.ws && sample.computeUnits > 0 && sample.computeUnits < sample.computeUnitLimit);
  return { id: sample.label.slice(4), samples: 1, outcome: sample.error === null ? 'success' : 'expected-rejection',
    computeUnits: sample.computeUnits, requestedComputeUnits: sample.computeUnitLimit,
    transactionVersion: sample.version, wireBytes: sample.bytes, signatures: sample.signatures,
    feeLamports: sample.feeLamports, priorityBid: '0', loadedAccounts: sample.loadedAccounts,
    loadedAccountDataBytes: transaction.meta.loadedAccountsDataSize ?? null,
    declaredReads: sample.protocol.read.length, declaredWrites: sample.protocol.write.length,
    compiledReads: sample.compiled.read.length, compiledWrites: sample.compiled.write.length };
});
const accessChecks = report.accessChecks.map((pair: any) => {
  const left = report.samples.find((sample: any) => sample.label === pair.left);
  const right = report.samples.find((sample: any) => sample.label === pair.right);
  assert.deepEqual(conflicts(left.protocol, right.protocol), pair.protocol);
  assert.deepEqual(conflicts(left.compiled, right.compiled), pair.compiled);
  return { left: pair.left.slice(4), right: pair.right.slice(4),
    declaredConflicts: pair.protocol.length, compiledConflicts: pair.compiled.length };
});
const artifacts = Object.fromEntries(['clearing', 'maker_a', 'maker_b', 'oracle_fixture'].map(name => {
  const bytes = readFileSync(`.local/liquidity-execution/${name}.so`);
  assert.equal(hash(bytes), report.build.binaries[`${name}.so`]);
  return [name, { sha256: hash(bytes), bytes: bytes.length }];
}));
const result = { schema: 1, checkpoint: 'A-focused-pre-redesign',
  harnessRevision: report.revision, sbfSourceRevision: report.build.revision, profile: report.build.profile,
  runtime: report.runtime, artifacts, rawEvidenceDirectory: relative(process.cwd(), resolve(run)),
  rawSummarySha256: hash(raw),
  scope: report.scope, setupOutcomes: report.setupOutcomes, cases, accessChecks,
  independentFinancialCheck: report.independentFinancialCheck, parity: report.parity,
  limitations: ['One observation per named state; no worst-case or statistical CU claim',
    'Shared harness payer; compiled conflicts include it',
    'No scheduler throughput, PG, full instruction coverage or Anchor v2 comparison',
    'Null loadedAccountDataBytes means this RPC response does not provide the metric'] };
const output = JSON.stringify(result, null, 2) + '\n';
assert(Buffer.byteLength(output) <= 32 * 1024, 'Bounded summary only');
const target = 'tests/performance/baselines/p39-before-redesign.json';
if (process.argv.includes('--write')) writeFileSync(target, output);
else assert.equal(readFileSync(target, 'utf8'), output, 'Baseline differs from verified receipts');
console.log(`Verified ${cases.length} receipts and ${accessChecks.length} access comparisons; bounded summary ${Buffer.byteLength(output)} bytes.`);
