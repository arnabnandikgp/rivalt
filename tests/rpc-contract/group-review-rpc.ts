import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import type {Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {GroupIndexer,type GroupConfig} from '../../packages/indexer/src/group-indexer.js';
import {GroupRuntime} from '../../packages/services/src/group-runtime.js';
import {json} from '../../packages/indexer/src/events.js';
import {groupRuntimeHarness} from './group-runtime-harness.js';
import {groupSafetyCases} from './group-safety-cases.js';
import {eventually} from './wire.js';

const directory=process.env.RIVALT_RUN_DIR!,revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=()=>Boolean(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim());
assert(!dirty(),'Pin review recovery before execution');
const transport=await groupRuntimeHarness(process.env.RIVALT_RPC_URL!,directory);
const setup=await groupSafetyCases(transport.harness,async()=>{},{namespace:'p21-review',setupOnly:true}),fixture=setup.fixture;
await setup.certificate();await transport.send('activate qualified review group',[sdk.getActivateCrossGroupV2Instruction({...fixture.safety,authority:fixture.payer})]);
await transport.finalize();
const anchor=transport.checks.find(check=>check.label==='setup clearing group')!.signature;
const config:GroupConfig={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:process.env.RIVALT_DATABASE_URL!,
  runId:'p21-review-recovery',group:fixture.group,anchor,profile:'cross-safety-qualification'};
const indexer=new GroupIndexer(config),runtime=new GroupRuntime(config.databaseUrl,config.runId,config.rpcUrl);
let replay:GroupIndexer|undefined;
try{
  await indexer.open();await indexer.cycle();await runtime.open();
  const raw=async(key:Address)=>{
    const response=await transport.rpc.call('getAccountInfo',[key,{encoding:'base64',commitment:'finalized'}]);
    assert(response.value);return Buffer.from(response.value.data[0],'base64');
  };
  const keys=[fixture.group,fixture.vault,fixture.operators[0].token.address,...fixture.roots];
  const capture=async()=>Object.fromEntries(await Promise.all(keys.map(async key=>[key,(await raw(key)).toString('base64')])));
  const before=await capture(),baseline=await indexer.store.snapshot();
  const reconcile=indexer.reconcile.bind(indexer);let injected=false;
  indexer.reconcile=async snapshot=>{
    if(!injected){
      injected=true;
      // A genuine finalized write lands AFTER history scan, BEFORE account read.
      await transport.send('deposit during finalized reconciliation',[await setup.cashInstruction(fixture.cross,7n,false)],[fixture.owner]);
      await transport.finalize();
      assert.equal((await indexer.store.snapshot()).checkpoint,baseline.checkpoint,'No premature durable cursor');
    }
    return reconcile(snapshot);
  };
  await indexer.cycle();indexer.reconcile=reconcile;
  assert.equal(indexer.metrics.catchups,1);assert(indexer.healthy);
  const caughtUp=await indexer.store.snapshot();
  assert.equal(BigInt(caughtUp.state.sequence),BigInt(baseline.state.sequence)+1n);
  assert.equal(caughtUp.state.roots[fixture.cross].cash,'7');
  assert.equal(caughtUp.checkpoint,transport.checks.at(-1)!.signature);

  await transport.harness.advance(2n);
  const initial=await runtime.snapshot(),observation=initial.marketStates[0].observationSequence;
  assert.equal((await runtime.funding(0,fixture.payer)).status,'queued');
  const requestId=`funding:0:${observation}`;
  const intent=async(id:string)=>(await runtime.store.pool.query('SELECT * FROM service_intents WHERE run_id=$1 AND request_id=$2',[config.runId,id])).rows[0];
  const original=await intent(requestId);assert(original);
  assert.deepEqual(original.authority,{kind:'groupObservationSequence',group:fixture.group,account:fixture.markets[0],value:observation.toString()});
  assert.equal((await runtime.funding(0,fixture.payer)).reason,'original-funding-intent-pending');
  // Never start the executor or broadcast this original. Advance another market.
  await transport.send('unrelated ETH observation while BTC original is pending',[sdk.getSampleGroupOracleV2Instruction(fixture.sampleAccounts(1))]);
  await transport.finalize();
  const moved=await runtime.snapshot();assert(moved.state.sequence>initial.state.sequence);
  assert.equal(moved.marketStates[0].observationSequence,observation);
  assert.equal(moved.marketStates[1].observationSequence,initial.marketStates[1].observationSequence+1n);
  const expiryDeadline=Date.now()+60_000;
  while((await transport.rpc.call('isBlockhashValid',[original.blockhash,{commitment:'finalized'}])).value){
    assert(Date.now()<expiryDeadline,'Real finalized blockhash expiry');await delay(200);
  }
  assert.equal((await transport.rpc.call('getSignatureStatuses',[[original.signature],{searchTransactionHistory:true}])).value[0],null);
  await runtime.queue.step(requestId);
  const expired=await intent(requestId);assert.equal(expired.status,'expired-unexecuted');
  assert.equal(expired.wire,original.wire);assert.equal(expired.result.economicEffect,'not-applied');assert.equal(expired.result.fee,null);
  const budget=async()=>(await runtime.store.pool.query("SELECT cap::text,committed::text,spent::text FROM service_budgets WHERE run_id=$1 AND name='group-funding-0'",[config.runId])).rows[0];
  assert.deepEqual(await budget(),{cap:'5000000',committed:'20000',spent:'0'});
  assert.equal((await runtime.funding(0,fixture.payer)).status,'queued');
  const retryId=`${requestId}:retry:1`,retry=await intent(retryId);
  assert(retry);assert.notEqual(retry.signature,original.signature);assert.equal((await intent(requestId)).wire,original.wire);
  const finalized=await eventually(async()=>{await runtime.queue.step(retryId);return runtime.queue.get(retryId);},row=>row?.status==='finalized','new original funding retry finality');
  const canonical=await transport.rpc.call('getTransaction',[finalized.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
  assert.equal(canonical.transaction[0],retry.wire);assert.equal(canonical.meta.err,null);assert.equal(canonical.meta.fee,5000);
  assert.deepEqual(await budget(),{cap:'5000000',committed:'20000',spent:'5000'});
  const finalSnapshot=await runtime.snapshot();assert.equal(finalSnapshot.marketStates[0].observationSequence,observation+1n);
  assert.equal(finalSnapshot.state.sequence,moved.state.sequence+1n,'Successful sample advances group AND market observation');
  const pending=(await runtime.store.pool.query("SELECT count(*) FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved')",[config.runId])).rows[0].count;
  assert.equal(pending,'0');

  // Independent raw offsets from the versioned layout, literal seven-atom deposit.
  // Funding samples must not move cash, claims, roots, or owner token balances.
  const after=await capture(),bytes=(capture:typeof before,key:Address)=>Buffer.from(capture[key],'base64');
  assert.equal(bytes(after,fixture.cross).readBigUInt64LE(113),7n);
  for(const root of fixture.roots.filter(root=>root!==fixture.cross))assert.equal(after[root],before[root]);
  for(const offset of [231,263])assert.equal(bytes(after,fixture.group).readBigUInt64LE(offset)-bytes(before,fixture.group).readBigUInt64LE(offset),7n);
  for(const offset of [239,247,255])assert.equal(bytes(after,fixture.group).readBigUInt64LE(offset),bytes(before,fixture.group).readBigUInt64LE(offset));
  assert.equal(bytes(after,fixture.vault).readBigUInt64LE(64)-bytes(before,fixture.vault).readBigUInt64LE(64),7n);
  const ownerToken=fixture.operators[0].token.address;
  assert.equal(bytes(before,ownerToken).readBigUInt64LE(64)-bytes(after,ownerToken).readBigUInt64LE(64),7n);
  await indexer.cycle();const final=await indexer.store.snapshot(),reconciliation=await indexer.reconcile();assert(indexer.metrics.notifications>0);
  await indexer.store.pool.query('CREATE DATABASE rivalt_p21_review_replay');
  const replayUrl=new URL(config.databaseUrl);replayUrl.pathname='/rivalt_p21_review_replay';
  replay=new GroupIndexer({...config,databaseUrl:replayUrl.toString(),runId:'p21-review-replay'});await replay.open();await replay.cycle();
  assert.deepEqual((await replay.store.snapshot()).state,final.state);await replay.reconcile();
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),revision);assert(!dirty());
  writeFileSync(`${directory}/summary.json`,json({revision,trackedDirty:false,scope:'P21A review catch-up/market-specific funding expiry',
    binding:final.binding,indexerMetrics:indexer.metrics,catchupSequence:caughtUp.state.sequence,finalSequence:final.state.sequence,reconciliation,
    original:expired,retry:await intent(retryId),retryTransaction:canonical,budget:await budget(),pending,before,after,freshReplay:true,
    initialGroupSequence:initial.state.sequence,unrelatedGroupSequence:moved.state.sequence,initialBtcObservation:observation,
    finalBtcObservation:finalSnapshot.marketStates[0].observationSequence,fixtureOutcomes:transport.checks.map(({history,...check})=>check)}));
  console.log(json({stage:'group-review-recovery-pass',revision,catchups:indexer.metrics.catchups,ws:indexer.metrics.notifications,
    originalStatus:expired.status,retrySignature:finalized.signature,budget:await budget(),reconciliation,freshReplay:true}));
}finally{await replay?.close();await indexer.close();await runtime.close();}
