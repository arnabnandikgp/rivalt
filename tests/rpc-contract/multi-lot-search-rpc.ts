// A native proposal against a real freeze. The deployed one-lot release gate must refuse it.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {AccountRole,getAddressEncoder} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {accountDefaultStep} from '../../packages/services/src/account-default-worker.js';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {readAccountResolution,accountDefaultContext} from '../../packages/services/src/account-worker-state.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {financialRoots} from './membership-scan-helper.js';
import {verifyProfitBuild} from './profit-attribution-build.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const directory=process.env.RIVALT_RUN_DIR!, url=process.env.RIVALT_RPC_URL!;
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const selection='book-capacity-candidate';
const build=verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!,false,false,false,false,'capacity');
const {h,rpc,ws,flush,checks}=await openCanonicalRpcHarness(url,process.env.RIVALT_WS_URL!,directory,{deferFinality:true});
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined,worker:AccountRuntime|undefined;
try {
  const setup=await liquidityExecutionSetup(h,rpc,{marginLayout:'sponsored-profit',shape:symmetricPayoutShape,
    traderCount:2,traderCash:20_021n,verifyRejections:false});
  const {root,route}=executionTestHelpers(h,setup);
  for(const [index,reference] of [60_000n,60_003n].entries()) {
    setup.sourcePrices.btc=reference*1_000_000n;
    if(index===0)await setup.sample();else await setup.qualify();
    const actor=setup.traderOwners[index];
    await h.send('fund two BTC lots against isolated maker '+index,[await route({trader:setup.roots[index],actor,marketIndex:0,
      side:0,makers:[setup.instances[index]],lots:[2n],maxFee:25n,allInLimit:2n*(reference+2n)+25n})],[actor]);
  }
  setup.sourcePrices.btc=50_000_000_000n;
  await setup.freshSources();
  const safety=sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!);
  const before=sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  const target=setup.roots[0];
  const feeds=setup.feeds.map(source=>source.feed);
  await h.send('freeze a multi-lot BTC debtor with signed prices',[sdk.getFreezeAccountsInstruction({...setup.safetyCommon,
    primaryBtc:feeds[0],primaryCollateral:feeds[1],guardBtc:feeds[2],guardCollateral:feeds[3],primaryEth:feeds[4],guardEth:feeds[5],
    caller:setup.payer,target,members:(await sdk.deriveMemberPage(setup.venue,(await root(target)).id/64n))[0],
    safetyEpoch:safety.epoch,resolutionEpoch:before.epoch,emergency:false})]);
  await flush();
  const frozen=sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  assert.deepEqual(frozen.prices,[50_000n,30_000n]);
  assert.deepEqual(frozen.poolsBefore,[0n,0n]);
  const keys=await financialRoots(h,setup.venue,setup.registry);
  const rows=await Promise.all(keys.map(async key=>{
    const {root:member,positions:basis}=sdk.decodeProfitAttribution((await h.read(key))!,true);
    const claims=member.positions.map((pos,index)=>pos.lots*frozen.prices[index]*1_000_000_000n+pos.virtualScaled-
      pos.lots*(frozen.funding[index]-pos.fundingCheckpointScaled));
    return {key,id:member.id,cash:member.cash,claims,lots:member.positions.map(position=>position.lots),basis};
  }));
  assert.equal(rows.length,8);
  journal=await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)),build);
  const fills=journal.initialEvents.filter(event=>event.type==='LiquidityRouteExecutedV4');
  assert.deepEqual(fills.map(fill=>[fill.data.lots,fill.data.grossQuote,fill.data.fee].map(String)),
    [['2','120004','25'],['2','120010','25']]);
  assert.deepEqual(frozen.insuranceBefore,[12n,0n]);
  assert.deepEqual(rows.filter(row=>row.lots[0]>0n).map(row=>[row.cash,row.claims[0]]),
    [[19_996n,-20_004_000_000_000n],[19_996n,-20_010_000_000_000n]]);
  const input={rows,venueHex:Buffer.from(getAddressEncoder().encode(setup.venue)).toString('hex'),epoch:frozen.epoch,
    marks:frozen.prices,pools:frozen.poolsBefore,insurance:frozen.insuranceBefore,fees:frozen.feesBefore,
    sourceDigest:createHash('sha256').update(json([setup.venue,checks.at(-1)!.signature,frozen,rows])).digest('hex')};
  const inputPath=directory+'/multi-lot-frozen.json';
  writeFileSync(inputPath,json(input));
  const result=JSON.parse(execFileSync('python3',['tests/financial/check_multi_lot_search.py',inputPath],{encoding:'utf8'}));
  assert.deepEqual([result.candidates,result.boundComparisons,result.boundCertified],['784',784,true]);
  assert.deepEqual(result.charges,[9,0]);
  assert.equal(result.fills.length,3);
  await journal.checkpoint('multi-lot-native-comparison',true);

  worker=new AccountRuntime(process.env.RIVALT_DATABASE_URL!,'p55b2-application',url,4,selection);
  await worker.open();
  let rejected=false;
  for(let step=0;step<70;step++){
    const state=await readAccountResolution(worker.rpc,setup.venue),common=await accountDefaultContext(worker.rpc,state);
    const next=await accountDefaultStep(worker,setup.payer,state,common);
    if(next.status==='ready'){await h.send(next.reason,[next.instruction]);continue;}
    assert.equal(next.reason,'unsupported-inventory-book');
    const active=rows.flatMap((row,index)=>row.lots.some(quantity=>quantity!==0n)?[BigInt(index)]:[]);
    const pages=await Promise.all([...new Set(active.map(ordinal=>ordinal/8n))].map(async index=>(await sdk.deriveFrozenMarginPage(setup.venue,index))[0]));
    const watched=[setup.resolution,common.prepared,setup.vault,...keys,...pages];
    const snapshot=()=>Promise.all(watched.map(key=>h.read(key)));
    const prior=await snapshot();
    const instruction=sdk.getVerifyInventoryBookInstruction({...common,epoch:state.preparedState.epoch,revision:state.preparedState.revision,ordinals:active});
    await h.send('one-lot certificate must refuse the multi-lot book',[{...instruction,accounts:[...instruction.accounts,
      ...pages.map(address=>({address,role:AccountRole.WRITABLE}))]}],[],sdk.CLEARING_ERROR__RESOLUTION);
    await flush();
    assert.deepEqual(await snapshot(),prior);
    rejected=true;break;
  }
  assert(rejected);
  await journal.checkpoint('multi-lot-release-refused',true);
  const replay=await journal.finish();
  assert.equal(replay.state.resolution?.inventoryBook,undefined);
  const evidence={revision,sbf:build.revision,result,financialRoots:keys.length,freshEvents:replay.events,harnessChecks:checks.length};
  writeFileSync(directory+'/multi-lot-comparison.json',json(evidence));
  console.log(json(evidence));
} finally {
  await worker?.close();await journal?.close();try{await flush();}finally{ws.close();}
}
