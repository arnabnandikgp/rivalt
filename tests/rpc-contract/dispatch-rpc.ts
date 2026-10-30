import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {getTransferSolInstruction} from '@solana-program/system';
import * as sdk from '@rivalt/sdk';
import {LiquidityIndexer,type LiquidityConfig} from '../../packages/indexer/src/liquidity-indexer.js';
import {eventPayloads,json} from '../../packages/indexer/src/events.js';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {AccountExecution} from '../../packages/services/src/account-execution.js';
import {dispatchAccess} from '../../packages/services/src/dispatch.js';
import {signedWire} from '../../packages/services/src/queue.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {liquidityQueueFault} from './liquidity-queue-fault.js';
import {fixtureKey} from './harness.js';
import {eventually} from './wire.js';
import {dispatchDatabaseCases} from './dispatch-db-cases.js';

const directory=process.env.RIVALT_RUN_DIR!,databaseUrl=process.env.RIVALT_DATABASE_URL!;
const rpcUrl=process.env.RIVALT_RPC_URL!,wsUrl=process.env.RIVALT_WS_URL!;
assert(databaseUrl,'Owned actual PostgreSQL required');
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim(),'');
const {h,rpc,ws,checks,flush,conformance}=await openCanonicalRpcHarness(rpcUrl,wsUrl,directory,{deferFinality:true});
let indexer:LiquidityIndexer|undefined,replay:LiquidityIndexer|undefined,runtime:AccountRuntime|undefined;
const executors:AccountExecution[]=[],receipts:unknown[]=[],broadcasts:string[]=[];
let holdPair=false,releasePair:()=>void=()=>{},dropBefore:string|undefined,proxyError:unknown;
let pairBarrier:Promise<void>=Promise.resolve();
const proxy=createServer(async(request,response)=>{
  try {
    let body='';for await(const chunk of request)body+=chunk;
    const call=JSON.parse(body);
    if(call.method==='sendTransaction') {
      const wire=call.params[0],signature=signedWire(wire,1).signature;
      const original=(await runtime!.store.pool.query('SELECT * FROM service_intents WHERE run_id=$1 AND signature=$2',[runtime!.runId,signature])).rows[0];
      assert.equal(original.wire,wire);
      const access=(await runtime!.store.pool.query('SELECT address,writable FROM service_dispatch_access WHERE run_id=$1 AND request_id=$2 ORDER BY address',
        [runtime!.runId,original.request_id])).rows;
      assert.deepEqual(access.sort((a,b)=>a.address.localeCompare(b.address)),dispatchAccess(wire),'Access persisted before network send');
      broadcasts.push(signature);
      if(dropBefore===wire){response.destroy();return;}
      if(holdPair) {
        if(new Set(broadcasts).size===2)releasePair();
        await Promise.race([pairBarrier,delay(4000).then(()=>{throw new Error('Independent RPC lane did not progress');})]);
      }
    }
    const upstream=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body});
    response.writeHead(upstream.status,{'content-type':'application/json'});response.end(await upstream.text());
  } catch(error) {proxyError=error;response.writeHead(503);response.end();}
});

try {
  const setup=await liquidityExecutionSetup(h,rpc,{verifyRejections:false});await flush();
  let anchor:string|undefined;
  for(const check of checks) {
    const transaction=await rpc.call('getTransaction',[check.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    if(transaction?.meta.err===null&&eventPayloads(String(check.signature),transaction,setup.deployment.eventAuthority).some(({payload})=>
      sdk.hex(payload.subarray(0,8))===sdk.hex(sdk.ACCOUNT_CUSTODY_CHANGED_EVENT_DISCRIMINATOR)&&sdk.getAccountCustodyChangedEventDecoder().decode(payload).kind===0)) {
      anchor=String(check.signature);break;
    }
  }
  assert(anchor);
  const config:LiquidityConfig={rpcUrl,wsUrl,databaseUrl,runId:'p40a-dispatch',venue:setup.venue,anchor,
    profile:'liquidity-execution-qualification',pageSize:100};
  indexer=new LiquidityIndexer(config);await indexer.open();await indexer.cycle();
  runtime=new AccountRuntime(databaseUrl,config.runId,rpcUrl,4);await runtime.open();
  const payers=await Promise.all([fixtureKey('p40a-payer-0'),fixtureKey('p40a-payer-1')]);
  await h.send('P40A fund distinct test fee payers',payers.map(payer=>getTransferSolInstruction({source:setup.payer,destination:payer.address,amount:1_000_000n})));
  await flush();
  for(const [index,payer] of payers.entries())await runtime.queue.budget(`dispatch-${index}`,payer.address,1_000_000n);
  await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  const port=(proxy.address() as import('node:net').AddressInfo).port;
  for(let index=0;index<2;index++) {
    const executor=new AccountExecution(databaseUrl,config.runId,`http://127.0.0.1:${port}`);await executor.open();executors.push(executor);
  }
  async function reprice(id:string,instance:number,payerIndex:number) {
    const maker=setup.instances[instance],price=maker.module.getMakerPriceDecoder().decode((await h.read(maker.price))!).state;
    await setup.waitUntil(price.updatedTime+1n);
    const instruction=maker.module.getRepriceInstruction({...maker.makerCommon,actor:setup.updater,
      expectedControl:price.controlEpoch,expectedSequence:price.sequence,anchor:price.anchor});
    const {transaction}=await sdk.signCanonicalInstructions(runtime!.connection,payers[payerIndex],[instruction],
      {computeUnitLimit:100_000,loadedAccountsDataSizeLimit:8*1024*1024},[setup.updater]);
    const wire=Buffer.from(transaction.serialize()).toString('base64');
    const original=await runtime!.queue.put(id,wire,{kind:'liquidityPriceSequence',venue:setup.venue,
      account:maker.price,registration:maker.registration,pricingProgram:maker.pricingProgram,value:price.sequence.toString()},`dispatch-${payerIndex}`);
    const subscription=await ws.call('signatureSubscribe',[original.signature,{commitment:'finalized',enableReceivedNotification:false}]);
    return {original,subscription,priceBefore:price.sequence,maker};
  }
  async function finalize(input:Awaited<ReturnType<typeof reprice>>,success=true) {
    await eventually(async()=>{
      await runtime!.queue.step(input.original.request_id);return runtime!.queue.get(input.original.request_id);
    },receipt=>['finalized','failed'].includes(receipt?.status),'durable dispatch finalized');
    const notification=await ws.notification(input.subscription);
    assert.equal(notification.params.result.value.err===null,success);
    const transaction=await rpc.call('getTransaction',[input.original.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    assert.equal(transaction.transaction[0],input.original.wire);assert.equal(transaction.meta.err===null,success);
    receipts.push({id:input.original.request_id,signature:input.original.signature,transaction});
    assert.equal((await runtime!.store.pool.query('SELECT count(*) FROM service_dispatch_access WHERE run_id=$1 AND request_id=$2',
      [config.runId,input.original.request_id])).rows[0].count,'0');
    return transaction;
  }

  // Independent writes with shared readonly program/configuration dependencies.
  // Delay either HTTP acknowledgement until the other lane reaches send. Two
  // separate executors race the same originals; each must broadcast only once.
  const first=await reprice('maker:independent-0',0,0),second=await reprice('maker:independent-1',1,1);
  holdPair=true;pairBarrier=new Promise<void>(resolve=>{releasePair=resolve;});
  await Promise.all(executors.map(executor=>executor.execute()));holdPair=false;
  assert.equal(proxyError,undefined);assert.equal(broadcasts.length,2);assert.equal(new Set(broadcasts).size,2);
  await finalize(first);await finalize(second);
  for(const entry of [first,second])assert.equal(entry.maker.module.getMakerPriceDecoder().decode((await h.read(entry.maker.price))!).state.sequence,entry.priceBefore+1n);

  // Distinct maker accounts still conflict when the actual signed payer is shared.
  // Its reservation survives a completed send and another executor instance.
  const sharedFirst=await reprice('maker:payer-first',0,0),sharedSecond=await reprice('maker:payer-second',1,0);
  await runtime.queue.step(sharedFirst.original.request_id);
  await executors[1].queue.step(sharedSecond.original.request_id);
  const deferred=await runtime.queue.get(sharedSecond.original.request_id);
  assert.equal(deferred.attempts,0);assert.equal(deferred.status,'pending');
  await finalize(sharedFirst);await finalize(sharedSecond);

  // A connection loss before forwarding leaves an ambiguous original and durable
  // locks. Real finalized blockhash expiry plus authenticated price state later
  // frees access, while the unknown network fee remains reserved.
  const expired=await reprice('maker:expiry',0,0);dropBefore=expired.original.wire;
  await executors[0].queue.step(expired.original.request_id);dropBefore=undefined;
  assert.equal((await runtime.queue.get(expired.original.request_id)).status,'unresolved');
  assert(Number((await runtime.store.pool.query('SELECT count(*) FROM service_dispatch_access WHERE run_id=$1 AND request_id=$2',
    [config.runId,expired.original.request_id])).rows[0].count)>0);
  const expiryDeadline=Date.now()+60_000;
  while((await rpc.call('isBlockhashValid',[expired.original.blockhash,{commitment:'finalized'}])).value) {
    assert(Date.now()<expiryDeadline,'Actual finalized expiry');await delay(200);
  }
  await runtime.queue.step(expired.original.request_id);
  const expiredReceipt=await runtime.queue.get(expired.original.request_id);
  assert.equal(expiredReceipt.status,'expired-unexecuted');assert.equal(expiredReceipt.result.fee,null);
  assert.equal((await runtime.store.pool.query('SELECT count(*) FROM service_dispatch_access WHERE run_id=$1 AND request_id=$2',
    [config.runId,expired.original.request_id])).rows[0].count,'0');
  const retry=await reprice('maker:expiry:retry:1',0,0);assert.notEqual(retry.original.signature,expired.original.signature);
  await finalize(retry);
  // A genuine landed economic rejection releases access and charges its actual fee.
  const stale=await reprice('maker:stale',0,0);
  await h.send('P40A advance price before stale original',[stale.maker.module.getRepriceInstruction({...stale.maker.makerCommon,
    actor:setup.updater,expectedControl:(await stale.maker.state()).controlEpoch,expectedSequence:stale.priceBefore,anchor:60_000n})],[setup.updater]);
  await finalize(stale,false);

  // Real process death after upstream acceptance tests committed reservations and
  // immutable-byte recovery, followed by independent token/cash reconciliation.
  const {binding}=await indexer.store.snapshot();
  const client=new sdk.AccountUserClient({version:4,chain:'solana:localnet',profile:config.profile,rpcUrl,wsUrl,
    genesis:binding.genesis,anchor,anchorHash:binding.anchorHash,venue:setup.venue,mint:setup.mint.address,domain:binding.domain});
  const margin=setup.roots[0],owner=setup.traderOwner;
  const exit=await client.exit(await client.snapshot([margin]),owner.address,margin,setup.traderToken.address,7n);
  const prepared=await client.prepare('P40A crash-safe own cash exit',owner.address,exit.instructions);await prepared.transaction.sign([owner]);
  const wallet=await client.signed(prepared,prepared.transaction);await runtime.submit('wallet-dispatch-crash',wallet.wire);
  const fault=await liquidityQueueFault(runtime,{databaseUrl,rpcUrl,directory},'wallet-dispatch-crash');
  assert.equal(fault.receipt.status,'finalized');
  assert.equal((await client.snapshot([margin])).roots[margin].cash,999_993n);
  await flush();await indexer.cycle();const reconciliation=await indexer.reconcile(),state=(await indexer.store.snapshot()).state;
  assert.equal(Object.values(state.roots).reduce((sum,root)=>sum+BigInt(root.cash),0n),7_999_993n);
  const budgets=(await runtime.store.pool.query('SELECT name,committed,spent FROM service_budgets WHERE run_id=$1 ORDER BY name',[config.runId])).rows;
  const originals=(await runtime.store.pool.query('SELECT request_id,signature,wire,status,budget,result FROM service_intents WHERE run_id=$1 ORDER BY request_id',[config.runId])).rows;
  for(const budget of budgets) {
    const owned=originals.filter(original=>original.budget===budget.name);
    assert.equal(BigInt(budget.spent),owned.reduce((sum,original)=>sum+BigInt(original.result?.fee??'0'),0n));
    assert.equal(BigInt(budget.committed),budget.name==='dispatch-0'?20_000n:0n);
  }
  assert.equal((await runtime.store.pool.query('SELECT count(*) FROM service_dispatch_access WHERE run_id=$1',[config.runId])).rows[0].count,'0');
  await indexer.store.pool.query('CREATE DATABASE rivalt_p40a_replay');
  const replayUrl=new URL(databaseUrl);replayUrl.pathname='/rivalt_p40a_replay';
  replay=new LiquidityIndexer({...config,databaseUrl:replayUrl.toString(),runId:'p40a-replay'});await replay.open();await replay.cycle();
  assert.deepEqual((await replay.store.snapshot()).state,state);
  const databaseCases=await dispatchDatabaseCases(runtime.store.pool,config.runId);
  const parity=await conformance.finish(directory,[],h.read);
  writeFileSync(`${directory}/dispatch.json`,json({revision,build:JSON.parse(readFileSync('.local/liquidity-execution/build-manifest.json','utf8')),
    setupOutcomes:checks.length,parallelOriginals:2,parallelBroadcasts:2,duplicateExecutors:2,sharedPayerDeferred:deferred,
    expired:expiredReceipt,unknownFeeReservation:'20000',originals,budgets,receipts,fault,reconciliation,parity,databaseCases,
    replaySequence:state.sequence,limits:'Two service RPC lanes; not validator scheduler throughput or P40B event qualification'}));
  console.log('P40A actual RPC/WS/PostgreSQL dispatch, expiry, SIGKILL recovery and fresh replay passed');
} finally {
  releasePair();await Promise.allSettled(executors.map(executor=>executor.close()));
  if(runtime)await runtime.close();if(replay)await replay.close();if(indexer)await indexer.close();
  if(proxy.listening)await new Promise<void>(resolve=>proxy.close(()=>resolve()));
  try{await flush();}finally{ws.close();}
}
