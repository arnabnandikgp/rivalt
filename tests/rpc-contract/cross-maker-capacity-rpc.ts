// Signed market-gross changes when a stored order uses two distinct routes
// and the trader closes against a maker that only filled one opening leg.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import * as sdk from '@rivalt/sdk';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {verifyProfitBuild} from './profit-attribution-build.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const directory=process.env.RIVALT_RUN_DIR!;
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const bounded=process.env.RIVALT_SETTLEMENT_PROBE==='profit-attribution-bounded-market';
const build=verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!,false,false,false,false,bounded?'market':'fees');
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,
  {deferFinality:true,computeUnitLimit:label=>label.startsWith('two-maker')?600_000:undefined});
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined;
try {
  const setup=await liquidityExecutionSetup(h,rpc,{traderCount:1,marginLayout:bounded?'bounded-market':'aggregate-fees',shape:symmetricPayoutShape,
    makerCash:100_000n,verifyRejections:false});
  const {root,guard,route}=executionTestHelpers(h,setup);
  const trader=setup.roots[0],owner=setup.traderOwner,makers=setup.instances.slice(0,3);
  const checkGross=async(label:string,expected:bigint)=>{
    if(!bounded)return;
    const [first,second,third]=makers.map(maker=>maker.registration);
    const read=sdk.getReadMarketGrossInstruction({venue:setup.venue,market:setup.markets[0],first,second,third});
    if(expected===0n){
      await h.send('refuse ETH capacity in BTC total',[sdk.getReadMarketGrossInstruction({venue:setup.venue,
        market:setup.markets[0],first:setup.instances[3].registration,second,third})],[],'InvalidSeeds');
    }
    assert(read.accounts.every(account=>account.role===0));
    await h.send(label,[read]);await flush();
    const signature=checks.find(check=>check.label===label)!.signature;
    const original=await rpc.call('getTransaction',[signature,{commitment:'finalized',encoding:'json',maxSupportedTransactionVersion:1}]);
    assert.equal(original.meta.returnData.programId,sdk.CLEARING_PROGRAM_ADDRESS);
    const bytes=Buffer.from(original.meta.returnData.data[0],'base64');
    assert.equal(bytes.length,8);assert.equal(bytes.readBigUInt64LE(),expected);
    const sdkRead=await sdk.readMarketGross(rpc,setup.venue,0);
    assert.equal(sdkRead.grossLots,expected);assert(sdkRead.slot>=BigInt(original.slot));
  };
  await checkGross('bounded gross before first fill',0n);
  await setup.sample();
  const slot=await setup.slot();
  await h.send('place four-lot BTC order',[sdk.getManageAccountOrderInstruction({...setup.common,btc:setup.markets[0],
    eth:setup.markets[1],margin:trader,actor:owner,marketIndex:0,guard:await guard(trader),
    operation:{__kind:'Place',expectedId:1n,terms:{side:0,lots:4n,limit:61_000n,feeBudget:50n,startSlot:slot,
      expirySlot:slot+500n,trigger:0,threshold:0n,reduceOnly:false,generation:0n}}})],[owner]);
  const laneTotals=()=>Promise.all(makers.map(async maker=>sdk.decodeMakerFeeLane((await h.read(maker.registration))!,bounded).collected));
  for(const [index,filled] of [0n,2n].entries()){
    await setup.fresh();
    await h.send('two-maker stored subfill '+index,[await route({actor:setup.payer,trader,marketIndex:0,side:0,
      makers:makers.slice(index,index+2),lots:[1n,1n],minimalMarkets:true,stored:{id:1n,version:1n,filled}})]);
    assert.equal((await setup.marketState(0)).grossLots,filled===0n?4n:8n);
    await checkGross('bounded gross after stored fill '+index,filled===0n?4n:8n);
    assert.deepEqual(await laneTotals(),filled===0n?[25n,0n,0n]:[25n,24n,0n]);
  }
  await setup.sample();
  await h.send('close all four lots against third maker',[await route({actor:owner,trader,marketIndex:0,side:1,
    makers:[makers[2]],lots:[4n],minimalMarkets:true,reduceOnly:true,generation:(await root(trader)).positions[0].generation})],[owner]);
  assert.deepEqual(await Promise.all([trader,...makers.map(m=>m.capital)].map(async key=>(await root(key)).positions[0].lots)),[0n,-1n,-2n,3n]);
  assert.equal((await setup.marketState(0)).grossLots,6n);
  assert.equal((await root(trader)).cash,999_903n);
  assert.deepEqual(await laneTotals(),[25n,24n,48n]);
  await checkGross('bounded gross with flat trader and three open makers',6n);
  setup.sourcePrices.btc=150_000_000_000n;
  await setup.freshSources();
  const target=makers[1].capital,feeds=setup.feeds.map(feed=>feed.feed);
  const classify=(market:number)=>sdk.getClassifyMarketFeesInstruction({...setup.common,ledger:setup.ledgers[market],
    first:setup.instances[market*3].registration,second:setup.instances[market*3+1].registration,third:setup.instances[market*3+2].registration});
  await h.send('atomic classify and freeze short BTC maker',[classify(0),classify(1),sdk.getFreezeAccountsInstruction({
    ...setup.safetyCommon,caller:setup.payer,target,members:(await sdk.deriveMemberPage(setup.venue,(await root(target)).id/64n))[0],
    primaryBtc:feeds[0],primaryCollateral:feeds[1],guardBtc:feeds[2],guardCollateral:feeds[3],primaryEth:feeds[4],guardEth:feeds[5],
    safetyEpoch:sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!).epoch,
    resolutionEpoch:sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!).epoch,emergency:false})]);
  await checkGross('bounded gross after default freeze',6n);
  const ledger=sdk.decodeFeeLedger((await h.read(setup.ledgers[0]))!);
  assert.deepEqual([ledger.state.insurance,ledger.spendableFees,ledger.pendingFees,ledger.state.insuranceFeeRemainder],[24n,73n,0n,1]);
  await flush();
  journal=await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),build);
  const fills=journal.initialEvents.filter(event=>event.type==='LiquidityRouteFeeRecorded');
  assert.deepEqual(fills.map(({data})=>[data.legs.length,String(data.fee),String(data.marketState.grossLots)]),
    [[2,'25','4'],[2,'24','8'],[1,'48','6']]);
  await journal.checkpoint('cross-maker-capacity',true);
  const replay=await journal.finish();
  console.log(JSON.stringify({fills:fills.length,events:replay.events,checks:checks.length}));
} finally {await journal?.close();try{await flush();}finally{ws.close();}}
