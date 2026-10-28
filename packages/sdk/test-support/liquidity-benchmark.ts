import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpus,platform,arch } from 'node:os';
import { writeFileSync } from 'node:fs';
import { liquidityFixture } from './liquidity-fixture.js';
import { allocateLiquidityRoute } from '../src/liquidity-allocation.js';

const cases = [0,1,2,3].map(index => {
  const { input,root,makers } = liquidityFixture();
  input.lots = index < 2 ? 4097n : 4608n;input.side = index % 2 as 0|1;
  input.allInLimit = input.side === 0 ? 10n**12n : 0n;
  root.cash = index % 2 === 0 ? 10n**12n : 0n; // Failed trader admission forces every pair candidate to be valued.
  root.positions[1].lots = 3n;root.positions[1].virtualScaled = -30000n*10n**9n;
  input.funding = [3n,7n];
  for (const account of [root,...makers.map(maker => maker.capital)]) {
    account.book.orders.forEach((entry,slot) => {
      entry.marketIndex = account.role === 1 ? 0 : slot % 2;
      Object.assign(entry.order,{ id: BigInt(slot+1),state: 1,termsEpoch: 1n,side: slot%2,lots: 3n,limit: 10010n,
        feeBudget: 9n,startSlot: 1n,expirySlot: 1000n });
    });
  }
  for (const maker of makers) {
    maker.capital.cash = 10n**12n;
    maker.shape = { ...maker.shape,skewStep: 512n,skewTick: 2n,
      asks: Array.from({ length: 8 },(_,region) => ({ endLots: BigInt((region+1)*512),offset: BigInt(10+region*2),slope: 0n })),
      bids: Array.from({ length: 8 },(_,region) => ({ endLots: BigInt((region+1)*512),offset: BigInt(10+region*2),slope: 0n })),
    };
  }
  return input;
});
for (let warmup=0;warmup<24;warmup++) allocateLiquidityRoute(cases[warmup%cases.length]);
const samples: { milliseconds: number;scenario: number;metrics: ReturnType<typeof allocateLiquidityRoute>['metrics'] }[] = [];
for (let iteration=0;iteration<1000;iteration++) {
  const scenario = iteration%cases.length,start = performance.now(),result = allocateLiquidityRoute(cases[scenario]);
  samples.push({ milliseconds: performance.now()-start,scenario,metrics: result.metrics });
}
const durations = samples.map(sample => sample.milliseconds).sort((left,right) => left-right);
const p95 = durations[949],p99 = durations[989];
const report = { revision: execFileSync('git',['rev-parse','HEAD'],{ encoding: 'utf8' }).trim(),
  trackedDirty: execFileSync('git',['status','--porcelain','--untracked-files=no'],{ encoding: 'utf8' }).trim() !== '',
  host: { model: cpus()[0].model,logicalCpus: cpus().length,platform: platform(),architecture: arch(),node: process.version },
  warmup: 24,iterations: samples.length,p95,p99,max: durations.at(-1),
  maxCompositions: Math.max(...samples.map(sample => sample.metrics.compositions)),
  maxQuantityQuotes: Math.max(...samples.map(sample => sample.metrics.quantityQuotes)),
  maxTraderAdmissionChecks: Math.max(...samples.map(sample => sample.metrics.traderAdmissionChecks)),samples };
if (process.env.RIVALT_BENCHMARK_REPORT) writeFileSync(process.env.RIVALT_BENCHMARK_REPORT,JSON.stringify(report,null,2)+'\n');
assert(p95 <= 250 && p99 <= 500,'P31 search latency gate');
assert.equal(report.maxCompositions,12288);assert.equal(report.maxQuantityQuotes,12288);assert.equal(report.maxTraderAdmissionChecks,12288);
console.log(JSON.stringify({ ...report,samples: undefined }));
