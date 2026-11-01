// Frozen B inventory. Raw signed wires/receipts stay in their existing ignored runs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { receiptMetrics, observedDistribution, type Receipt } from './receipt-metrics.js';

import {profileContracts, FROZEN_B_SOURCE} from './profile-contracts.js';

assert(!process.argv.includes('--write'), 'Frozen B cannot be rewritten; use the separate candidate collector');
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const directories: string[] = process.argv.includes('--replay')
  ? json('tests/performance/baselines/p44-pre-v2.json').runs.map((run: { directory: string }) => run.directory)
  : process.argv.slice(2).filter(value => !value.startsWith('--'));
assert(directories.length, 'Usage: full-baseline.ts <run>... [--write | --partial]');
const {contracts, idls} = profileContracts(FROZEN_B_SOURCE);
assert.deepEqual(idls, json('tests/performance/baselines/p44-pre-v2.json').idls, 'Frozen B IDLs');
const build = json('.local/liquidity-execution/build-manifest.json');
assert.equal(build.trackedDirty, false); assert.equal(build.instrumented, undefined);
assert.equal(build.revision, 'fb5d0c546a417796ce615e0d3d3575545c96c178', 'Frozen B uses its exact accepted programs');
const artifacts = Object.fromEntries(['clearing', 'maker_a', 'maker_b', 'oracle_fixture'].map(name => {
  const bytes = readFileSync(`.local/liquidity-execution/${name}.so`);
  assert.equal(hash(bytes), build.binaries[`${name}.so`]);
  return [name, { sha256: hash(bytes), bytes: bytes.length }];
}));
type Sample = ReturnType<typeof receiptMetrics> & { run: string; receipt: string; label: string; confirmedMs?: number; finalityAuditMs?: number };
const samples: Sample[] = [], seen = new Set<string>();
const runs = directories.map(directory => {
  const summaryFile = existsSync(`${directory}/performance.json`) ? 'performance.json' : 'summary.json';
  const raw = readFileSync(`${directory}/${summaryFile}`), summary = JSON.parse(raw.toString());
  assert.equal(summary.trackedDirty, false, `${directory}: clean verifier required`);
  assert(/^[a-f0-9]{40}$/.test(summary.revision));
  if (summary.build) {
    assert.equal(summary.build.trackedDirty, false); assert.equal(summary.build.revision, build.revision);
    for (const name of Object.keys(artifacts)) assert.equal(summary.build.binaries[`${name}.so`], artifacts[name].sha256);
  } else {
    // Maker-only driver records independently hashed deployed program files.
    assert(summary.binaries, `${directory}: explicit compiled artifact provenance required`);
    for (const name of contracts.map(value => value.name)) assert.equal(summary.binaries[name], artifacts[name].sha256);
  }
  const start = samples.length;
  for (const filename of readdirSync(directory).filter(name => /^transaction-\d+\.json$/.test(name)).sort((left,right) => Number(left.slice(12,-5))-Number(right.slice(12,-5)))) {
    const receipt: Receipt = json(`${directory}/${filename}`);
    const saved = json(`${directory}/${filename.replace('transaction-', 'wire-')}`);
    const measured = receiptMetrics(receipt, Buffer.from(saved.wireBase64, 'base64'), contracts);
    assert.equal(measured.signature, saved.signature);
    const check = summary.checks.find((item: any) => item.signature === measured.signature);
    assert(check && check.ws === true, 'Finalized RPC and WS acceptance required');
    assert.equal(check.computeUnits, measured.computeUnits); assert.equal(check.computeUnitLimit, measured.requestedCu);
    assert.equal(String(check.feeLamports), measured.feeLamports); assert.equal(check.bytes, measured.wireBytes);
    assert.equal(check.label, saved.label);
    assert(!seen.has(measured.signature), 'Duplicate transaction cannot inflate observation count'); seen.add(measured.signature);
    samples.push({ ...measured, run: relative(process.cwd(), resolve(directory)), receipt: filename, label: saved.label,
      confirmedMs: check.signedToConfirmedMs, finalityAuditMs: check.confirmationMs });
  }
  assert.equal(samples.length - start, summary.checks.length, 'Every accepted harness outcome retained, including setup/rejections');
  return { directory: relative(process.cwd(), resolve(directory)), summary: summaryFile, sha256: hash(raw),
    harnessRevision: summary.revision, outcomes: samples.length - start, runtime: summary.runtime ?? null };
});
const range = (values: number[]) => values.length ? [Math.min(...values), Math.max(...values)] : null;
const entrypoints = contracts.flatMap(contract => contract.instructions.map(instruction => {
  const name = `${contract.name}.${instruction.name}`;
  const observations = samples.flatMap(sample => sample.invocations.filter(value => value.name === name).map(invocation => ({ sample, invocation })));
  const success = observations.filter(value => value.invocation.transactionSucceeded);
  const failed = observations.filter(value => !value.invocation.transactionSucceeded);
  const largest = [...success].sort((left, right) => right.invocation.inclusiveCu - left.invocation.inclusiveCu)[0];
  return { name, successfulInvocations: success.length, revertedInvocations: failed.length,
    inclusiveCu: range(success.map(value => value.invocation.inclusiveCu)), revertedInclusiveCu: range(failed.map(value => value.invocation.inclusiveCu)),
    transactionCu: range(success.map(value => value.sample.computeUnits)), requestedCu: range(success.map(value => value.sample.requestedCu)),
    wireBytes: range(success.map(value => value.sample.wireBytes)), signatures: range(success.map(value => value.sample.signatures)),
    fees: range(success.map(value => Number(value.sample.feeLamports))),
    keys: range(success.map(value => value.sample.loadedAccounts)), writable: range(success.map(value => value.sample.locks.write.length)),
    max: largest ? { run: runs.findIndex(run => run.directory === largest.sample.run), receipt: largest.sample.receipt,
      label: largest.sample.label, depth: largest.invocation.depth } : null };
}));
const missing = entrypoints.filter(value => value.successfulInvocations === 0).map(value => value.name);
const loadRun = runs.find(run => run.directory.endsWith('/p44-load-final'));
assert(loadRun, 'Frozen B requires the accepted current indexer/load constituent');
const load = json(`${loadRun.directory}/summary.json`);
const quantiles = (value: {p50:number;p95:number;p99:number}) => [value.p50,value.p95,value.p99].map(item => Math.round(item*1000)/1000);
const environment = { anchor: '1.2.1', hostRust: '1.97.1', platformTools: '1.52', sbfRust: '1.89.0-dev', sbpf: 'v0',
  buildScript: 'ops/build-liquidity-execution.sh', locked: true, instrumented: false, accountSchema: 7,
  node: '24.22.0', pnpm: '10.23.0', kit: '8.5.0', web3: '3.1.1', postgres: '18.6', liteSvm: '1.6.1',
  isolatedConformance: {anchor:'1.2.1',web3:'1.99.0'}, syntheticSlotMs:50,
  priorityFees: 'Every captured harness bid is zero; worker receipts are reported separately',
  loadedDataBytes: 'Not returned by this RPC; null in local per-transaction output'};
assert(samples.every(sample => sample.priorityLamports === '0'));
const loadEnvelope = { run: runs.indexOf(loadRun), host: load.host, policy: load.policy,
  timing: 'p50/p95/p99 observed milliseconds, rounded to three decimals; WS audit completion is not exact notification arrival',
  windows: load.ramps.map((row:any) => ({workload:row.workload, offeredPerSecond:row.rate,
    offered:row.offered, eligible:row.eligible, constructed:row.constructed, simulated:row.simulated, submitted:row.submitted,
    finalizedSuccess:row.finalizedSuccess, rejected:row.rejected, expired:row.expired, unresolved:row.unresolved,
    unsubmitted:row.unsubmitted, reasons:row.reasons,
    confirmedMs:quantiles(row.signedToConfirmedMs), finalizedMs:quantiles(row.signedToFinalizedMs),
    buildMs:quantiles(row.buildMs), receiptFetchMs:quantiles(row.finalizedReceiptFetchMs),
    wsAuditMs:quantiles(row.finalizedToWsAuditMs), generatorLagMs:quantiles(row.generatorLagMs)})),
  indexerCycles: {coherent:load.indexSamples.filter((sample:any) => !sample.reason).length,
    rejected:load.indexSamples.filter((sample:any) => sample.reason).length},
  financial:load.reconciliation, parentProcess:{userCpuUs:load.resource.userCPUTime,systemCpuUs:load.resource.systemCPUTime,endRssBytes:load.memory.rss} };
const result = { schema: 1, checkpoint: 'B-pre-Anchor-v2', complete: missing.length === 0, sbfSource: build.revision,
  environment, loadEnvelope,
  profile: build.profile, idls, artifacts, runs, outcomes: { offeredHarness: samples.length,
    finalizedSuccess: samples.filter(value => value.outcome === 'success').length,
    finalizedRejection: samples.filter(value => value.outcome === 'rejected').length },
  entrypoints, missing,
  semantics: ['inclusiveCu includes child CPI; never sum parent and child or equate it with transaction consumption',
    'Transaction ranges include all batched instructions, setup and payer/signature overhead; use named raw receipts to reproduce',
    'Reverted invocations grant no successful coverage even when a child returned success',
    'Finite observed states, not worst-case CU, independent statistical samples, validator TPS or funded acceptance',
    'Priority fee is decoded from requested v0 limit/rate or explicit v1 lamports, never calculated from consumed CU',
    'Loaded account-data bytes are unavailable when RPC omits the metric; static key count is not bytes'] };
const output = JSON.stringify(result, null, 1) + '\n';
if (process.argv.includes('--partial')) {
  writeFileSync('.local/p44-partial-inventory.json', output);
} else {
  assert.equal(missing.length, 0, `Unmeasured successful entrypoints: ${missing.join(', ')}`);
  assert(Buffer.byteLength(output) <= 52 * 1024, 'Bounded inventory only; local receipts hold detailed observations');
  const path = 'tests/performance/baselines/p44-pre-v2.json';
  if (process.argv.includes('--write')) writeFileSync(path, output);
  else assert.equal(readFileSync(path, 'utf8'), output, 'Pinned baseline must reproduce');
}
// Large per-transaction access/latency rows are intentionally ignored local output.
writeFileSync('.local/p44-transactions.json', JSON.stringify(samples, null, 2) + '\n');
console.log(JSON.stringify({ instructions: entrypoints.length, covered: entrypoints.length - missing.length, outcomes: samples.length, missing,
  signedToConfirmedMs: samples.some(value => value.confirmedMs !== undefined)
    ? observedDistribution(samples.filter(value => value.confirmedMs !== undefined).map(value => value.confirmedMs!)) : null,
  bytes: Buffer.byteLength(output) }, null, 2));
