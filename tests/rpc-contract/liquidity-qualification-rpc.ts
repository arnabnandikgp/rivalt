// Fresh P34 300-second G22 comparison. All offered opportunities remain in the
// denominator; injected faults do not become discarded benchmark observations.
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cpus, release } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import type { Instruction, ReadonlyUint8Array } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { eventPayloads } from '../../packages/indexer/src/events.js';
import { openCanonicalRpcHarness } from './canonical-rpc-harness.js';
import { qualificationSetup } from './liquidity-qualification-setup.js';
import {qualificationServices} from './liquidity-qualification-services.js';
import { depletionSupplement } from './liquidity-continuation-depletion.js';
import { candidates, referenceAllocation, referenceQuote, auditFill, type Candidate, type Profile } from './liquidity-continuation-model.js';

const runDir = process.env.RIVALT_RUN_DIR!, profile = process.env.RIVALT_CONTINUATION_PROFILE as Profile;
assert(['baseline', 'control', 'treatment'].includes(profile));
const json = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(), '', 'Pin a clean client before comparison');
const build = JSON.parse(readFileSync(`${process.env.RIVALT_ARTIFACT_DIR}/build-manifest.json`, 'utf8'));
const has = (instructions: readonly unknown[], discriminator: ReadonlyUint8Array) => (instructions as Instruction[])
  .some(instruction => Buffer.from(instruction.data ?? []).subarray(0, 8).equals(Buffer.from(discriminator)));
const transport = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!, process.env.RIVALT_WS_URL!, runDir, {
  deferFinality: true, observeOutcomes: label => label.startsWith('offered route ') || label === 'continuation publisher reports',
  computeUnitLimit: (label, instructions) => has(instructions, sdk.SAMPLE_ACCOUNT_ORACLE_DISCRIMINATOR) ? 1_200_000
    : label.startsWith('offered route ') || label === 'supplement stale structural route' || label.startsWith('supplement route ') ? (profile === 'baseline' ? 600_000 : 800_000)
    : label.includes('publisher') ? 200_000 : label === 'continuation reprice batch' ? 600_000 : 400_000,
  maxLoadedAccounts: label => label.includes('publisher') ? 20 : 32,
});
const {h,rpc,ws,checks,flush}=transport;
let services:Awaited<ReturnType<typeof qualificationServices>>|undefined;
type Offer = {
  index: number; dueMs: number; startedMs: number; lagMs: number; window: string;
  trader: import('@solana/kit').Address; marketIndex:0|1; mode:'isolated'|'cross'; sourceModes:string[]; requiredMarkets:number[]; buildMs:number; side: 0 | 1; lots: bigint; source: string; eligible: boolean; quoted: boolean; attempted: boolean;
  reason: string | null; makers: Candidate[]; roots: sdk.AccountSnapshot['roots'];
  allocation?: { grossQuote: bigint; fee: bigint; allIn: bigint; legs: { instance: number; lots: bigint }[] };
  markouts?:{horizonSeconds:number;observedAfterMs:number;referencePrice:bigint;sourceMode:string}[]; landedGross?:bigint; quoteDriftAtoms?:bigint; after?: sdk.MarginAccount[]; finalError?: unknown; signedToConfirmedMs?: unknown;
};
const offers: Offer[] = [], schedules: { task: string; tick: number; dueMs: number; lagMs: number }[] = [];
const horizonReads:Promise<void>[]=[];
let backgroundError: unknown;
try {
  const setup = await qualificationSetup(h, rpc, profile);
  await flush();
  const initial = await Promise.all(setup.allRoots.map(async key => sdk.getMarginAccountDecoder().decode((await h.read(key))!)));
  services=await qualificationServices(setup,transport,profile,runDir);
  const start = performance.now() + 250;
  const inWindow = (time: number, lower: number, upper: number) => time >= lower && time < upper;
  const window = (time: number) => inWindow(time, 30_000, 38_000) ? 'source-pause'
    : inWindow(time, 60_000, 68_000) ? 'updater-pause' : inWindow(time, 90_000, 98_000) ? 'quarantine' : 'ordinary';
  async function schedule(task: string, interval: number, work: (tick: number) => Promise<void>) {
    for (let tick = 0; tick * interval < 300_000; tick++) {
      const dueMs = tick * interval;
      await delay(Math.max(0, start + dueMs - performance.now()));
      if (backgroundError) return;
      schedules.push({ task, tick, dueMs, lagMs: Math.max(0, performance.now() - start - dueMs) });
      try { await work(tick); } catch (error) { backgroundError = error; return; }
    }
  }
  const tasks = [
    schedule('sources', 2000, async tick => { if (!inWindow(tick * 2000, 30_000, 38_000)) await setup.sources(); }),
    schedule('incidents', 1000, async tick => {if(tick===150)await services!.restartWorker();if(tick===225)await services!.restartIndexer();}),
    schedule('updater', 500, async tick => {
      if (tick === 180) await setup.quarantine(false);
      if (tick === 196) await setup.quarantine(true);
      if (!inWindow(tick * 500, 60_000, 68_000)) await setup.reprice(tick);
    }),
    schedule('offers', 500, async index => {
      await services!.operation(index);
      const startedMs = performance.now() - start, cycle=index%8, marketIndex=(Math.floor(cycle/2)%2) as 0|1;
      const mode=cycle<4?'isolated':'cross',trader=mode==='isolated'?setup.isolated[marketIndex]:setup.cross;
      const snapshot=await setup.read(trader,marketIndex),side=(index%2) as 0|1,lots=[1n,2n,4n,8n,16n][Math.floor(index/8)%5];
      const model=candidates(snapshot,profile,marketIndex),source=sdk.accountSourceMode(snapshot.safetyState,snapshot.marketStates[marketIndex],snapshot.now,snapshot.slot);
      const root=snapshot.roots[trader];
      assert(root.book.orders.every(entry=>![1,2].includes(entry.order.state)),'Timed roots have no fixture-owned live orders');
      const sourceModes=snapshot.marketStates.map(market=>sdk.accountSourceMode(snapshot.safetyState,market,snapshot.now,snapshot.slot));
      const requiredMarkets=[0,1].filter(index=>index===marketIndex||root.positions[index].lots!==0n);
      const blockedMarket=requiredMarkets.find(index=>sourceModes[index]!=='Normal');
      const expected = referenceAllocation(model, side, lots);
      const offer: Offer = { index, dueMs: index * 500, startedMs, lagMs: Math.max(0, startedMs - index * 500),
        window: window(index * 500),trader,marketIndex,mode,sourceModes,requiredMarkets,buildMs:0, side, lots, source, eligible: blockedMarket===undefined && expected !== null,
        quoted: false, attempted: false, reason: blockedMarket!==undefined ? `required-market-${blockedMarket}-${sourceModes[blockedMarket]}` : expected ? null
          : `liquidity:${model.map(maker => maker.reason ?? 'capacity').join(',')}`, makers: model, roots: snapshot.roots };
      offers.push(offer);
      if (offer.eligible) {
        const input = { snapshot, trader, marketIndex, side, lots,
          reduceOnly: false, maxFee: 10_000n, allInLimit: side === 0 ? 2_000_000n : 0n };
        const quote = profile === 'baseline' ? await sdk.buildAccountRoute(input, setup.owner.address)
          : await sdk.buildLiquidityRoute(input, setup.owner.address);
        assert(quote && expected, 'Independent funded fixture has a feasible route');
        const allocation = { ...quote.allocation, legs: quote.allocation.legs.map(leg => ({
          instance: 'instance' in leg ? leg.instance : leg.makerId, lots: leg.lots })) };
        assert.equal(allocation.grossQuote, expected.grossQuote, 'Independent exact best-pair gross');
        assert.equal(allocation.fee, expected.fee);
        assert.deepEqual(allocation.legs, expected.legs.map(({ instance, lots }) => ({ instance, lots })), 'Exact deterministic optimum');
        offer.allocation = allocation; offer.quoted = true; offer.attempted = true;offer.buildMs=performance.now()-start-startedMs;
        await h.send(`offered route ${index}`, quote.instructions.filter(instruction => instruction.programAddress !== sdk.routeComputeBudget().programAddress), [setup.owner]);
        const landedAt=performance.now();offer.markouts=[];
        for(const horizonSeconds of [2,10])horizonReads.push((async()=>{await delay(horizonSeconds*1000);const snapshot=await services!.client.snapshot([trader],'confirmed');
          offer.markouts!.push({horizonSeconds,observedAfterMs:performance.now()-landedAt,referencePrice:snapshot.marketStates[marketIndex].referencePrice,
            sourceMode:sdk.accountSourceMode(snapshot.safetyState,snapshot.marketStates[marketIndex],snapshot.now,snapshot.slot)});})().catch(error=>{backgroundError??=error;}));
        offer.after = await Promise.all([trader, ...model.map(maker => maker.capital as typeof setup.trader)]
          .map(async key => sdk.getMarginAccountDecoder().decode((await h.read(key))!)));
      }
      appendFileSync(`${runDir}/offers.ndjson`, JSON.stringify(offer, (_, item) => typeof item === 'bigint' ? item.toString() : item) + '\n');
    }),
  ];
  await Promise.all(tasks);
  if (backgroundError) throw backgroundError;
  await delay(Math.max(0, start + 300_000 - performance.now()));
  const elapsedMs = performance.now() - start;
  await Promise.all(horizonReads);if(backgroundError)throw backgroundError;
  await services.pause();await flush();
  const serviceReport=await services.report();
  // Preserve complete measured inputs before offline audits; a reader correction
  // must not require repeating an otherwise unchanged live workload.
  writeFileSync(`${runDir}/comparison-capture.json`,json({revision,build,profile,seed:2902,elapsedMs,offers,schedules,checks,initial,serviceReport}));
  assert.equal(offers.length, 600, 'Complete offered population');
  assert(elapsedMs < 305_000, 'Bounded schedule must not silently become a slower workload');
  const publisherRejections = checks.filter(check => check.label === 'continuation publisher reports' && check.error);
  for (const check of publisherRejections) {
    const error = check.error as { InstructionError: [number, { Custom: number }] };
    assert([sdk.CLEARING_ERROR__ORACLE_POLICY, sdk.CLEARING_ERROR__FUNDING_REPORT].includes(error.InstructionError?.[1]?.Custom),
      'Only explicit stale/timing/report fences are recoverable by the next scheduled fresh report');
  }

  // Independently decode finalized event payloads. Anchors are keyed by the exact
  // landed sequence, so repricing between quote and landing is not a discrepancy.
  const anchors = new Map<string, bigint>();
  for (let index = 0; index < checks.length; index++) {
    const transaction = JSON.parse(readFileSync(`${runDir}/transaction-${index}.json`, 'utf8'));
    if (!setup.canonical || transaction.meta.err) continue;
    for (const maker of [setup.canonical.instances[0], setup.canonical.instances[2]]) {
      for (const { payload } of eventPayloads(String(checks[index].signature), transaction, maker.makerCommon.eventAuthority, maker.pricingProgram)) {
        if (!payload.subarray(0, 8).equals(Buffer.from(sdk.makerA.MAKER_PRICE_UPDATED_EVENT_DISCRIMINATOR))) continue;
        const value = sdk.makerA.getMakerPriceUpdatedEventDecoder().decode(payload);
        anchors.set(`${value.config}/${value.sequence}`, value.anchor);
      }
    }
  }
  let totalFees = 0n, finalized = 0;const marketFees=[0n,0n];
  for (const offer of offers.filter(value => value.attempted)) {
    const index = checks.findIndex(check => check.label === `offered route ${offer.index}`), check = checks[index];
    assert(check, 'Every attempted offer has finalized independent evidence');
    offer.finalError = check.error; offer.signedToConfirmedMs = check.signedToConfirmedMs;
    const transaction = JSON.parse(readFileSync(`${runDir}/transaction-${index}.json`, 'utf8'));
    if (transaction.meta.err) {
      offer.reason = `onchain:${JSON.stringify(transaction.meta.err)}`;
      for (const after of offer.after!) {
        const before = Object.values(offer.roots).find(root => root.id === after.id)!;
        assert.deepEqual(sdk.getMarginAccountEncoder().encode(after), sdk.getMarginAccountEncoder().encode(before), 'Rejected timed route is financially atomic');
      }
      continue;
    }
    finalized++;
    const payloads = eventPayloads(String(check.signature), transaction, setup.common.eventAuthority);
    const event = profile === 'baseline'
      ? payloads.map(value => value.payload).find(payload => payload.subarray(0, 8).equals(Buffer.from(sdk.ACCOUNT_ROUTE_EXECUTED_EVENT_DISCRIMINATOR)))
      : payloads.map(value => value.payload).find(payload => payload.subarray(0, 8).equals(Buffer.from(sdk.LIQUIDITY_ROUTE_EXECUTED_EVENT_DISCRIMINATOR)));
    assert(event);
    const decoded = profile === 'baseline' ? sdk.getAccountRouteExecutedEventDecoder().decode(event) : sdk.getLiquidityRouteExecutedEventDecoder().decode(event);
    const actualLegs = 'legs' in decoded ? decoded.legs.map(leg => {
      const maker = offer.makers.find(candidate => candidate.instance === leg.instance)!;
      const anchor = anchors.get(`${maker.config}/${leg.priceSequence}`); assert(anchor !== undefined);
      assert.equal(leg.consumedBefore, offer.side === 0 ? maker.buyConsumed : maker.sellConsumed);
      assert.equal(leg.consumedAfter, leg.consumedBefore + leg.lots);
      const gross = referenceQuote({ ...maker, anchor }, offer.side, leg.lots); assert.equal(gross, leg.gross);
      return { instance: leg.instance, lots: leg.lots, gross: leg.gross };
    }) : offer.allocation!.legs.map(leg => ({ ...leg, gross: referenceQuote(offer.makers.find(maker => maker.instance === leg.instance)!, offer.side, leg.lots)! }));
    const gross = actualLegs.reduce((sum, leg) => sum + leg.gross, 0n), fee = (gross + 4999n) / 5000n;
    offer.landedGross=gross;offer.quoteDriftAtoms=gross-offer.allocation!.grossQuote;
    assert.equal(decoded.grossQuote, gross); assert.equal(decoded.fee, fee); totalFees += fee;marketFees[offer.marketIndex]+=fee;
    assert.equal(decoded.insuranceCredit, (fee + BigInt(decoded.carryBefore)) / 4n);
    assert.equal(BigInt(decoded.carryAfter), (fee + BigInt(decoded.carryBefore)) % 4n);
    auditFill(offer.roots[offer.trader], decoded.rootStates[0], offer.side, offer.lots, gross, fee, true,offer.marketIndex);
    for (const leg of actualLegs) {
      const maker = offer.makers.find(candidate => candidate.instance === leg.instance)!, before = offer.roots[maker.capital as typeof setup.trader];
      auditFill(before, decoded.rootStates.find(root => root.id === before.id)!, offer.side, leg.lots, leg.gross, 0n, false,offer.marketIndex);
    }
  }
  const finalRoots = await Promise.all(setup.allRoots.map(async key => sdk.getMarginAccountDecoder().decode((await h.read(key))!)));
  const markets = await Promise.all(setup.markets.map(async key => sdk.getMarketDecoder().decode((await h.read(key))!)));
  for (const marketIndex of [0, 1]) {
    assert.equal(finalRoots.reduce((sum, root) => sum + root.positions[marketIndex].lots, 0n), 0n);
    assert.equal(finalRoots.reduce((sum, root) => { const position = root.positions[marketIndex];
      return sum + position.virtualScaled - position.lots * (markets[marketIndex].fundingIndexScaled - position.fundingCheckpointScaled); }, 0n), 0n);
  }
  const cash = finalRoots.reduce((sum, root) => sum + root.cash, 0n);
  const journalFees=[0n,0n];
  for(const event of serviceReport.journal)if(['LiquidityRouteExecutedV4','AccountRouteExecutedV3'].includes(event.kind)){
    const marketIndex=setup.markets.indexOf(event.payload.market);assert(marketIndex===0||marketIndex===1);journalFees[marketIndex]+=BigInt(event.payload.fee);
  }
  assert.equal(cash+journalFees[0]+journalFees[1]+2n,initial.reduce((sum,root)=>sum+root.cash,0n));
  const ledgers=await Promise.all(setup.ledgers.map(async key=>sdk.getMarketLedgerDecoder().decode((await h.read(key))!)));
  ledgers.forEach((ledger,index)=>{assert.equal(ledger.insurance,journalFees[index]/4n);assert.equal(ledger.fees,journalFees[index]-journalFees[index]/4n);assert.equal(BigInt(ledger.insuranceFeeRemainder),journalFees[index]%4n);});
  assert.equal(journalFees[1],marketFees[1]);assert(journalFees[0]>marketFees[0],'Actual order-worker fills contribute separate fees');
  if(setup.canonical)await setup.canonical.qualify();
  const strictEpochRejections = await setup.strictEpochs();
  const depletion = profile === 'treatment' ? await depletionSupplement(h, setup.canonical!,setup.allRoots) : [];
  await flush();
  if (profile !== 'baseline') assert(setup.repricesAfterConsumption() >= 20);
  const eligible = offers.filter(offer => offer.eligible).length;
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),revision);
  assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
  const summary = { revision, trackedDirty: false, build, profile, seed: 2902,
    host: { cpu: cpus()[0].model, os: release(), node: process.version }, elapsedMs, offers, schedules, checks,
    denominators: { offered: offers.length, eligible, quoted: offers.filter(offer => offer.quoted).length,
      attempted: offers.filter(offer => offer.attempted).length, submitted: offers.filter(offer => offer.attempted).length, finalized },
    totalFees, fundedCash: cash, initial, finalRoots, markets, ledgers,marketFees,journalFees,serviceReport, strictEpochRejections, depletion, publisherRejections,
    financialSnapshotScope: 'timed 600-offer workload with two stored fills and two funded exits before structural/depletion supplements',
    repricesAfterConsumption: setup.repricesAfterConsumption(), unexpectedFinancialDifferences: 0,
    independentMakers: false, hedges: 'none; no hedge cost or profitability inference', phaseAcceptance: false };
  writeFileSync(`${runDir}/summary.json`, json(summary));
  console.log(`P34 ${profile}: ${offers.length} offered / ${eligible} eligible / ${finalized} finalized successful routes.`);
} finally { await services?.close();try { await flush(); } finally { ws.close(); } }
