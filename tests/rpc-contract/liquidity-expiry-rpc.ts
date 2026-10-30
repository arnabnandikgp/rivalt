/** Focused review regression: real finalized expiry, durable proof and retry. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import * as sdk from '@rivalt/sdk';
import {LiquidityIndexer} from '../../packages/indexer/src/liquidity-indexer.js';
import {eventPayloads,json} from '../../packages/indexer/src/events.js';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {transferLiquidityBudget} from '../../packages/services/src/liquidity-budget.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';

const directory=process.env.RIVALT_RUN_DIR!,databaseUrl=process.env.RIVALT_DATABASE_URL!;
assert(databaseUrl);
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,{deferFinality:true});
let indexer:LiquidityIndexer|undefined,runtime:AccountRuntime|undefined;
try {
  const setup=await liquidityExecutionSetup(h,rpc);await flush();let anchor:string|undefined;
  for(const check of checks) {
    const transaction=await rpc.call('getTransaction',[check.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    if(transaction?.meta.err===null&&eventPayloads(String(check.signature),transaction,setup.deployment.eventAuthority).some(({payload})=>
      sdk.hex(payload.subarray(0,8))===sdk.hex(sdk.ACCOUNT_CUSTODY_CHANGED_EVENT_DISCRIMINATOR)&&sdk.getAccountCustodyChangedEventDecoder().decode(payload).kind===0)) {
      anchor=String(check.signature);break;
    }
  }
  assert(anchor);
  const runId='r094-maker-expiry',config={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl,
    runId,venue:setup.venue,anchor,profile:'liquidity-execution-qualification' as const,pageSize:100};
  indexer=new LiquidityIndexer(config);await indexer.open();await indexer.cycle();
  const initial=(await indexer.store.snapshot()).state;
  runtime=new AccountRuntime(databaseUrl,runId,config.rpcUrl,4);await runtime.open();
  const maker=setup.instances[0],before=sdk.makerA.getMakerPriceDecoder().decode((await h.read(maker.price))!).state;
  await setup.waitUntil(before.updatedTime+1n);
  assert.equal((await runtime.maker(0,0,setup.updater)).status,'queued');
  const original=(await runtime.store.pool.query('SELECT * FROM service_intents WHERE run_id=$1',[runId])).rows[0];
  assert.equal(original.authority.kind,'liquidityPriceSequence');
  // No executor is running: this signed original is persisted but never sent.
  const deadline=Date.now()+60_000;
  while((await rpc.call('isBlockhashValid',[original.blockhash,{commitment:'finalized'}])).value) {
    assert(Date.now()<deadline,'Finalized blockhash expiry deadline');await delay(200);
  }
  await runtime.queue.step(original.request_id);
  const expired=await runtime.queue.get(original.request_id);
  assert.equal(expired.status,'expired-unexecuted');assert.equal(expired.result.fee,null);
  const budget=async()=>(await runtime!.store.pool.query('SELECT * FROM service_budgets WHERE run_id=$1 AND name=$2',[runId,original.budget])).rows[0];
  assert.equal((await budget()).committed,'20000');assert.equal((await budget()).spent,'0');
  assert.equal(await runtime.pendingBudget(original.budget),false);
  await assert.rejects(transferLiquidityBudget(runtime,'maker',0,setup.updater,0),/Resolve every original/);
  await runtime.close();runtime=new AccountRuntime(databaseUrl,runId,config.rpcUrl,4);await runtime.open();
  assert.equal((await runtime.queue.get(original.request_id)).status,'expired-unexecuted');
  const instruction=maker.module.getRepriceInstruction({...maker.makerCommon,actor:setup.updater,
    expectedControl:before.controlEpoch,expectedSequence:before.sequence,anchor:before.anchor});
  const retry=await runtime.enqueue(original.request_id,[instruction],setup.updater,original.budget,original.authority);
  assert(retry);assert.equal(retry.request_id,original.request_id+':retry:1');assert.notEqual(retry.signature,original.signature);
  assert.equal((await budget()).committed,'40000');
  const notification=await ws.call('signatureSubscribe',[retry.signature,{commitment:'finalized',enableReceivedNotification:false}]);
  for(let attempt=0;attempt<100;attempt++) {
    await runtime.queue.step(retry.request_id);
    if((await runtime.queue.get(retry.request_id)).status==='finalized')break;
    await delay(100);
  }
  const receipt=await runtime.queue.get(retry.request_id);assert.equal(receipt.status,'finalized');
  const signal=await ws.notification(notification);assert.equal(signal.params.result.value.err,null);
  const transaction=await rpc.call('getTransaction',[retry.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
  assert.equal(transaction.transaction[0],retry.wire);assert.equal(transaction.meta.err,null);
  assert.equal(sdk.makerA.getMakerPriceDecoder().decode((await h.read(maker.price))!).state.sequence,before.sequence+1n);
  const finalBudget=await budget();assert.equal(finalBudget.committed,'20000');assert.equal(finalBudget.spent,String(transaction.meta.fee));
  const retained=(await runtime.store.pool.query('SELECT * FROM service_intents WHERE run_id=$1 AND request_id=$2',[runId,original.request_id])).rows[0];
  assert.equal(retained.wire,original.wire);assert.equal(retained.signature,original.signature);
  assert.equal((await rpc.call('getSignatureStatuses',[[original.signature],{searchTransactionHistory:true}])).value[0],null);
  await indexer.cycle();assert.deepEqual((await indexer.store.snapshot()).state,initial);
  const reconciliation=await indexer.reconcile();
  const report={revision,trackedDirty:false,original,expired,retry,receipt,finalBudget,transaction,signal,reconciliation,
    restartPreservedOriginal:true,unknownFeeReservationRetained:true,handoverBlocked:true,unchangedFinancialProjection:true};
  writeFileSync(`${directory}/summary.json`,json(report));
  console.log(json({result:'pass',revision,expired:original.signature,retry:retry.signature,fee:transaction.meta.fee,retainedReservation:finalBudget.committed}));
}finally{await runtime?.close();await indexer?.close();try{await flush();}finally{ws.close();}}
