/** Real durable default service with independent Fraction/graph expected money.
 * Provisioning and normal trades create all claims; no financial state injection. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync} from 'node:fs';
import {getTokenDecoder} from '@solana-program/token';
import {VersionedTransaction} from '@solana/web3.js';
import {AccountRole} from '@solana/kit';
import {populateDefaultCohort,defaultStorageResources,exercisePopulatedActions,exercisePopulatedConcurrency} from './scaled-default-setup.js';
import {transactionLocks,conflicts} from '../performance/lock-model.js';
import {fixtureKey} from './harness.js';
import * as sdk from '@rivalt/sdk';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {json} from '../../packages/indexer/src/events.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {financialRoots} from './membership-scan-helper.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';
import {verifyBackingBuild} from './backing-artifacts.js';
import {liquidityQueueFault} from './liquidity-queue-fault.js';
import {eventually} from './wire.js';

const directory=process.env.RIVALT_RUN_DIR!,databaseUrl=process.env.RIVALT_DATABASE_URL!,rpcUrl=process.env.RIVALT_RPC_URL!;
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const build=verifyBackingBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!);
const population=Number(process.env.RIVALT_DEFAULT_POPULATION??'8');
assert([8,128,1024].includes(population),'Explicit default population required');
const helper=JSON.parse(readFileSync(`${process.env.RIVALT_SETTLEMENT_HELPER_DIR??'.local/settlement-helper'}/manifest.json`,'utf8'));assert.equal(helper.trackedDirty,false);
process.env.RIVALT_ACCOUNT_DEPLOYMENT='account-scale-candidate';
const concurrentPayers=await Promise.all([0,1].map(index=>fixtureKey(`p56-scale-owner-${index}`)));
const {h,rpc,ws,checks,conformance,flush}=await openCanonicalRpcHarness(rpcUrl,process.env.RIVALT_WS_URL!,directory,{deferFinality:true,computeUnitLimit:label=>label==='replayed final instruction rolls back entire default batch'||label.startsWith('invalid plan window ')?1_200_000:1_000_000,
  payerFor:label=>label==='populated concurrent isolated BTC'?concurrentPayers[0]:label==='populated concurrent isolated ETH'?concurrentPayers[1]:undefined});
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined,runtime:AccountRuntime|undefined;
const originals:any[]=[],faults:any[]=[],outcomes:any[]=[],stages:any[]=[];
const persist=()=>writeFileSync(`${directory}/worker-progress.json`,json({revision,build,helper,originals,faults,outcomes,stages}));
try {
  const setup=await liquidityExecutionSetup(h,rpc,{verifyRejections:false,...(population>8?{makerCash:50_000_000n}: {})});
  const populated=population>8?await populateDefaultCohort(h,setup,population as 128|1024):null;
  const {root,guard,route}=executionTestHelpers(h,setup),trader=setup.roots[0],owner=setup.traderOwner;
  await h.send('bound actual cross cash before default exposure',[sdk.getWithdrawFundedAccountInstruction({...setup.common,
    btc:setup.markets[0],eth:setup.markets[1],owner,margin:trader,quoteMint:setup.mint.address,userToken:setup.traderToken.address,
    guard:await guard(trader),amount:600_000n})],[owner]);
  for(const [marketIndex,lots] of [[0,40n],[1,20n]] as const) {
    await setup.sample();
    await h.send('open actual cross default exposure',[await route({trader,actor:owner,marketIndex,side:0,makers:[setup.instances[marketIndex*3]],lots:[lots]})],[owner]);
  }
  const populatedActions=populated?await exercisePopulatedActions(h,setup,populated):null;
  const concurrent=populated?await exercisePopulatedConcurrency(h,setup,populated):null;
  let contention:null|{labels:string[];signatures:string[];locks:ReturnType<typeof transactionLocks>[]} = null;
  if(concurrent) {
    await flush();
    const wires=concurrent.labels.map(label=>{
      const index=checks.findIndex(check=>check.label===label);assert(index>=0);
      return JSON.parse(readFileSync(`${directory}/wire-${index}.json`,'utf8'));
    });
    const locks=wires.map(wire=>transactionLocks(Buffer.from(wire.wireBase64,'base64')));
    assert.deepEqual(conflicts(locks[0],locks[1]),[],'Independent isolated markets share no writable lock, including fee payers');
    contention={labels:concurrent.labels,signatures:wires.map(wire=>wire.signature),locks};
  }
  const source=async()=>sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  const safety=async()=>sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!);
  const sources={primaryBtc:setup.feeds[0].feed,primaryCollateral:setup.feeds[1].feed,guardBtc:setup.feeds[2].feed,
    guardCollateral:setup.feeds[3].feed,primaryEth:setup.feeds[4].feed,guardEth:setup.feeds[5].feed};
  setup.sourcePrices.btc=40_000_000_000n;setup.sourcePrices.eth=2_000_000_000n;await setup.fresh();
  await h.send('freeze independently bankrupt cross account',[sdk.getFreezeAccountsInstruction({...setup.safetyCommon,...sources,
    caller:setup.payer,target:trader,members:(await sdk.deriveMemberPage(setup.venue,(await root(trader)).id/64n))[0],
    safetyEpoch:(await safety()).epoch,resolutionEpoch:(await source()).epoch,emergency:false})]);
  const initial=await source();assert.equal(initial.stage,2);
  const members=await financialRoots(h,setup.venue,setup.registry);
  const rows=await Promise.all(members.map(async key=>{
    const value=await root(key);return {key,id:value.id,root:value,cash:value.cash,claims:value.positions.map((position,index)=>
      position.lots*initial.prices[index]*1_000_000_000n+position.virtualScaled-position.lots*(initial.funding[index]-position.fundingCheckpointScaled))};
  }));
  writeFileSync(`${directory}/independent-default-input.json`,json({rows,pools:initial.poolsBefore,insurance:initial.insuranceBefore}));
  const expected=JSON.parse(execFileSync('python3',['tests/financial/settlement_rpc_reference.py'],{
    input:json({rows,pools:initial.poolsBefore,insurance:initial.insuranceBefore}),encoding:'utf8'}));
  writeFileSync(`${directory}/independent-default.json`,json({rows,initial,expected}));
  const storageResources=await defaultStorageResources(rpc);
  await flush();journal=await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)));
  await journal.checkpoint('default-worker-start',true);
  const open=async()=>{const result=new AccountRuntime(databaseUrl,'p55b2-application',rpcUrl,4,'account-scale-candidate');await result.open();return result;};
  runtime=await open();const started=performance.now();let previousStage=2,windowRejected=false;
  const captureSimulation=(value:AccountRuntime)=>{
    const call=value.rpc.call.bind(value.rpc);
    value.rpc.call=async(method:string,params:any[]=[])=>{
      const result=await call(method,params);
      if(method==='simulateTransaction'&&params[1]?.sigVerify===false)writeFileSync(`${directory}/latest-batch-simulation.json`,json({request:params,result}));
      if(method==='simulateTransaction'&&result.value?.err)writeFileSync(`${directory}/failed-simulation.json`,json({request:params,result}));
      return result;
    };
  };
  captureSimulation(runtime);
  while((await source()).stage!==11) {
    const stepStarted=performance.now();
    assert(originals.length<(population===8?1200:2000),'Bounded worker continuation safety budget');
    const outcome=await runtime.riskWork(setup.payer);outcomes.push(outcome);persist();
    assert.equal(outcome.status,'queued',json(outcome));
    const pending:any[]=(await runtime.store.pool.query("SELECT * FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved')",[runtime.runId])).rows;
    assert.equal(pending.length,1);const original=pending[0];
    assert.deepEqual(await runtime.riskWork(setup.payer),{status:'blocked',reason:'original-risk-intent-pending'});
    const subscription=await ws.call('signatureSubscribe',[original.signature,{commitment:'finalized',enableReceivedNotification:false}]);
    const wire=VersionedTransaction.deserialize(Buffer.from(original.wire,'base64'));
    const actions=wire.message.compiledInstructions.filter(instruction=>wire.message.staticAccountKeys[instruction.programIdIndex].address===sdk.CLEARING_PROGRAM_ADDRESS);
    const matching=(tag:Parameters<typeof sdk.hex>[0])=>actions.filter(instruction=>sdk.hex(instruction.data.slice(0,8))===sdk.hex(tag));
    if(population>8&&originals.length===0) {
      const actionsWithMetas=actions.map(instruction=>({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,data:instruction.data,
        accounts:instruction.accountKeyIndexes.map(index=>({address:wire.message.staticAccountKeys[index].address,
          role:wire.message.isAccountSigner(index)?(wire.message.isAccountWritable(index)?AccountRole.WRITABLE_SIGNER:AccountRole.READONLY_SIGNER):
            wire.message.isAccountWritable(index)?AccountRole.WRITABLE:AccountRole.READONLY}))}));
      const writable=transactionLocks(Buffer.from(original.wire,'base64')).write.filter(key=>key!==setup.payer.address);
      const before=await Promise.all(writable.map(key=>h.read(key as typeof setup.venue)));
      await h.send('replayed final instruction rolls back entire default batch',[...actionsWithMetas,actionsWithMetas[0]],[],sdk.CLEARING_ERROR__RESOLUTION);
      assert.deepEqual(await Promise.all(writable.map(key=>h.read(key as typeof setup.venue))),before);
      await flush(); // Fail this probe promptly rather than deferring its resource audit to Apply.
    }
    if(!windowRejected&&matching(sdk.CONTINUE_SETTLEMENT_PLAN_WINDOW_DISCRIMINATOR).length) {
      const position=actions.findIndex(instruction=>sdk.hex(instruction.data.slice(0,8))===sdk.hex(sdk.CONTINUE_SETTLEMENT_PLAN_WINDOW_DISCRIMINATOR));
      const decoded=sdk.getContinueSettlementPlanWindowInstructionDataDecoder().decode(actions[position].data);
      assert(decoded.pages.length>0);
      const prefix=actions.slice(0,position+1).map(instruction=>({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,data:instruction.data,
        accounts:instruction.accountKeyIndexes.map(index=>({address:wire.message.staticAccountKeys[index].address,
          role:wire.message.isAccountSigner(index)?(wire.message.isAccountWritable(index)?AccountRole.WRITABLE_SIGNER:AccountRole.READONLY_SIGNER):
            wire.message.isAccountWritable(index)?AccountRole.WRITABLE:AccountRole.READONLY}))}));
      const writable=transactionLocks(Buffer.from(original.wire,'base64')).write.filter(key=>key!==setup.payer.address);
      const before=await Promise.all(writable.map(key=>h.read(key as typeof setup.venue)));
      for(const [label,pages] of [
        ['duplicate page',[...decoded.pages,decoded.pages[0]]],
        ['stale page revision',decoded.pages.map((page,index)=>index? page:{...page,revision:page.revision+1n})],
      ] as const) {
        const altered={...prefix[position],data:sdk.getContinueSettlementPlanWindowInstructionDataEncoder().encode({...decoded,pages:[...pages]})};
        await h.send(`invalid plan window ${label} rolls back prefix`,[...prefix.slice(0,position),altered],[],sdk.CLEARING_ERROR__RESOLUTION);
        assert.deepEqual(await Promise.all(writable.map(key=>h.read(key as typeof setup.venue))),before);
      }
      await flush();windowRejected=true;
    }
    const applications=matching(sdk.APPLY_SETTLEMENT_MARGIN_DISCRIMINATOR).map(instruction=>sdk.getApplySettlementMarginInstructionDataDecoder().decode(instruction.data));
    const faultKind=matching(sdk.UPLOAD_SETTLEMENT_RATE_DISCRIMINATOR).length?'upload':applications.length?'apply':undefined;
    if(faultKind&&!faults.some(fault=>fault.kind===faultKind)) {
      const fault=await liquidityQueueFault(runtime,{databaseUrl,rpcUrl,directory},original.request_id);
      assert.equal(fault.receipt.status,'finalized');faults.push({kind:faultKind,...fault});persist();
      await runtime.close();runtime=await open();captureSimulation(runtime);
    } else {
      await eventually(async()=>{await runtime!.queue.step(original.request_id);return runtime!.queue.get(original.request_id);},
        receipt=>['finalized','failed'].includes(receipt?.status),'default worker original finality');
    }
    const receipt=await runtime.queue.get(original.request_id);assert.equal(receipt.status,'finalized',json(receipt));
    const notification=await ws.notification(subscription);assert.equal(notification.params.result.value.err,null);
    const transaction=await rpc.call('getTransaction',[original.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    assert.equal(transaction.transaction[0],original.wire);assert.equal(transaction.meta.err,null);
    assert(transaction.meta.computeUnitsConsumed<=1_000_000);
    const history=await rpc.call('getTransaction',[original.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    conformance.record([],history);
    originals.push({elapsedMs:performance.now()-stepStarted,requestId:original.request_id,reason:outcome.reason,actionCount:actions.length,appliedOrdinals:applications.map(value=>value.ordinal),signature:original.signature,wire:original.wire,receipt,transaction,notification});
    const current=await source();stages.push({step:originals.length,source:current.stage,revision:current.revision});persist();
    for(const application of applications) {
      const ordinal=Number(application.ordinal);
      const actual=await root(rows[ordinal].key);assert.equal(actual.cash,BigInt(expected.plan.cash[ordinal]));
      assert(actual.positions.every(position=>position.lots===0n&&position.virtualScaled===0n));
      assert.equal(actual.book.lastOrderId,rows[ordinal].root.book.lastOrderId);
      assert.equal(actual.book.lastGroupId,rows[ordinal].root.book.lastGroupId);
      if(ordinal===0){await flush();await journal.checkpoint('worker-partial-apply',true);}
    }
    if(matching(sdk.COMPLETE_SETTLEMENT_APPLICATION_DISCRIMINATOR).length){await flush();await journal.checkpoint('worker-distribution',true);}
    if(current.stage!==previousStage) {
      await flush();await journal.checkpoint(`worker-stage-${current.stage}`,true);previousStage=current.stage;
    }
  }
  assert.deepEqual(faults.map(fault=>fault.kind),['upload','apply']);
  assert(windowRejected,'Missing signed window rejection coverage');
  for(const [ordinal,row] of rows.entries())assert.equal((await root(row.key)).cash,BigInt(expected.plan.cash[ordinal]));
  const budget=(await runtime.store.pool.query('SELECT * FROM service_budgets WHERE run_id=$1',[runtime.runId])).rows;
  assert.equal(budget.length,1);assert.equal(budget[0].committed,'0');
  assert.equal(BigInt(budget[0].spent),originals.reduce((sum,item)=>sum+BigInt(item.transaction.meta.fee),0n));
  assert.equal((await runtime.store.pool.query('SELECT count(*) FROM service_dispatch_access WHERE run_id=$1',[runtime.runId])).rows[0].count,'0');
  const elapsedMs=performance.now()-started;
  const exit=rows.find(row=>BigInt(expected.plan.cash[rows.indexOf(row)])>0n&&row.root.owner===setup.owner.address)!;assert(exit);
  const balanceBefore=getTokenDecoder().decode((await h.read(setup.token.address))!).amount;
  await h.send('actual resolved one-atom token exit',[sdk.getWithdrawFundedAccountInstruction({...setup.common,btc:setup.markets[0],eth:setup.markets[1],
    owner:setup.owner,margin:exit.key,quoteMint:setup.mint.address,userToken:setup.token.address,guard:await guard(exit.key),amount:1n})],[setup.owner]);
  assert.equal(getTokenDecoder().decode((await h.read(setup.token.address))!).amount,balanceBefore+1n);
  setup.sourcePrices.btc=60_000_000_000n;setup.sourcePrices.eth=3_000_000_000n;
  for(let round=0;round<4;round++) {await setup.waitUntil(await setup.now()+2n);await setup.fresh();
    await h.send('sustained post-default source recovery',[sdk.getRecoverAccountsInstruction({...setup.safetyCommon,...sources,caller:setup.payer,epoch:initial.epoch,resume:false})]);}
  await h.send('explicit recovery to custody',[sdk.getRecoverAccountsInstruction({...setup.safetyCommon,...sources,caller:setup.payer,epoch:initial.epoch,resume:true})]);
  await flush();await journal.checkpoint('default-worker-recovered',true);const sql=await journal.finish();
  const parity=await conformance.finish(directory,[],h.read);
  const latency=originals.map(value=>value.elapsedMs).sort((left,right)=>left-right);
  const resources={elapsedMs,continuationTransactions:originals.length,financialInstructions:originals.reduce((sum,value)=>sum+value.actionCount,0),
    p50OriginalMs:latency[Math.ceil(latency.length*0.5)-1],p95OriginalMs:latency[Math.ceil(latency.length*0.95)-1],
    feeLamports:budget[0].spent,peakCu:Math.max(...originals.map(value=>value.transaction.meta.computeUnitsConsumed)),
    peakWireBytes:Math.max(...originals.map(value=>Buffer.from(value.wire,'base64').length)),storageResources};
  const operatingEnvelope=population!==128||originals.length<=2000&&elapsedMs<=900_000&&BigInt(budget[0].spent)<=10_000_000n
    &&storageResources.recoveryBytes<=16*1024*1024;
  writeFileSync(`${directory}/result.json`,json({revision,build,helper,populated,populatedActions,contention,resources,operatingEnvelope,checks,originals,faults,outcomes,budget,elapsedMs,expected,sql,parity,defaultBatchSteps:runtime.defaultContinuationSteps,
    endTrackedDirty:!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),
    limitations:[`${population} Financial roots; selected runtime promotion remains gated pending complete P56 acceptance`,'internal makers and synthetic oracle inputs']}));
  assert(operatingEnvelope,'P56 populated cohort exceeds G1 resource envelope; retained results are not acceptance');
} finally {persist();await runtime?.close();await journal?.close();try{await flush();}finally{ws.close();}}
