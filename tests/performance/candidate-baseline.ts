/** P47 candidate coverage from independently fetched original wires/receipts.
 * This does not qualify services, economics, or load merely by covering names. */
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {relative, resolve} from 'node:path';
import {receiptMetrics, observedDistribution, type Receipt} from './receipt-metrics.js';
import {candidateArtifacts, profileContracts, sha256, OriginalPopulation} from './profile-contracts.js';

const directories = process.argv.slice(2).filter(value => !value.startsWith('--'));
assert(directories.length, 'Usage: candidate-baseline.ts <run>... [--partial | --write]');
const directory = process.env.RIVALT_ARTIFACT_DIR;
assert(directory, 'Explicit immutable candidate artifact directory required');
const {build, artifacts} = candidateArtifacts(directory);
const {contracts, idls} = profileContracts();
assert.deepEqual(idls, profileContracts(build.revision).idls, 'Current IDLs must match the pinned candidate source');
assert.equal(contracts.reduce((count, contract) => count + contract.instructions.length, 0), 61);
type Sample = ReturnType<typeof receiptMetrics> & {run: number; receipt: string; label: string; reexecutionOf: {run: number; receipt: string} | null};
const samples: Sample[] = [], population = new OriginalPopulation();
const runs = directories.map((directory, run) => {
  const summaryFile = existsSync(`${directory}/performance.json`) ? 'performance.json' : 'summary.json';
  const bytes = readFileSync(`${directory}/${summaryFile}`), summary = JSON.parse(bytes.toString());
  assert.equal(summary.trackedDirty, false, `${directory}: clean recorded verifier required`);
  assert(/^[a-f0-9]{40}$/.test(summary.revision));
  if (summary.build) {
    assert.equal(summary.build.revision, build.revision);
    assert.equal(summary.build.trackedDirty, false);
    assert.equal(summary.build.instrumented, undefined);
    assert.deepEqual(summary.build.binaries, build.binaries);
  } else {
    assert(summary.binaries, 'Maker-only runs must identify actual deployed artifacts');
    for (const {name} of contracts) assert.equal(summary.binaries[name], artifacts[name].sha256);
  }
  const start = samples.length;
  const receipts = readdirSync(directory).filter(name => /^transaction-\d+\.json$/.test(name))
    .sort((left, right) => Number(left.slice(12, -5)) - Number(right.slice(12, -5)));
  for (const filename of receipts) {
    const receipt: Receipt = JSON.parse(readFileSync(`${directory}/${filename}`, 'utf8'));
    const original = JSON.parse(readFileSync(`${directory}/${filename.replace('transaction-', 'wire-')}`, 'utf8'));
    const metrics = receiptMetrics(receipt, Buffer.from(original.wireBase64, 'base64'), contracts);
    const check = summary.checks.find((value: any) => value.signature === metrics.signature);
    assert(check && check.ws === true, 'Original must have independently fetched RPC and WS evidence');
    assert.equal(metrics.signature, original.signature);
    assert.equal(metrics.computeUnits, check.computeUnits);
    assert.equal(metrics.requestedCu, check.computeUnitLimit);
    assert.equal(metrics.feeLamports, String(check.feeLamports));
    assert.equal(metrics.wireBytes, check.bytes);
    assert.equal(original.label, check.label);
    const reexecutionOf = population.observe({...metrics, run, receipt: filename});
    samples.push({...metrics, run, receipt: filename, label: original.label, reexecutionOf});
  }
  assert.equal(samples.length - start, summary.checks.length, 'Retain setup and reverted outcomes as well as successful actions');
  return {directory: relative(process.cwd(), resolve(directory)), summary: summaryFile,
    sha256: sha256(bytes), harnessRevision: summary.revision, outcomes: receipts.length, runtime: summary.runtime ?? null};
});
const range = (values: number[]) => values.length ? [Math.min(...values), Math.max(...values)] : null;
const quantiles = (values: number[]) => {
  if (!values.length) return null;
  const result = observedDistribution(values);
  return [result.p50, result.p95, result.max];
};
const entrypoints = contracts.flatMap(contract => contract.instructions.map(instruction => {
  const name = `${contract.name}.${instruction.name}`;
  const observations = samples.flatMap(sample => sample.invocations.filter(invocation => invocation.name === name)
    .map(invocation => ({sample, invocation})));
  const success = observations.filter(value => value.invocation.transactionSucceeded);
  const rejected = observations.filter(value => !value.invocation.transactionSucceeded);
  const largest = [...success].sort((left, right) => right.invocation.inclusiveCu - left.invocation.inclusiveCu)[0];
  return {name, successfulInvocations: success.length, revertedInvocations: rejected.length,
    uniqueSuccessfulOriginals: new Set(success.map(value => value.sample.signature)).size,
    inclusiveCu: range(success.map(value => value.invocation.inclusiveCu)),
    inclusiveCuP50P95Max: quantiles(success.map(value => value.invocation.inclusiveCu)),
    revertedInclusiveCu: range(rejected.map(value => value.invocation.inclusiveCu)),
    transactionCu: range(success.map(value => value.sample.computeUnits)),
    requestedCu: range(success.map(value => value.sample.requestedCu)),
    explicitHeapBytes: range(success.flatMap(value => value.sample.heapBytes === null ? [] : [value.sample.heapBytes])),
    loadedDataLimitBytes: range(success.flatMap(value => value.sample.loadedDataLimitBytes === null ? [] : [value.sample.loadedDataLimitBytes])),
    wireBytes: range(success.map(value => value.sample.wireBytes)),
    signatures: range(success.map(value => value.sample.signatures)),
    fees: range(success.map(value => Number(value.sample.feeLamports))),
    keys: range(success.map(value => value.sample.loadedAccounts)),
    writable: range(success.map(value => value.sample.locks.write.length)),
    max: largest ? {run: largest.sample.run, receipt: largest.sample.receipt, label: largest.sample.label,
      depth: largest.invocation.depth} : null};
}));
const missing = entrypoints.filter(value => !value.successfulInvocations).map(value => value.name);
const result = {schema: 1, checkpoint: 'C0-Anchor-RC2', completeCoverage: missing.length === 0,
  qualificationClaim: 'entrypoint coverage only', sbfSource: build.revision, profile: build.profile, idls, artifacts, runs,
  outcomes: {observedExecutions: samples.length, uniqueSignedOriginals: population.uniqueOriginals,
    crossRunReexecutions: samples.filter(value => value.reexecutionOf).length, finalizedSuccess: samples.filter(value => value.outcome === 'success').length,
    finalizedRejection: samples.filter(value => value.outcome === 'rejected').length},
  entrypoints, missing, semantics: [
    'Coverage is not complete economic/service/load qualification',
    'Independent fresh chains can replay identical signed bytes with different initial state; executions and unique originals are counted separately',
    'Repeated originals within one run are rejected; every cross-run reexecution retains its first-original reference in local output',
    'Inclusive instruction CU contains child CPIs; do not sum parent and child',
    'Quantiles cover the named heterogeneous observed population, not independent repeated trials or worst cases',
    'Reverted transactions supply no successful coverage even when a child returns success',
    'Requested resource bids determine priority fees; consumed CU savings alone do not lower paid fees',
    'Actual instruction bytes/metas, fees, CPI ancestry and complete signed originals are checked against fetched RPC',
    'Loaded data bytes remain null when RPC omits them; static key count is not loaded bytes',
    'No Anchor attribution or matched B/C percentage follows from independently aggregated ranges',
  ]};
const output = JSON.stringify(result, null, 1) + '\n';
if (process.argv.includes('--partial')) {
  assert(!process.argv.includes('--write'));
  writeFileSync('.local/anchor-rc2/partial-coverage.json', output);
} else {
  assert.equal(missing.length, 0, `Missing successful entrypoints: ${missing.join(', ')}`);
  assert(Buffer.byteLength(output) <= 64 * 1024, 'Only bounded summaries belong in Git');
  const target = 'tests/performance/baselines/p47-c0.json';
  if (process.argv.includes('--write')) writeFileSync(target, output);
  else assert.equal(readFileSync(target, 'utf8'), output, 'Candidate summary must reproduce');
}
writeFileSync('.local/anchor-rc2/candidate-transactions.json', JSON.stringify(samples, null, 2) + '\n');
console.log(JSON.stringify({entrypoints: entrypoints.length, covered: entrypoints.length - missing.length,
  executions: samples.length, uniqueOriginals: population.uniqueOriginals,
  reexecutions: samples.filter(value => value.reexecutionOf).length, missing, bytes: Buffer.byteLength(output)}, null, 2));
