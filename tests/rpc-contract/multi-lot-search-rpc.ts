// Compare signed frozen books against exhaustive search and follow certified cash to wallets.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {getTokenDecoder} from '@solana-program/token';
import {eventually} from './wire.js';
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
const aggregate=process.env.RIVALT_SETTLEMENT_PROBE==='profit-attribution-fee-lanes-apply';
const apply=aggregate||process.env.RIVALT_SETTLEMENT_PROBE==='profit-attribution-multi-lot-apply';
const tie=process.env.RIVALT_SETTLEMENT_PROBE==='profit-attribution-multi-lot-tie';
const selection=aggregate?'aggregate-fee-candidate':apply||tie?'multi-lot-book-candidate':'book-capacity-candidate';
const build=verifyProfitBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!,false,false,false,false,aggregate?'fees':apply||tie?'multi':'capacity');
const {h,rpc,ws,flush,checks}=await openCanonicalRpcHarness(url,process.env.RIVALT_WS_URL!,directory,{deferFinality:true});
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined,worker:AccountRuntime|undefined;
try {
  const setup=await liquidityExecutionSetup(h,rpc,{marginLayout:aggregate?'aggregate-fees':'sponsored-profit',shape:symmetricPayoutShape,
    traderCount:2,traderDeposits:[20_021n,tie?20_019n:20_021n],verifyRejections:false});
  const {root,route,guard}=executionTestHelpers(h,setup);
  for(const [index,reference] of [60_000n,tie?60_000n:60_003n].entries()) {
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
  const registrations=setup.instances.map(maker=>maker.registration);
  const classify=(market:number,first=registrations[3*market])=>sdk.getClassifyMarketFeesInstruction({
    ...setup.common,ledger:setup.ledgers[market],first,second:registrations[3*market+1],third:registrations[3*market+2]});
  if(aggregate){
    const before=await Promise.all(setup.ledgers.map(ledger=>h.read(ledger)));
    for(const [label,wrong] of [['duplicate',registrations[1]],['foreign market',registrations[3]]] as const){
      await h.send('reject '+label+' fee lane',[classify(0,wrong)],[],'InvalidSeeds');
    }
    assert.deepEqual(await Promise.all(setup.ledgers.map(ledger=>h.read(ledger))),before);
  }
  const freeze=sdk.getFreezeAccountsInstruction({...setup.safetyCommon,
    primaryBtc:feeds[0],primaryCollateral:feeds[1],guardBtc:feeds[2],guardCollateral:feeds[3],primaryEth:feeds[4],guardEth:feeds[5],
    caller:setup.payer,target,members:(await sdk.deriveMemberPage(setup.venue,(await root(target)).id/64n))[0],
    safetyEpoch:safety.epoch,resolutionEpoch:before.epoch,emergency:false});
  await h.send('freeze a multi-lot BTC debtor with signed prices',aggregate?[classify(0),classify(1),freeze]:[freeze]);
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
  const fills=journal.initialEvents.filter(event=>event.type===(aggregate?'LiquidityRouteFeeRecorded':'LiquidityRouteExecutedV4'));
  assert.deepEqual(fills.map(fill=>[fill.data.lots,fill.data.grossQuote,fill.data.fee].map(String)),
    [['2','120004','25'],['2',tie?'120004':'120010','25']]);
  assert.deepEqual(frozen.insuranceBefore,[12n,0n]);
  assert.deepEqual(rows.filter(row=>row.lots[0]>0n).map(row=>[row.cash,row.claims[0]]),
    [[19_996n,-20_004_000_000_000n],[tie?19_994n:19_996n,tie?-20_004_000_000_000n:-20_010_000_000_000n]]);
  const input={rows,venueHex:Buffer.from(getAddressEncoder().encode(setup.venue)).toString('hex'),epoch:frozen.epoch,
    marks:frozen.prices,pools:frozen.poolsBefore,insurance:frozen.insuranceBefore,fees:frozen.feesBefore,
    sourceDigest:createHash('sha256').update(json([setup.venue,checks.at(-1)!.signature,frozen,rows])).digest('hex')};
  const inputPath=directory+'/multi-lot-frozen.json';
  writeFileSync(inputPath,json(input));
  const result=JSON.parse(execFileSync('python3',['tests/financial/check_multi_lot_search.py',inputPath],{encoding:'utf8'}));
  assert.deepEqual([result.candidates,result.boundComparisons,result.boundCertified],tie?['144',144,false]:['784',784,true]);
  assert.deepEqual(result.charges,[tie?5:9,0]);
  if(!tie)assert.equal(result.fills.length,3);
  await journal.checkpoint('multi-lot-native-comparison',true);

  if(apply)process.env.RIVALT_DEFAULT_BATCH_STEPS='1';
  worker=new AccountRuntime(process.env.RIVALT_DATABASE_URL!,'p55b2-application',url,4,selection);
  await worker.open();
  const originals:{signature:string;reason:string;units:number;bytes:number}[]=[];
  const token=async(key:typeof setup.vault)=>getTokenDecoder().decode((await h.read(key))!).amount;
  const vaultBefore=await token(setup.vault),walletBefore=await token(setup.token.address);
  let rejected=false,certified=false;
  if(apply)assert.equal(worker.defaultContinuationSteps,1);
  for(let step=0;step<70;step++){
    const state=await readAccountResolution(worker.rpc,setup.venue);
    if(apply && state.header.stage===11)break;
    const common=await accountDefaultContext(worker.rpc,state);
    const next=await accountDefaultStep(worker,setup.payer,state,common);
    if(apply && state.preparedState.stage===2 && !certified) {
      const receipt=sdk.inventoryBookReceipt(state.preparedState,true);
      assert(receipt && receipt.count===3n && receipt.total===9n);
      await journal.checkpoint('multi-lot-certified-before-settlement',true);
      assert.equal(await token(setup.vault),vaultBefore);
      for(const row of rows)assert.equal((await root(row.key)).cash,row.cash);
      certified=true;
      await worker.close();
      process.env.RIVALT_DEFAULT_BATCH_STEPS='32';
      worker=new AccountRuntime(process.env.RIVALT_DATABASE_URL!,'p55b2-application',url,4,selection);
      await worker.open();
      assert.equal((await worker.queue.get(originals.at(-1)!.reason)).status,'finalized');
      assert.equal(worker.defaultContinuationSteps,32);
    }
    if(apply) {
      if(next.status==='ready' && next.reason==='verify-inventory-book' && !rejected) {
        const active=rows.flatMap((row,index)=>row.lots[0]!==0n?[BigInt(index)]:[]);
        const page=(await sdk.deriveFrozenMarginPage(setup.venue,0n))[0];
        const scratch=async()=>Promise.all([common.prepared,page,setup.vault,...keys].map(key=>h.read(key)));
        const prior=await scratch();
        for(const ordinals of [active.slice(1),[...active.slice(0,-1),active[0]]]){
          const wrong=sdk.getVerifyInventoryBookInstruction({...common,epoch:frozen.epoch,revision:state.preparedState.revision,ordinals});
          await h.send('refuse incomplete multi-lot certificate',[{...wrong,accounts:[...wrong.accounts,{address:page,role:AccountRole.WRITABLE}]}],[],sdk.CLEARING_ERROR__RESOLUTION);
        }
        assert.deepEqual(await scratch(),prior);rejected=true;
      }
      const queued:Awaited<ReturnType<AccountRuntime['riskWork']>>=await worker.riskWork(setup.payer);
      assert.equal(queued.status,'queued',json(queued));
      const pending:{request_id:string;signature:string;wire:string}[]=(await worker.store.pool.query("SELECT request_id,signature,wire FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved')",[worker.runId])).rows;
      assert.equal(pending.length,1);const [intent]=pending;
      const subscription=await ws.call('signatureSubscribe',[intent.signature,{commitment:'finalized'}]);
      await eventually(async()=>{await worker!.queue.step(intent.request_id);return worker!.queue.get(intent.request_id);},
        value=>['finalized','failed'].includes(value?.status),'multi-lot settlement');
      assert.equal((await worker.queue.get(intent.request_id)).status,'finalized');
      assert.equal((await ws.notification(subscription)).params.result.value.err,null);
      const receipt=await rpc.call('getTransaction',[intent.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
      assert.equal(receipt.transaction[0],intent.wire);
      originals.push({signature:intent.signature,reason:intent.request_id,units:receipt.meta.computeUnitsConsumed,bytes:Buffer.from(intent.wire,'base64').length});
      continue;
    }
    if(next.status==='ready'){await h.send(next.reason,[next.instruction]);continue;}
    assert.equal(next.reason,tie?'multi-lot-optimality-unproven':'unsupported-inventory-book');
    const active=rows.flatMap((row,index)=>row.lots.some(quantity=>quantity!==0n)?[BigInt(index)]:[]);
    const pages=await Promise.all([...new Set(active.map(ordinal=>ordinal/8n))].map(async index=>(await sdk.deriveFrozenMarginPage(setup.venue,index))[0]));
    const watched=[setup.resolution,common.prepared,setup.vault,...keys,...pages];
    const snapshot=()=>Promise.all(watched.map(key=>h.read(key)));
    const prior=await snapshot();
    const instruction=sdk.getVerifyInventoryBookInstruction({...common,epoch:state.preparedState.epoch,revision:state.preparedState.revision,ordinals:active});
    await h.send('refuse an uncertified multi-lot book',[{...instruction,accounts:[...instruction.accounts,
      ...pages.map(address=>({address,role:AccountRole.WRITABLE}))]}],[],sdk.CLEARING_ERROR__RESOLUTION);
    await flush();
    assert.deepEqual(await snapshot(),prior);
    rejected=true;break;
  }
  assert(rejected);
  if(apply){
    assert(certified);
    const final=sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
    assert.equal(final.stage,11);
    assert.deepEqual(final.insuranceSpent,[12n,0n]);
    for(const [index,key] of keys.entries())assert.equal((await root(key)).cash,BigInt(result.cash[index]));
    for(const [index,amount] of [20_000n,20_004n].entries()) {
      const margin=setup.instances[index].capital;
      await h.send('withdraw verified multi-lot maker gain '+index,[sdk.getWithdrawFundedAccountInstruction({...setup.common,
        btc:setup.markets[0],eth:setup.markets[1],owner:setup.owner,margin,quoteMint:setup.mint.address,userToken:setup.token.address,
        guard:await guard(margin),amount})],[setup.owner]);
      assert.equal((await root(margin)).cash,1_000_000n);
    }
    assert.deepEqual([await token(setup.vault),await token(setup.token.address)],[vaultBefore-40_004n,walletBefore+40_004n]);
    await flush();
  }
  await journal.checkpoint(apply?'multi-lot-wallets-received':'multi-lot-release-refused',true);
  const replay=await journal.finish();
  const proof=replay.state.resolution?.inventoryBook;
  if(apply){
    assert(proof?.multiLot);
    const expected=result.fills.map(([debtor,winner,charge,qty,ticks,extra]:string[])=>[debtor,winner,charge,qty,String(50_000n+BigInt(ticks)),extra]);
    assert.deepEqual(proof.pairs,expected);
  }else assert.equal(proof,undefined);
  const evidence={revision,sbf:build.revision,originals,certified,result,financialRoots:keys.length,freshEvents:replay.events,harnessChecks:checks.length};
  writeFileSync(directory+'/multi-lot-comparison.json',json(evidence));
  console.log(json(evidence));
} finally {
  await worker?.close();await journal?.close();try{await flush();}finally{ws.close();}
}
