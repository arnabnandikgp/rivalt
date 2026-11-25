import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';
import {routerBuild} from './execution-router-build.js';

const directory = process.env.RIVALT_RUN_DIR!;
const build = routerBuild();
let afterSignature: (()=>Promise<void>)|undefined;
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,
  process.env.RIVALT_WS_URL!,directory,{
    deferFinality:true,
    computeUnitLimit:label=>label.startsWith('wide wallet')?800_000:undefined,
    heapSize:label=>label.startsWith('wide wallet')?128*1024:undefined,
    beforeBroadcast:async label=>{
      if(label==='wide wallet ETH reprice'){
        assert(afterSignature);
        await afterSignature();
        afterSignature=undefined;
      }
    },
  });
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined;
try {
  const counts=[16,32] as const;
  const shape=(instance:number)=>{
    const regions=symmetricPayoutShape.asks.map((row,index)=>index===0?{...row,offset:70n-2n*BigInt(instance)}:row);
    return {...symmetricPayoutShape,asks:regions,bids:regions};
  };
  const setup=await liquidityExecutionSetup(h,rpc,{makerCounts:counts,shape,makerCash:500_000_000n,
    traderCash:500_000_000n,traderCount:1,marketCheckpoints:true,marginLayout:'ledger-lanes',verifyRejections:false});
  const trader=setup.roots[0],actor=setup.traderOwner;
  const order=async (marketIndex:0|1,limit:bigint)=>sdk.buildBestRoute({snapshot:await setup.snapshot(trader,marketIndex),
    trader,marketIndex,side:0,lots:100n,allInLimit:limit,maxFee:2_000n},actor.address);
  const results=[];
  for(const marketIndex of [0,1] as const){
    await setup.sample();
    const makers=setup.instances.filter(maker=>maker.market===setup.markets[marketIndex]);
    const before=await Promise.all(makers.map(maker=>maker.registrationState()));
    const selection=await order(marketIndex,marketIndex===0?6_020_000n:3_020_000n);
    assert.deepEqual(selection.candidateInstances,marketIndex===0?[13,14,15]:[29,30,31]);
    const winner=marketIndex===0?15:30;
    const gross=marketIndex===0?6_004_000n:3_000_600n;
    if(marketIndex===1)afterSignature=async()=>{
      await makers[30].publish(setup.updater,29_996n);
      // The wallet has already signed. Maker 12 now offers an even cheaper
      // price outside the supplied accounts. Clearing can only choose 29/30/31.
      await makers[12].publish(setup.updater,29_940n);
    };
    const label=marketIndex===0?'wide wallet BTC fill':'wide wallet ETH reprice';
    await h.send(label,selection.instructions,[actor]);
    const after=await Promise.all(makers.map(maker=>maker.registrationState()));
    assert.deepEqual(after.map((row,index)=>row.buyConsumed-before[index].buyConsumed),
      makers.map((_,index)=>index===winner?100n:0n));
    const state=await setup.snapshot(trader,marketIndex);
    const position=state.roots[trader].positions[marketIndex];
    assert.equal(position.lots,100n);
    assert.equal(position.virtualScaled,-gross*1_000_000_000n);
    const fee=(gross+4999n)/5000n;
    results.push({marketIndex,registered:makers.length,candidates:selection.candidateInstances,winner,gross,fee,label});
    assert.equal(state.roots[trader].cash,500_000_000n-results.reduce((sum,row)=>sum+row.fee,0n));
  }
  await setup.sample();
  const refused=await order(1,1n);
  const keys=[trader,...setup.markets,...setup.ledgers,...setup.instances.flatMap(maker=>[maker.capital,maker.registration])];
  const capture=()=>Promise.all(keys.map(key=>h.read(key)));
  const before=await capture();
  await h.send('wide wallet limit rollback',refused.instructions,[actor],sdk.CLEARING_ERROR__ROUTE_HEALTH);
  assert.deepEqual(await capture(),before);
  await setup.sample();
  const explicit=await sdk.buildLiquidityRoute({snapshot:await setup.snapshot(trader,0),trader,marketIndex:0,
    side:1,lots:1n,allInLimit:59_940n,maxFee:15n},actor.address);
  assert(explicit);
  assert.deepEqual(explicit.allocation.legs.map(leg=>leg.instance),[15]);
  assert.equal(explicit.allocation.grossQuote,59_960n);
  assert.equal(explicit.allocation.fee,12n);
  const instruction=explicit.instructions[0],known=await sdk.venueMarketCheckpoints(setup.venue);
  const prefix=sdk.marketCheckpointsFor(known,instruction);
  const extra=instruction.accounts.at(-1)!;
  assert.equal(extra.address,setup.instances[0].registration);
  const foreign={...instruction,accounts:[...instruction.accounts.slice(0,-1),{...extra,address:setup.instances[1].registration}]};
  const beforeForeign=await capture();
  await h.send('wide wallet refuses substituted fee lane',[...prefix,foreign],[actor],sdk.CLEARING_ERROR__MAKER_BINDING);
  assert.deepEqual(await capture(),beforeForeign);
  await h.send('wide wallet signed explicit reduction',[...prefix,instruction],[actor]);
  assert.equal((await setup.snapshot(trader,0)).roots[trader].positions[0].lots,99n);
  assert.equal((await setup.instances[15].registrationState()).sellConsumed,1n);
  await flush();
  journal=await openSettlementJournal(rpc,setup,checks.map(row=>String(row.signature)),build);
  await journal.checkpoint('wide-fills',true);
  const replay=await journal.finish();
  writeFileSync(directory+'/wide-fills.json',json({build,results,events:replay.events,
    transactions:checks.filter(row=>String(row.label).startsWith('wide wallet')),reconciliation:replay.reconciliation}));
  console.log(results,replay.events,'replayed events');
} finally {
  await journal?.close();
  try {await flush();} finally {ws.close();}
}
