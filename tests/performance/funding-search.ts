// CPU/work diagnostic, not landed publisher CU or real maker availability.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { allocateFundingSide, type FundingCurve } from '../../packages/sdk/src/funding-impact.js';
const scenarios: { name: string; reference: bigint; quantity: bigint; makers: FundingCurve[] }[] = [];
for (const [reference, quantity] of [[2n, 3_000_000n], [100_000n, 3_000_000n], [909_090n, 7n]]) {
  for (const step of [1n, 10_000n, 1_000_000n]) {
    const regions = Array.from({ length: 8 }, (_, index) => ({ endLots: BigInt(index + 1) * 400_000n,
      offset: BigInt(index) * (reference === 2n ? 0n : 2n), slope: 0n }));
    const makers = [0n, 1n, 2n].map(instance => ({ anchor: reference, inventory: instance * 10_001n,
      buyConsumed: instance * 100n, sellConsumed: instance * 200n, shape: { mode: 1, ttlSlots: 150,
        target: -instance * 31n, skewStep: step, skewTick: reference === 2n ? 0n : 1n,
        shortCap: 3_200_000n, longCap: 3_200_000n, bids: regions, asks: regions } }));
    scenarios.push({ name: `${reference}/${quantity}/step-${step}`, reference, quantity, makers });
  }
}
const samples: number[] = [], rows: unknown[] = [];
let maximumQuotes = 0;
for (const scenario of scenarios) for (const side of [0, 1] as const) {
  let result;
  const metrics = { quantityQuotes: 0, compositions: 0 };
  result = allocateFundingSide(scenario.makers, scenario.reference, scenario.quantity, side, metrics);
  assert(metrics.quantityQuotes < 600); maximumQuotes = Math.max(maximumQuotes, metrics.quantityQuotes);
  for (let iteration = 0; iteration < 100; iteration++) {
    const start = performance.now(); allocateFundingSide(scenario.makers, scenario.reference, scenario.quantity, side);
    samples.push(performance.now() - start);
  }
  rows.push({ name: scenario.name, side, metrics, result });
}
samples.sort((left, right) => left - right);
console.log(JSON.stringify({ revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  trackedDirty: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()),
  iterations: samples.length, p95Ms: samples[Math.floor(samples.length * .95)], p99Ms: samples[Math.floor(samples.length * .99)],
  maximumQuotes, rows, limitation: '18 bounded scenarios, including deliberately larger-than-notional Q; not a worst-case latency or CU proof' },
  (_, value) => typeof value === 'bigint' ? value.toString() : value, 2));
