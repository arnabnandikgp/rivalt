// Diagnostic-only intervals. Nested categories overlap: never sum this table as
// transaction CU. Headline comparisons come from uninstrumented receipts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CLEARING_PROGRAM_ADDRESS } from '@rivalt/sdk';

const directory = process.argv[2];
assert(directory, 'Usage: attribution.ts <instrumented-run-directory> [--write]');
const report = JSON.parse(readFileSync(resolve(directory, 'performance.json'), 'utf8'));
assert.equal(report.instrumented, true);
assert.equal(report.trackedDirty, false);
assert.equal(report.build.instrumented, true);
assert.equal(report.build.trackedDirty, false);
const intervals = [
  ['maker authentication including hash', 'maker-auth-enter', 'maker-auth-exit'],
  ['full approved code hash', 'code-hash-enter', 'code-hash-exit'],
  ['canonical quote arithmetic', 'canonical-quote-enter', 'canonical-quote-exit'],
  ['maker CPI including dispatch', 'maker-cpi-enter', 'maker-cpi-exit'],
  ['whole-account financial candidate', 'financial-candidate-enter', 'financial-candidate-exit'],
  ['financial commit including event', 'route-commit-enter', 'handler-exit'],
  ['event sizing', 'payload-size-enter', 'payload-size-exit'],
  ['event encoding', 'payload-size-exit', 'payload-encoded'],
  ['scoped footer including event', 'footer-enter', 'scope-exit'],
] as const;
const cases = report.samples.filter((sample: any) => sample.error === null && sample.label.startsWith('CU trade '))
  .map((sample: any) => {
    const raw = readFileSync(resolve(directory, sample.receipt));
    const receipt = JSON.parse(raw.toString());
    assert.equal(receipt.transaction.signatures[0], sample.signature);
    assert.equal(receipt.meta.computeUnitsConsumed, sample.computeUnits);
    const stack: string[] = [], markers: { label: string; remaining: number }[] = [];
    const logs: string[] = receipt.meta.logMessages;
    for (let index = 0; index < logs.length; index++) {
      const invocation = /^Program (\w+) invoke \[(\d+)\]$/.exec(logs[index]);
      if (invocation) {
        assert.equal(Number(invocation[2]), stack.length + 1);
        stack.push(invocation[1]);
        continue;
      }
      const completion = /^Program (\w+) (?:success|failed:.*)$/.exec(logs[index]);
      if (completion) { assert.equal(stack.pop(), completion[1]); continue; }
      const marker = /^Program log: RIVALT_CU:([a-z-]+)$/.exec(logs[index]);
      if (!marker || stack.at(-1) !== CLEARING_PROGRAM_ADDRESS) continue;
      const meter = /^Program consumption: (\d+) units remaining$/.exec(logs[index + 1]);
      assert(meter, 'Every actual clearing marker must have its immediate CU meter');
      const remaining = Number(meter[1]);
      assert(!markers.length || remaining <= markers.at(-1)!.remaining, 'Counter cannot increase within this transaction');
      markers.push({ label: marker[1], remaining });
    }
    assert.equal(stack.length, 0, 'Complete successful log required');
    const sections = intervals.map(([name, start, end]) => {
      const samples: number[] = [];
      let opened: number | undefined;
      for (const marker of markers) {
        if (marker.label === start) { assert.equal(opened, undefined); opened = marker.remaining; }
        if (marker.label === end) {
          assert(opened !== undefined, `Unpaired ${end}`);
          samples.push(opened - marker.remaining); opened = undefined;
        }
      }
      assert.equal(opened, undefined, `Unclosed ${start}`);
      assert(samples.length > 0, `Missing ${name}`);
      return { name, calls: samples.length, computeUnits: samples.reduce((sum, value) => sum + value, 0) };
    });
    return { id: sample.label.slice(3), receipt: sample.receipt,
      receiptSha256: createHash('sha256').update(raw).digest('hex'),
      instrumentedTransactionCu: sample.computeUnits, sections };
  });
assert.equal(cases.length, 5);
const result = { schema: 1, harnessRevision: report.revision, build: report.build,
  rawEvidenceDirectory: directory, cases,
  limitations: ['Instrumented intervals include diagnostic marker overhead and compiler effects',
    'Nested categories overlap; do not sum these as transaction consumption',
    'Full code authentication remains mandatory; no changed trust model or production TPS claim'] };
const output = JSON.stringify(result, null, 2) + '\n';
assert(Buffer.byteLength(output) < 16 * 1024);
const target = 'tests/performance/baselines/p43-attribution.json';
if (process.argv.includes('--write')) writeFileSync(target, output);
else assert.equal(readFileSync(target, 'utf8'), output);
console.log(`Verified ${cases.length} signed diagnostic route receipts and complete paired intervals.`);
