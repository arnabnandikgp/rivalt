/** Actual settlement worker, SQL originals and executor death on the explicitly
 * pinned candidate. No fixture writes a financial result or backing summary. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import type {AccountWorkerOutcome} from '../../packages/services/src/account-runtime.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';
import {liquidityQueueFault} from './liquidity-queue-fault.js';
import {BackingWorkerRuntime} from './backing-worker-runtime.js';
import {financialRoots} from './membership-scan-helper.js';
import {verifyBackingBuild} from './backing-artifacts.js';
import {eventually} from './wire.js';

const directory=process.env.RIVALT_RUN_DIR!,databaseUrl=process.env.RIVALT_DATABASE_URL!,rpcUrl=process.env.RIVALT_RPC_URL!;
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const build=verifyBackingBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!);
const {h,rpc,ws,checks,conformance,flush}=await openCanonicalRpcHarness(rpcUrl,process.env.RIVALT_WS_URL!,directory,{deferFinality:true,computeUnitLimit:()=>1_000_000});
let journal:Awaited<ReturnType<typeof openSettlementJournal>>|undefined,runtime:BackingWorkerRuntime|undefined;
try {
  const setup=await liquidityExecutionSetup(h,rpc,{verifyRejections:false});
  const {root,route}=executionTestHelpers(h,setup),trader=setup.roots[0],maker=setup.instances[0].capital;
  await setup.sample();
  for(const side of [0,1] as const)await h.send('create actual closed worker claim',[await route({trader,actor:setup.traderOwner,
    marketIndex:0,side,makers:[setup.instances[0]],lots:[1n]})],[setup.traderOwner]);
  const before=await root(trader),makerBefore=await root(maker);
  const collected=-before.positions[0].virtualScaled/1_000_000_000n;assert(collected>=4n);
  await flush();journal=await openSettlementJournal(rpc,setup,checks.map(check=>String(check.signature)));
  await journal.checkpoint('worker-start',true);
  runtime=new BackingWorkerRuntime(databaseUrl,'p55b2-application',rpcUrl);await runtime.open();
  const certificates=await Promise.all([0,1].map(async index=>(await sdk.deriveSettlementCertificate(setup.venue,index))[0]));
  const proof=async()=>{const bytes=await h.read(certificates[0]);return bytes?sdk.getSettlementCertificateDecoder().decode(bytes):null;};
  const frames:unknown[]=[],originals:any[]=[],outcomes:unknown[]=[],faults:unknown[]=[];
  const capture=async(label:string)=>{
    const roots=await financialRoots(h,setup.venue,setup.registry);
    frames.push({label,safety:sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!),
      registry:sdk.getVenueRegistryDecoder().decode((await h.read(setup.registry))!),roots:await Promise.all(roots.map(root)),
      ledgers:await Promise.all(setup.ledgers.map(async key=>sdk.getMarketLedgerDecoder().decode((await h.read(key))!))),
      certificates:await Promise.all(certificates.map(async key=>{const bytes=await h.read(key);return bytes?sdk.getSettlementCertificateDecoder().decode(bytes):null;}))});
    writeFileSync(`${directory}/backing-frames.json`,json(frames));
  };
  const started=performance.now();let interrupted=false,steps=0;
  while((await root(maker)).cash===makerBefore.cash) {
    assert(steps<55,'Worker must complete bounded coverage and payment');
    if(steps%4===0){await setup.sample();await flush();await journal.checkpoint(`worker-${steps}`,true);}
    const outcome:AccountWorkerOutcome=await runtime.settle(setup.payer);outcomes.push(outcome);assert.equal(outcome.status,'queued',json(outcome));
    const pending:any[]=(await runtime.store.pool.query("SELECT * FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved')",[runtime.runId])).rows;
    assert.equal(pending.length,1);const original=pending[0];
    // Re-running the producer cannot replace an unresolved original.
    assert.deepEqual(await runtime.settle(setup.payer),{status:'blocked',reason:'original-settlement-intent-pending'});
    const subscription=await ws.call('signatureSubscribe',[original.signature,{commitment:'finalized',enableReceivedNotification:false}]);
    const current=await proof();
    if(!interrupted&&current&&current.next>=1n&&!current.complete) {
      const fault=await liquidityQueueFault(runtime,{databaseUrl,rpcUrl,directory,
        executorModule:'tests/rpc-contract/backing-worker-executor.ts'},original.request_id);
      assert.equal(fault.receipt.status,'finalized');faults.push(fault);
      writeFileSync(`${directory}/worker-faults.json`,json(faults));interrupted=true;
      await runtime.close();runtime=new BackingWorkerRuntime(databaseUrl,'p55b2-application',rpcUrl);await runtime.open();
    } else {
      await eventually(async()=>{await runtime!.queue.step(original.request_id);return runtime!.queue.get(original.request_id);},
        receipt=>['finalized','failed'].includes(receipt?.status),'worker original finality');
    }
    const receipt=await runtime.queue.get(original.request_id);assert.equal(receipt.status,'finalized',json(receipt));
    const notification=await ws.notification(subscription);assert.equal(notification.params.result.value.err,null);
    const transaction=await rpc.call('getTransaction',[original.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    assert.equal(transaction.transaction[0],original.wire);assert.equal(transaction.meta.err,null);
    assert(transaction.meta.computeUnitsConsumed<800_000);
    const history=await rpc.call('getTransaction',[original.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    conformance.record([],history);
    originals.push({requestId:original.request_id,signature:original.signature,wire:original.wire,receipt,transaction,notification});
    writeFileSync(`${directory}/worker-originals.json`,json(originals));
    await capture(outcome.reason);steps++;await delay(10);
  }
  assert(interrupted);assert.equal((await proof())!.backingEpoch,1n);assert((await proof())!.complete);
  assert.equal((await root(trader)).cash,before.cash-collected);
  assert.equal((await root(maker)).cash,makerBefore.cash+collected);
  assert.equal((await root(trader)).positions[0].virtualScaled,before.positions[0].virtualScaled+collected*1_000_000_000n);
  assert.equal((await root(maker)).positions[0].virtualScaled,makerBefore.positions[0].virtualScaled-collected*1_000_000_000n);
  const finalLedger=sdk.getMarketLedgerDecoder().decode((await h.read(setup.ledgers[0]))!);assert.equal(finalLedger.settlement,0n);
  assert.equal(outcomes.filter((outcome:any)=>outcome.reason==='atomic-backing-page-and-gain').length,1);
  const budget=(await runtime.store.pool.query('SELECT * FROM service_budgets WHERE run_id=$1',[runtime.runId])).rows;
  assert.equal(budget.length,1);assert.equal(budget[0].committed,'0');
  assert.equal(BigInt(budget[0].spent),originals.reduce((sum,item)=>sum+BigInt(item.transaction.meta.fee),0n));
  assert.equal((await runtime.store.pool.query('SELECT count(*) FROM service_dispatch_access WHERE run_id=$1',[runtime.runId])).rows[0].count,'0');
  await flush();await journal.checkpoint('worker-complete',true);const sql=await journal.finish();
  writeFileSync(`${directory}/worker-transport.json`,json({revision,build,budget,steps,collected,faults,sql}));
  const independent=JSON.parse(execFileSync('python3',['tests/financial/check_backing_runtime.py',`${directory}/backing-frames.json`],{encoding:'utf8'}));
  const parity=await conformance.finish(directory,[],h.read);
  writeFileSync(`${directory}/result.json`,json({revision,build,checks,originals,outcomes,faults,budget,steps,
    elapsedMs:performance.now()-started,collected,independent,parity,sql,
    endTrackedDirty:!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),
    limitations:['test-only exact candidate deployment binding; normal runtime promotion remains P56B','eight Financial roots, one market proof; default-worker acceptance remains P56A']}));
} finally {await runtime?.close();await journal?.close();try{await flush();}finally{ws.close();}}
