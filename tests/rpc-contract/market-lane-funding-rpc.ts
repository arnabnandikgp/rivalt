// Nonzero funding on the read-only route, serial cross-account fallback, then
// a publication gap after a fill whose earned prefix lives only on a maker.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {verifyProfitBuild} from './profit-attribution-build.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const directory=process.env.RIVALT_RUN_DIR!;
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const integrated=process.env.RIVALT_SETTLEMENT_PROBE==='profit-attribution-integrated-funding';
const successor=process.env.RIVALT_SETTLEMENT_PROBE==='profit-attribution-successor-funding';
const ledgerLanes=successor||integrated||process.env.RIVALT_SETTLEMENT_PROBE==='profit-attribution-ledger-funding';
const build=verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!,false,false,false,false,successor?'successor':integrated?'integrated':ledgerLanes?'ledger':'lane');
const {h,rpc,ws,flush,checks}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,{deferFinality:true});
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined;
try {
  const regions=(offset:bigint)=>symmetricPayoutShape.bids.map((region,i)=>i===0?{...region,offset}:region);
  const setup=await liquidityExecutionSetup(h,rpc,{marginLayout:ledgerLanes?'ledger-lanes':'market-lanes',marketCheckpoints:true,
    independentTraders:true,traderCount:2,shape:{...symmetricPayoutShape,bids:regions(1n),asks:regions(5n)},verifyRejections:false});
  const {root,route,withCheckpoints}=executionTestHelpers(h,setup);
  async function openLocal(marketIndex:0|1,traderIndex:number,makerIndex:number) {
    const trader=setup.roots[traderIndex],actor=setup.traderOwners[traderIndex],maker=setup.instances[makerIndex];
    const physical=await h.read(setup.markets[marketIndex]),anchor=await setup.marketState(marketIndex);
    assert.equal(anchor.oracle.premiumScaled,2_000_000_000n,'bid -1 and ask +5 imply midpoint +2');
    await setup.waitUntil(anchor.oracle.sampledAt+1n);
    const trade=await route({marketIndex,trader,actor,side:0,lots:[1n],makers:[maker],minimalMarkets:true,marketLane:true});
    await h.send(marketIndex===1?'ETH read-only fill with nonzero funding':'BTC read-only fill before gap',[trade],[actor]);
    assert.deepEqual(await h.read(setup.markets[marketIndex]),physical);
    const offset=sdk.getMakerRegistrationDecoder().fixedSize+32;
    const stamp=sdk.decodeFundingTouch((await h.read(maker.registration))!.subarray(offset,offset+32));
    assert(stamp&&stamp.observation===anchor.observationSequence&&stamp.timestamp>anchor.oracle.sampledAt&&stamp.timestamp<=anchor.oracle.heldUntil);
    const expected=anchor.oracle.fundingBase+2_000_000_000n*(stamp.timestamp-anchor.oracle.sampledAt)/3600n;
    const actual=(await root(trader)).positions[marketIndex];
    assert.equal(actual.fundingCheckpointScaled,expected);
    const snapshot=await sdk.readAccountSnapshot(rpc,setup.identity,[trader],'confirmed');
    assert.deepEqual([snapshot.marketStates[marketIndex].fundingIndexScaled,snapshot.marketStates[marketIndex].grossLots],
      [expected,anchor.grossLots+2n]);
    return {anchor,stamp,expected,actual};
  }
  await setup.sample();
  const eth=await openLocal(1,0,3);
  const trader=setup.roots[0],actor=setup.traderOwners[0];
  const input={marketIndex:0 as const,trader,actor,side:0 as const,lots:[1n],makers:[setup.instances[0]],minimalMarkets:true};
  await h.send('single-market instruction refuses ETH exposure on a BTC fill',[await route({...input,marketLane:true})],[actor],sdk.CLEARING_ERROR__PROFILE);
  assert.deepEqual((await root(trader)).positions[1],eth.actual);
  await setup.waitUntil(eth.stamp.timestamp+1n);
  await setup.fresh();
  await h.send('atomic full route settles the sibling ETH position',await withCheckpoints(await route(input)),[actor]);
  const sibling=await setup.marketState(1),settled=(await root(trader)).positions[1];
  const expectedEth=eth.anchor.oracle.fundingBase+2_000_000_000n*(sibling.fundingTime-eth.anchor.oracle.sampledAt)/3600n;
  assert(sibling.fundingTime>eth.stamp.timestamp&&sibling.fundingTime<=eth.anchor.oracle.heldUntil);
  assert.deepEqual([settled.fundingCheckpointScaled,settled.virtualScaled],
    [expectedEth,eth.actual.virtualScaled-eth.actual.lots*(expectedEth-eth.expected)]);

  await setup.sample();
  const btc=await openLocal(0,1,1);
  await setup.waitUntil(btc.anchor.oracle.sampledAt+16n);
  await setup.waitUntil(btc.anchor.oracle.sampledAt+31n);
  await setup.sample();
  const recovered=await setup.marketState(0);
  assert.equal(recovered.oracle.outcome,3);
  assert.deepEqual([recovered.oracle.fundingBase,recovered.fundingIndexScaled],[btc.expected,btc.expected]);
  assert.equal(recovered.oracle.coveredSeconds-btc.anchor.oracle.coveredSeconds,btc.stamp.timestamp-btc.anchor.oracle.sampledAt);
  assert.equal(recovered.oracle.skippedSeconds-btc.anchor.oracle.skippedSeconds,recovered.oracle.sampledAt-btc.stamp.timestamp);
  // Cross zero from +1 to -1 with two distinct makers. Both receive one
  // lot and the first registration records the aggregate taker fee exactly once.
  await setup.qualify();
  const secondTrader=setup.roots[1],owner=setup.traderOwners[1],makers=[setup.instances[0],setup.instances[1]];
  const beforeTrader=await root(secondTrader);
  assert.equal(beforeTrader.positions[0].lots,1n);
  const makerBefore=await Promise.all(makers.map(maker=>root(maker.capital)));
  const feeBefore=await Promise.all(makers.map(async maker=>sdk.decodeMakerFeeLane((await h.read(maker.registration))!,ledgerLanes?'ledger-lanes':'checked-funding').collected));
  const marketBefore=await h.read(setup.markets[0]);
  await h.send('two-maker read-only route crosses zero',[await route({trader:secondTrader,actor:owner,marketIndex:0,
    side:1,lots:[1n,1n],makers,minimalMarkets:true,marketLane:true})],[owner]);
  assert.deepEqual(await h.read(setup.markets[0]),marketBefore);
  const afterTrader=await root(secondTrader);
  const fee=24n; // Two BTC lots at 59,999 each, ceil(119,998 * 2 / 10,000).
  assert.deepEqual([afterTrader.positions[0].lots,afterTrader.cash],[-1n,beforeTrader.cash-fee]);
  for(const [i,maker] of makers.entries()){
    const next=await root(maker.capital);
    assert.deepEqual([next.positions[0].lots,next.cash],[makerBefore[i].positions[0].lots+1n,makerBefore[i].cash]);
    const lane=sdk.decodeMakerFeeLane((await h.read(maker.registration))!,ledgerLanes?'ledger-lanes':'checked-funding');
    assert.equal(lane.collected-feeBefore[i],i===0?fee:0n);
  }
  const projected=await sdk.readAccountTradeSnapshot(rpc,setup.identity,secondTrader,0,'confirmed');
  const positions=await Promise.all([...setup.roots,...setup.instances.map(maker=>maker.capital)].map(root));
  assert.equal(projected.marketStates[0].grossLots,positions.reduce((sum,member)=>{
    const lots=member.positions[0].lots;return sum+(lots<0n?-lots:lots);
  },0n));
  await flush();
  journal=await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),build);
  await journal.checkpoint('market-lane-gap',true);
  const replay=await journal.finish();
  const result={revision,sbf:build.revision,ethOpen:eth.expected,ethAfterCross:expectedEth,btcBeforeGap:btc.expected,
    btcAfterGap:recovered.fundingIndexScaled,covered:btc.stamp.timestamp-btc.anchor.oracle.sampledAt,
    skipped:recovered.oracle.sampledAt-btc.stamp.timestamp,outcomes:checks.length,events:replay.events};
  writeFileSync(directory+'/market-lane-funding.json',json(result));
  console.log(json(result));
}finally{await journal?.close();try{await flush();}finally{ws.close();}}
