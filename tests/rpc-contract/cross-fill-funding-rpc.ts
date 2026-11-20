// A BTC fill on a cross account advances the ETH funding prefix even though it
// quotes no ETH maker. Compare the subsequent gap with the last ETH-only fill.
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
const checked=process.env.RIVALT_SETTLEMENT_PROBE==='profit-attribution-checked-funding';
const build=verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!,false,false,false,false,checked?'funding':'market');
const {h,rpc,ws,flush,checks}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,{deferFinality:true});
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined;
try {
  // Bid one tick below the reference and ask five above it. This yields an
  // independently calculable positive funding premium of two ticks per lot.
  const regions=(offset:bigint)=>symmetricPayoutShape.bids.map((region,index)=>index===0?{...region,offset}:region);
  const shape={...symmetricPayoutShape,bids:regions(1n),asks:regions(5n)};
  const setup=await liquidityExecutionSetup(h,rpc,{marginLayout:checked?'checked-funding':'bounded-market',shape,traderCount:1,verifyRejections:false});
  const {root,route}=executionTestHelpers(h,setup);
  const trader=setup.roots[0],actor=setup.traderOwner;
  await setup.sample();
  const anchor=await setup.marketState(1);
  const btcAnchor=await setup.marketState(0);
  const observation=anchor.oracle;
  assert.equal(observation.premiumScaled,2_000_000_000n);
  const single=await route({trader,actor,marketIndex:1,side:0,lots:[1n],makers:[setup.instances[3]],minimalMarkets:true});
  await h.send('open ETH on the cross account',[single],[actor]);
  const ethOnly=await setup.marketState(1),prior=(await root(trader)).positions[1];
  assert.equal(prior.lots,1n);
  assert.equal(ethOnly.observationSequence,anchor.observationSequence);

  await setup.waitUntil(ethOnly.fundingTime+2n);
  await setup.fresh();
  const cross=await route({trader,actor,marketIndex:0,side:0,lots:[1n],makers:[setup.instances[0]],minimalMarkets:true});
  assert(cross.accounts.some(meta=>meta.address===setup.markets[1]));
  assert(setup.instances.slice(3).every(maker=>!cross.accounts.some(meta=>meta.address===maker.registration)));
  await h.send('BTC fill materializes ETH funding',[cross],[actor]);
  const ethAfterBtc=await setup.marketState(1),after=(await root(trader)).positions[1];
  const through=ethAfterBtc.fundingTime;
  assert.equal(ethAfterBtc.observationSequence,anchor.observationSequence);
  assert(through>ethOnly.fundingTime&&through<=observation.heldUntil);
  const expected=observation.fundingBase+2_000_000_000n*(through-observation.sampledAt)/3_600n;
  assert.equal(ethAfterBtc.fundingIndexScaled,expected);
  assert.equal(after.fundingCheckpointScaled,expected);
  assert.equal(after.virtualScaled,prior.virtualScaled-prior.lots*(expected-prior.fundingCheckpointScaled));
  assert.notEqual(ethOnly.fundingIndexScaled,expected);

  // The real Clock, expired observations and refreshed signed price sources
  // exercise the same gap policy as normal publication.
  await setup.waitUntil(observation.sampledAt+16n);
  await setup.waitUntil(observation.sampledAt+31n);
  const btcAfterFill=await setup.marketState(0);
  if(checked){
    const stamp=async(key:typeof trader)=>sdk.decodeFundingTouch((await h.read(key))!.subarray(-32));
    const ethLane=await stamp(setup.instances[3].registration);
    const ethCanonical=await stamp(setup.markets[1]);
    const btcLane=await stamp(setup.instances[0].registration);
    assert(ethLane && ethCanonical && btcLane);
    assert.equal(ethLane.observation,anchor.observationSequence);
    assert.equal(ethLane.timestamp,ethOnly.fundingTime);
    assert.equal(ethCanonical.timestamp,through);
    assert.equal(btcLane.observation,btcAnchor.observationSequence);
    assert.equal(btcLane.timestamp,btcAfterFill.fundingTime);
    assert(btcAfterFill.fundingTime>btcAnchor.oracle.sampledAt);
    const btcCanonical=await stamp(setup.markets[0]);
    assert(!btcCanonical||btcCanonical.observation<btcLane.observation||btcCanonical.slot<btcLane.slot);
    await setup.sample([0,1],true);
    const btcRecovered=await setup.marketState(0);
    assert.equal(btcRecovered.oracle.outcome,3);
    assert.equal(btcRecovered.oracle.fundingBase,btcAnchor.oracle.fundingBase+
      btcAnchor.oracle.premiumScaled*(btcAfterFill.fundingTime-btcAnchor.oracle.sampledAt)/3600n);
    assert.equal(btcRecovered.oracle.fundingBase,btcAfterFill.fundingIndexScaled);
  }else await setup.sample([1]);
  const recovered=await setup.marketState(1);
  assert.equal(recovered.oracle.outcome,3);
  assert.equal(recovered.oracle.fundingBase,expected);
  assert.equal(recovered.fundingIndexScaled,expected);
  assert.equal(recovered.oracle.coveredSeconds-observation.coveredSeconds,through-observation.sampledAt);
  assert.equal(recovered.oracle.skippedSeconds-observation.skippedSeconds,recovered.oracle.sampledAt-through);
  await flush();
  journal=await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),build);
  await journal.checkpoint('cross-market-funding',true);
  const replay=await journal.finish();
  const result={revision,sbf:build.revision,premium:observation.premiumScaled,base:observation.fundingBase,
    lastEthFill:ethOnly.fundingIndexScaled,afterBtcFill:expected,recovered:recovered.oracle.fundingBase,
    covered:through-observation.sampledAt,skipped:recovered.oracle.sampledAt-through,
    outcomes:checks.length,events:replay.events,btcFill:checks.find(check=>check.label==='BTC fill materializes ETH funding')};
  writeFileSync(directory+'/cross-market-funding.json',json(result));
  console.log(json(result));
} finally {await journal?.close();try{await flush();}finally{ws.close();}}
