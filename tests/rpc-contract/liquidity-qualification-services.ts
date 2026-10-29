import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,createWriteStream,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {AccountStore} from '../../packages/indexer/src/account-store.js';
import {AccountIndexer} from '../../packages/indexer/src/account-indexer.js';
import {LiquidityIndexer} from '../../packages/indexer/src/liquidity-indexer.js';
import {ReconciliationAhead} from '../../packages/indexer/src/reconciliation-progress.js';
import {eventPayloads,json} from '../../packages/indexer/src/events.js';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {readLiquidityInputs} from '../../packages/services/src/liquidity-inputs.js';
import type {QualificationSetup} from './liquidity-qualification-setup.js';
import type {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import type {Profile} from './liquidity-continuation-model.js';

export async function waitFor<Value>(read:()=>Promise<Value>,accept:(value:Value)=>boolean,label:string,seconds=60) {
  const deadline=Date.now()+seconds*1000;
  while(Date.now()<deadline){const value=await read();if(accept(value))return value;await delay(100);}
  throw new Error(`Timed out: ${label}`);
}
export async function qualificationServices(setup:QualificationSetup,transport:Awaited<ReturnType<typeof openCanonicalRpcHarness>>,profile:Profile,directory:string) {
  const {rpc,h,checks,flush}=transport;await flush();
  const databaseName=`p34_${profile}_${process.pid}`,rootUrl=process.env.RIVALT_DATABASE_URL!,databaseUrl=new URL(rootUrl);databaseUrl.pathname=`/${databaseName}`;
  const admin=new AccountStore(rootUrl,'p34-admin');try{await admin.pool.query(`CREATE DATABASE ${databaseName}`);}finally{await admin.close();}
  let anchor:string|undefined;
  for(let index=0;index<checks.length;index++) {
    const transaction=JSON.parse(readFileSync(`${directory}/transaction-${index}.json`,'utf8'));
    if(transaction.meta.err)continue;
    if(eventPayloads(String(checks[index].signature),transaction,setup.common.eventAuthority).some(({payload})=>sdk.hex(payload.subarray(0,8))===sdk.hex(sdk.ACCOUNT_CUSTODY_CHANGED_V3_EVENT_DISCRIMINATOR)
      &&sdk.getAccountCustodyChangedV3EventDecoder().decode(payload).kind===0)){anchor=String(checks[index].signature);break;}
  }
  assert(anchor);
  const canonical=profile!=='baseline',runId=`p34-${profile}`,base={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:databaseUrl.toString(),runId,venue:setup.venue,anchor,pageSize:100};
  const makeIndexer=(overrides:Partial<typeof base>={})=>canonical?new LiquidityIndexer({...base,...overrides,profile:'liquidity-execution-qualification'}):new AccountIndexer({...base,...overrides,profile:'account-safety-qualification'});
  let indexer=makeIndexer();await indexer.open();await indexer.cycle();
  const opening=(await indexer.store.snapshot()).state,{binding}=await indexer.store.snapshot();
  const publicConfig={chain:'solana:localnet' as const,rpcUrl:base.rpcUrl,wsUrl:base.wsUrl,genesis:binding.genesis,anchor,anchorHash:binding.anchorHash,venue:setup.venue,mint:setup.mint.address,domain:binding.domain};
  const client=canonical?new sdk.LiquidityUserClient({...publicConfig,version:4,profile:'liquidity-execution-qualification'}):new sdk.AccountUserClient({...publicConfig,version:3,profile:'account-safety-qualification'});
  writeFileSync(`${directory}/public-deployment.json`,json(client.config));
  const runtime=new AccountRuntime(base.databaseUrl,runId,base.rpcUrl,canonical?4:3);await runtime.open();
  const children:ChildProcess[]=[],incidents:unknown[]=[],operational:unknown[]=[],indexerErrors:unknown[]=[];
  async function stop(child:ChildProcess){if(child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');await waitFor(async()=>child.exitCode!==null||child.signalCode!==null,Boolean,'owned worker stop',15);}
  function start(role:'funding'|'orders'|'maker'|'executor',key?:Keypair,marketIndex?:number,makerId?:number) {
    const identity=`${role}-${marketIndex??'all'}-${makerId??'all'}-${children.length}`;
    const env={...process.env,RIVALT_RPC_URL:base.rpcUrl,RIVALT_DATABASE_URL:base.databaseUrl,RIVALT_RUN_ID:runId,
      RIVALT_ACCOUNT_PROFILE:canonical?'liquidity-execution-qualification':'account-safety-qualification'};
    if(key){const signerPath=`${directory}/signer-${identity}.json`;writeFileSync(signerPath,JSON.stringify([...key.secretKey]),{mode:0o600});
      Object.assign(env,{RIVALT_ACCOUNT_ROLE:role,RIVALT_MARKET_INDEX:String(marketIndex),RIVALT_MAKER_ID:String(makerId),RIVALT_SIGNER_PATH:signerPath});}
    const child=spawn(process.execPath,['--import','tsx',`packages/services/src/account-${role==='executor'?'executor':'worker'}-main.ts`],{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
    const output=createWriteStream(`${directory}/${identity}.log`);child.stdout!.pipe(output,{end:false});child.stderr!.pipe(output,{end:false});child.once('exit',()=>output.end());children.push(child);return child;
  }
  let indexing=true,indexLoop:Promise<void>;
  function beginIndex(){indexing=true;indexLoop=(async()=>{while(indexing){try{await indexer.cycle();}catch(error){indexerErrors.push({expected:error instanceof ReconciliationAhead,message:String(error)});}await delay(250);}})();}
  beginIndex();const executor=start('executor');
  const fundingKey=setup.canonical?.updater??setup.payer;
  const publishers=[start('funding',fundingKey,0),start('funding',fundingKey,1)];
  async function restartWorker(){const previous=publishers[0];previous.kill('SIGKILL');await waitFor(async()=>previous.signalCode==='SIGKILL',Boolean,'actual publisher SIGKILL');publishers[0]=start('funding',fundingKey,0);incidents.push({kind:'publisher-restart',signal:'SIGKILL',oldPid:previous.pid,newPid:publishers[0].pid});}
  async function restartIndexer(){indexing=false;await indexLoop;await indexer.close();indexer=makeIndexer();await indexer.open();await indexer.cycle();beginIndex();incidents.push({kind:'indexer-restart',historyResumed:true});}
  async function operation(index:number) {
    if(index===80) {
      // No concurrent timed offer executes until this original's receipt resolves.
      // Other processes continue source/funding/reprice/index activity throughout.
      const legacyMakers:ChildProcess[]=[];
      if(setup.baseline) {
        for(const maker of setup.baseline.makers.flat())legacyMakers.push(start('maker',maker.owner,maker.market===setup.markets[0]?0:1,maker.makerId));
        await waitFor(()=>runtime.heartbeats(),rows=>rows.length===4&&rows.every(row=>row.online),'actual legacy maker heartbeats');
      }
      for(const side of [0,1] as const) {
        const snapshot=await client.snapshot([setup.operations],'confirmed'),root=snapshot.roots[setup.operations];
        const instruction=await client.manageOrder(snapshot,setup.owner.address,setup.operations,0,sdk.groupOrderAction('Place',{
          expectedId:root.book.lastOrderId+1n,terms:{side,lots:1n,limit:side===0?66_000n:54_000n,feeBudget:100n,startSlot:snapshot.slot,
            expirySlot:snapshot.slot+1000n,trigger:0,threshold:0n,reduceOnly:side===1,generation:root.positions[0].generation}}));
        await h.send(`P34 concurrent stored order ${side}`,[instruction],[setup.owner]);
        const worker=start('orders',setup.payer);
        await waitFor(()=>client.snapshot([setup.operations],'confirmed'),value=>value.roots[setup.operations].positions[0].lots===(side===0?1n:0n),'actual durable stored fill');
        await stop(worker);operational.push({kind:'stored-order-filled',side,lots:'1'});
      }
      for(const maker of legacyMakers)await stop(maker);
    }
    if(index===400||index===500) {
      const snapshot=await client.snapshot([setup.operations],'confirmed');
      const withdrawal=await client.exit(snapshot,setup.owner.address,setup.operations,setup.token.address,1n);
      await h.send(`P34 concurrent own cash exit ${index}`,withdrawal.instructions,[setup.owner]);
      const after=await client.snapshot([setup.operations],'confirmed');assert.equal(after.roots[setup.operations].cash,snapshot.roots[setup.operations].cash-1n);
      operational.push({kind:'funded-exit',atoms:'1',duringContinuousSampling:true});
    }
  }
  async function pause(){for(const child of children.filter(child=>child!==executor))await stop(child);
    await waitFor(async()=>(await runtime.store.pool.query("SELECT count(*) FROM service_intents WHERE run_id=$1 AND status NOT IN ('finalized','failed')",[runId])).rows[0].count,value=>value==='0','all service originals resolved');await stop(executor);
    indexing=false;await indexLoop;await flush();await indexer.cycle();}
  async function report() {
    await indexer.cycle();const state=(await indexer.store.snapshot()).state,reconciliation=await indexer.reconcile();
    await indexer.store.pool.query(`CREATE DATABASE ${databaseName}_replay`);
    const replayUrl=new URL(base.databaseUrl);replayUrl.pathname=`/${databaseName}_replay`;
    const replay=makeIndexer({databaseUrl:replayUrl.toString(),runId:`${runId}-replay`});
    try{await replay.open();await replay.cycle();assert.deepEqual((await replay.store.snapshot()).state,state);}finally{await replay.close();}
    const intents=(await runtime.store.pool.query('SELECT request_id,signature,wire,status,budget,result,created_at FROM service_intents WHERE run_id=$1 ORDER BY created_at',[runId])).rows;
    const journal=(await indexer.store.pool.query('SELECT signature,kind,payload FROM events WHERE run_id=$1 AND sequence>$2 ORDER BY sequence',[runId,opening.sequence])).rows;
    const transactions=[];
    for(const intent of intents){const payload=await rpc.call('getTransaction',[intent.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);assert(payload);transactions.push({requestId:intent.request_id,payload});}
    writeFileSync(`${directory}/service-transactions.json`,json(transactions));
    const inputs=[];mkdirSync(`${directory}/publisher-blobs`);
    if(canonical)for(const row of (await runtime.store.pool.query('SELECT request_id FROM liquidity_intent_inputs WHERE run_id=$1 ORDER BY request_id',[runId])).rows){
      const input=await readLiquidityInputs(runtime.store.pool,runId,row.request_id);
      const accounts=[...input.accounts].map(([key,value])=>{const raw=json(value),digest=createHash('sha256').update(raw).digest('hex');
        const path=`${directory}/publisher-blobs/${digest}.json`;if(!existsSync(path))writeFileSync(path,raw);return [key,digest];});
      inputs.push({requestId:row.request_id,...input,accounts});
    }
    writeFileSync(`${directory}/publisher-inputs.json`,json(inputs));
    assert(indexerErrors.every((error:any)=>error.expected),json(indexerErrors));
    const counts=(await indexer.store.pool.query(`SELECT (SELECT count(*) FROM events WHERE run_id=$1) AS events,
      (SELECT count(*) FROM outbox WHERE run_id=$1) AS outbox,(SELECT count(*) FROM jobs WHERE run_id=$1 AND status IN ('pending','unresolved')) AS unresolved`,[runId])).rows[0];
    assert.equal(counts.events,state.sequence);assert.equal(counts.outbox,state.sequence);assert.equal(counts.unresolved,'0');
    return {opening,state,reconciliation,counts,journal,intents,incidents,operational,indexerErrors,retainedReports:inputs.length,freshReplayIdentical:true};
  }
  async function close(){for(const child of children)await stop(child).catch(()=>child.kill('SIGKILL'));indexing=false;await indexLoop;await runtime.close();await indexer.close();}
  return {runtime,client,opening,restartWorker,restartIndexer,operation,pause,report,close};
}
