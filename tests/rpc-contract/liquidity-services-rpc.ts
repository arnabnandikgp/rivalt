import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,createWriteStream} from 'node:fs';
import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import type {Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {LiquidityIndexer,type LiquidityConfig} from '../../packages/indexer/src/liquidity-indexer.js';
import {ReconciliationAhead} from '../../packages/indexer/src/reconciliation-progress.js';
import {AccountRuntime} from '../../packages/services/src/account-runtime.js';
import {accountServiceApi} from '../../packages/services/src/account-service-api.js';
import {readLiquidityInputs} from '../../packages/services/src/liquidity-inputs.js';
import {eventPayloads,json} from '../../packages/indexer/src/events.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {liquidityQueueFault} from './liquidity-queue-fault.js';
import {liquidityMakerEconomics} from '../../packages/maker-kit/src/liquidity-economics.js';

const directory=process.env.RIVALT_RUN_DIR!,databaseUrl=process.env.RIVALT_DATABASE_URL!;
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert(databaseUrl,'Owned real PostgreSQL required');
const transport=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,{
  deferFinality:true,computeUnitLimit:label=>label.toLowerCase().includes('publisher')?200_000:400_000,
  maxLoadedAccounts:label=>label.startsWith('refresh independent')?32:undefined,
});
const {h,rpc,ws,checks,flush}=transport;
const children:ChildProcess[]=[],wallets:unknown[]=[],observations:unknown[]=[],faults:unknown[]=[];
let indexer:LiquidityIndexer|undefined,replay:LiquidityIndexer|undefined,runtime:AccountRuntime|undefined;
let api:ReturnType<typeof accountServiceApi>|undefined,indexing=false,feeding=false,paused=false;
let indexLoop:Promise<void>|undefined,feedLoop:Promise<void>|undefined;
async function until<Value>(read:()=>Promise<Value>,accept:(value:Value)=>boolean,label:string,seconds=40) {
  const deadline=Date.now()+seconds*1000;let last:Value|undefined;
  while(Date.now()<deadline){last=await read();if(accept(last))return last;await delay(100);}
  writeFileSync(`${directory}/timeout.json`,json({label,last}));throw new Error(`Timed out: ${label}`);
}
async function stop(child:ChildProcess) {
  if(child.exitCode!==null||child.signalCode!==null)return;
  child.kill('SIGTERM');await until(async()=>child.exitCode!==null||child.signalCode!==null,Boolean,'owned worker stopped',15);
}
try {
  const setup=await liquidityExecutionSetup(h,rpc);await flush();let anchor:string|undefined;
  for(const check of checks) {
    const tx=await rpc.call('getTransaction',[check.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    if(!tx||tx.meta.err!==null)continue;
    if(eventPayloads(String(check.signature),tx,setup.deployment.eventAuthority).some(({payload})=>
      sdk.hex(payload.subarray(0,8))===sdk.hex(sdk.ACCOUNT_CUSTODY_CHANGED_EVENT_DISCRIMINATOR)&&
      sdk.getAccountCustodyChangedEventDecoder().decode(payload).kind===0)){anchor=String(check.signature);break;}
  }
  assert(anchor);
  const config:LiquidityConfig={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl,
    runId:'p33-services',venue:setup.venue,anchor,profile:'liquidity-execution-qualification',pageSize:100};
  indexer=new LiquidityIndexer(config);await indexer.open();await indexer.cycle();
  const openingState=(await indexer.store.snapshot()).state;
  const {binding}=await indexer.store.snapshot();
  const client=new sdk.AccountUserClient({version:4,accountSchema:5 as const,chain:'solana:localnet',profile:config.profile,rpcUrl:config.rpcUrl,wsUrl:config.wsUrl,
    genesis:binding.genesis,anchor,anchorHash:binding.anchorHash,venue:setup.venue,mint:setup.mint.address,domain:binding.domain});
  writeFileSync(`${directory}/public-deployment.json`,json(client.config));
  runtime=new AccountRuntime(databaseUrl,config.runId,config.rpcUrl,4);await runtime.open();
  const margin=setup.roots[0],owner=setup.traderOwner;
  let walletCounter=0;
  async function prepare(label:string,instructions:Instruction[]) {
    const prepared=await client.prepare(label,owner.address,instructions);await prepared.transaction.sign([owner]);
    const intent=await client.signed(prepared,prepared.transaction),requestId=`wallet-${walletCounter++}`;
    await runtime!.submit(requestId,intent.wire);return {requestId,intent};
  }
  // An own-cash exit has no source/maker dependencies. Prove persisted original
  // recovery across a real executor death after upstream accepted its bytes.
  const cashBefore=(await client.snapshot([margin])).roots[margin].cash;
  const withdrawal=await client.exit(await client.snapshot([margin]),owner.address,margin,setup.traderToken.address,7n);
  const original=await prepare('lost acknowledgement cash exit',withdrawal.instructions);
  const cashFault=await liquidityQueueFault(runtime,{databaseUrl,rpcUrl:config.rpcUrl,directory},original.requestId);
  assert.equal(cashFault.receipt.status,'finalized');faults.push(cashFault);
  assert.equal((await client.snapshot([margin])).roots[margin].cash,cashBefore-7n);
  await setup.qualify();await indexer.cycle();
  const beforePrice=sdk.makerA.getMakerPriceDecoder().decode((await h.read(setup.instances[0].price))!).state;
  await setup.waitUntil(beforePrice.updatedTime+1n);
  assert.equal((await runtime.maker(0,0,setup.updater)).status,'queued');
  const makerOriginal=(await runtime.queue.pending())[0];assert(makerOriginal);
  const makerFault=await liquidityQueueFault(runtime,{databaseUrl,rpcUrl:config.rpcUrl,directory},makerOriginal);
  assert.equal(makerFault.receipt.status,'finalized');faults.push(makerFault);
  assert.equal(sdk.makerA.getMakerPriceDecoder().decode((await h.read(setup.instances[0].price))!).state.sequence,beforePrice.sequence+1n);

  const start=(role:'maker'|'funding'|'orders'|'settlement'|'executor',key?:Keypair,marketIndex?:number,instance?:number)=>{
    const identity=`${role}-${marketIndex??'venue'}-${instance??'none'}-${children.length}`;
    const env={...process.env,RIVALT_ACCOUNT_PROFILE:config.profile,RIVALT_RPC_URL:config.rpcUrl,RIVALT_DATABASE_URL:databaseUrl,RIVALT_RUN_ID:config.runId};
    if(key){const path=`${directory}/signer-${identity}.json`;writeFileSync(path,JSON.stringify([...key.secretKey]),{mode:0o600});
      Object.assign(env,{RIVALT_ACCOUNT_ROLE:role,RIVALT_MARKET_INDEX:String(marketIndex),RIVALT_MAKER_ID:String(instance),RIVALT_SIGNER_PATH:path});}
    let args=['--import','tsx',`packages/services/src/account-${role==='executor'?'executor':'worker'}-main.ts`];
    if(role==='maker') {
      const path=`${directory}/operator-${identity}.json`;writeFileSync(path,json({schemaVersion:4,operatorClass:'internal-reference',deployment:client.config,
        runId:config.runId,databaseEnv:'RIVALT_DATABASE_URL',signerPath:`${directory}/signer-${identity}.json`,role,marketIndex,instance,signer:key!.address}),{mode:0o600});
      args=['--import','tsx','packages/maker-kit/src/liquidity-bot.ts',path];
    }
    const child=spawn(process.execPath,args,
      {cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
    const output=createWriteStream(`${directory}/${identity}.log`);child.stdout!.pipe(output,{end:false});child.stderr!.pipe(output,{end:false});
    child.once('exit',()=>output.end());children.push(child);return child;
  };
  const beginIndex=()=>{indexing=true;indexLoop=(async()=>{while(indexing){try{await indexer!.cycle();}catch(error){
    observations.push({stage:'indexer-retry',expected:error instanceof ReconciliationAhead,error:String(error)});
    writeFileSync(`${directory}/observations.json`,json(observations));
  }await delay(250);}})();};
  beginIndex();feeding=true;feedLoop=(async()=>{while(feeding){if(!paused)await setup.freshSources();await delay(1000);}})();
  let executor=start('executor');const makers:ChildProcess[]=[],publishers:ChildProcess[]=[];
  for(const market of [0,1])for(const instance of [0,1,2])makers.push(start('maker',setup.updater,market,instance));
  for(const market of [0,1])publishers.push(start('funding',setup.updater,market));
  await until(()=>runtime!.heartbeats(),rows=>rows.length===6&&rows.every(row=>row.online),'six live canonical maker workers');
  const count=(pattern:string)=>runtime!.store.pool.query("SELECT count(*) FROM service_intents WHERE run_id=$1 AND budget LIKE $2 AND status='finalized'",[config.runId,pattern]).then(result=>Number(result.rows[0].count));
  await until(()=>count('liquidity-maker-%'),value=>value>=7,'all canonical repricers publish');
  async function normal(){return until(()=>client.snapshot([margin],'confirmed'),snapshot=>snapshot.marketStates.every(market=>
    sdk.accountSourceMode(snapshot.safetyState,market,snapshot.now,snapshot.slot)==='Normal'),'actual publisher/source recovery',60);}
  await normal();await until(()=>count('liquidity-funding-%'),value=>value>=4,'actual restricted publisher transactions');
  api=accountServiceApi(runtime);const endpoint=await api.listen({host:'127.0.0.1',port:0});
  async function wallet(label:string,instructions:Instruction[]) {
    const original=await prepare(label,instructions);
    const receipt=await until(()=>runtime!.queue.get(original.requestId),row=>['failed','finalized'].includes(row?.status),label);
    assert.equal(receipt.status,'finalized',json(receipt));
    const tx=await rpc.call('getTransaction',[original.intent.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    assert.equal(tx.transaction[0],original.intent.wire);assert.equal(tx.meta.err,null);
    wallets.push({label,signature:original.intent.signature,fee:tx.meta.fee,units:tx.meta.computeUnitsConsumed,bytes:Buffer.from(original.intent.wire,'base64').length});
  }
  const response=await api.inject({method:'POST',url:'/v4/quote',payload:{actor:owner.address,margin,marketIndex:0,side:0,lots:'1'}});
  assert.equal(response.statusCode,200,response.body);assert(response.json().available,response.body);
  assert.equal((await api.inject({url:'/v3/operators'})).statusCode,404);
  makers[0].kill('SIGKILL');await until(async()=>makers[0].signalCode==='SIGKILL',Boolean,'maker process killed');
  const replacement=start('maker',setup.updater,0,0);
  await until(()=>runtime!.heartbeats(),rows=>rows.some(row=>row.market_index===0&&row.instance===0&&row.process_id===replacement.pid),'actual maker restart');
  await normal();
  const browser=await (await import('../browser/liquidity-lifecycle.js')).liquidityBrowser({directory,client,owner,endpoint,indexer,normal});
  // An actual stored order is discovered and filled by its separate worker.
  let snapshot=await client.tradeSnapshot(margin,0);
  const quote=await client.route({snapshot,trader:margin,marketIndex:0,side:0,lots:1n,maxFee:1000n,allInLimit:100_000n},owner.address);assert(quote);
  await wallet('open for actual order worker',quote.instructions);snapshot=await client.snapshot([margin],'confirmed');
  await wallet('triggered existing-position order',[await client.manageOrder(snapshot,owner.address,margin,0,
    sdk.orderAction('Place',{expectedId:snapshot.roots[margin].book.lastOrderId+1n,terms:{side:1,lots:1n,limit:50_000n,feeBudget:1000n,
      startSlot:snapshot.slot,expirySlot:snapshot.slot+2000n,trigger:1,threshold:59_999n,reduceOnly:true,generation:snapshot.roots[margin].positions[0].generation}}))]);
  const orders=start('orders',setup.payer);
  await until(()=>client.snapshot([margin],'confirmed'),value=>value.roots[margin].positions[0].lots===0n,'actual stored order worker fill');await stop(orders);
  assert.equal((await client.snapshot([margin])).roots[margin].reserved,0n);

  for(const publisher of publishers)await stop(publisher);
  await until(async()=>(await runtime!.store.pool.query("SELECT count(*) FROM service_intents WHERE run_id=$1 AND budget LIKE 'liquidity-funding-%' AND status NOT IN ('finalized','failed')",[config.runId])).rows[0].count,
    value=>value==='0','old publisher originals resolved');await stop(executor);
  const handover=await (await import('./liquidity-publisher-handover.js')).publisherHandover(runtime,setup,transport,databaseUrl,directory);
  writeFileSync(`${directory}/publisher-handover.json`,json(handover));faults.push(handover);
  executor=start('executor');for(const market of [0,1])publishers.push(start('funding',setup.updater,market));await normal();

  // Stop sources until the real independent source deadline fails. No fixture
  // changes clocks/mode and no safeguard is relaxed to make recovery pass.
  paused=true;
  await until(()=>client.snapshot([margin],'confirmed'),snapshot=>snapshot.marketStates.some(market=>
    !['Normal','Degraded'].includes(sdk.accountSourceMode(snapshot.safetyState,market,snapshot.now,snapshot.slot))),'real source outage',40);
  const outage=await api.inject({method:'POST',url:'/v4/quote',payload:{actor:owner.address,margin,marketIndex:0,side:0,lots:'1'}});
  assert(outage.statusCode!==200||!outage.json().available,outage.body);
  observations.push({stage:'source-outage',code:outage.statusCode,body:outage.json()});
  paused=false;await normal();
  // Restart the finalized indexer while all workers retain their signed queue.
  indexing=false;await indexLoop;await indexer.close();indexer=new LiquidityIndexer(config);await indexer.open();await indexer.cycle();beginIndex();
  await until(()=>count('liquidity-funding-%'),value=>value>=8,'publisher recovery history');
  for(const child of children.filter(child=>child!==executor))await stop(child);
  // pending() is the executor's due-work list, not an unresolved-history count.
  // Future retry times must not authorize shutdown while receipts remain open.
  await until(async()=>(await runtime!.store.pool.query("SELECT count(*) FROM service_intents WHERE run_id=$1 AND status NOT IN ('finalized','failed')",[config.runId])).rows[0].count,
    value=>value==='0','all durable originals resolved');await stop(executor);
  feeding=false;await feedLoop;indexing=false;await indexLoop;await flush();await indexer.cycle();
  const state=(await indexer.store.snapshot()).state,reconciliation=await indexer.reconcile();
  const records=(await runtime.store.pool.query('SELECT request_id FROM liquidity_intent_inputs WHERE run_id=$1 ORDER BY request_id',[config.runId])).rows;
  assert(records.length>=8);let available=0;
  for(const row of records) {
    const input=await readLiquidityInputs(runtime.store.pool,config.runId,row.request_id),calculation=input.calculation as any,report=calculation.report;
    // This fixture deliberately uses flat +/-2/3 atom curves, zero skew and
    // sufficient published capacity. Expected totals are literal independent
    // integer arithmetic over the retained raw configs; no SDK quote is reused.
    if(report.outcome===0) {
      available++;const market=report.market===setup.markets[0]?0:1,reference=market===0?60_000n:30_000n;
      const quantity=(6_000_000n+reference-1n)/reference;
      assert.equal(BigInt(report.referencePrice),reference);assert.equal(BigInt(report.quantity),quantity);
      for(const instance of setup.instances.slice(market*3,market*3+3)) {
        const configuration=sdk.makerA.getMakerCurveDecoder().decode(Buffer.from(input.accounts.get(instance.config)!.data[0],'base64')).state;
        assert.equal(configuration.shape.skewTick,0n);assert.equal(configuration.shape.bids[0].offset,2n);assert.equal(configuration.shape.asks[0].offset,3n);
      }
      assert.equal(BigInt(report.bid),quantity*(reference-2n));assert.equal(BigInt(report.ask),quantity*(reference+3n));
    }
  }
  assert(available>=4);
  await assert.rejects(()=>runtime!.store.pool.query('UPDATE liquidity_intent_inputs SET calculation=calculation WHERE run_id=$1',[config.runId]),/append-only journal/);
  await indexer.store.pool.query('CREATE DATABASE rivalt_p33_service_replay');
  const replayUrl=new URL(databaseUrl);replayUrl.pathname='/rivalt_p33_service_replay';
  replay=new LiquidityIndexer({...config,databaseUrl:replayUrl.toString(),runId:'p33-service-replay'});await replay.open();await replay.cycle();
  assert.deepEqual((await replay.store.snapshot()).state,state);
  const intents=(await runtime.store.pool.query('SELECT request_id,signature,status,budget,result FROM service_intents WHERE run_id=$1 ORDER BY created_at',[config.runId])).rows;
  const journal=(await indexer.store.pool.query('SELECT signature,kind,payload FROM events WHERE run_id=$1 AND sequence>$2 ORDER BY sequence',[config.runId,openingState.sequence])).rows;
  const transactions=(await indexer.store.pool.query('SELECT signature,failed,payload FROM transactions WHERE run_id=$1',[config.runId])).rows;
  // Maker reprices have no clearing events, but their actual charged network
  // fees still belong in the operator report. Fetch every original independently.
  for(const intent of intents)if(!transactions.some(tx=>tx.signature===intent.signature)) {
    const payload=await rpc.call('getTransaction',[intent.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    assert(payload);transactions.push({signature:intent.signature,failed:payload.meta.err!==null,payload});
  }
  const economics=setup.instances.map((instance,offset)=>{
    const marketIndex=(offset<3?0:1) as 0|1,market=setup.markets[marketIndex],budget=`liquidity-maker-${marketIndex}-${offset%3}`;
    const boundary=(projection:typeof state)=>({sequence:projection.sequence,root:projection.roots[instance.capital],
      fundingIndexScaled:projection.markets[market].fundingIndexScaled,referencePrice:projection.markets[market].referencePrice});
    const input={version:4 as const,operatorClass:'internal-reference' as const,capital:instance.capital,market,marketIndex,
      opening:boundary(openingState),closing:boundary(state),events:journal,
      transactions:transactions.map(tx=>({signature:tx.signature,feeLamports:String(tx.payload.meta.fee),failed:tx.failed,
        chargeToMaker:intents.some(intent=>intent.signature===tx.signature&&intent.budget===budget)})),
      costScope:`Only ${budget} update transactions; excludes shared publisher, setup/rent and taker costs`,pendingFeeReservationLamports:'0',
      hedge:{kind:'not-observed' as const,assumedBps:'1',description:'Illustrative one-basis-point hedge cost on filled venue notional; no hedge was executed'}};
    writeFileSync(`${directory}/maker-${marketIndex}-${offset%3}-economics-input.json`,json(input));return liquidityMakerEconomics(input);
  });
  writeFileSync(`${directory}/maker-economics.json`,json(economics));
  assert(intents.every(row=>['finalized','failed'].includes(row.status)),json(intents.filter(row=>!['finalized','failed'].includes(row.status))));
  assert(observations.every((entry:any)=>entry.stage!=='indexer-retry'||entry.expected),json(observations));
  const counts=(await indexer.store.pool.query(`SELECT
    (SELECT count(*) FROM transactions WHERE run_id=$1) AS transactions,
    (SELECT count(*) FROM events WHERE run_id=$1) AS events,
    (SELECT count(*) FROM outbox WHERE run_id=$1) AS outbox,
    (SELECT count(*) FROM jobs WHERE run_id=$1 AND status IN ('pending','unresolved')) AS unresolved`,[config.runId])).rows[0];
  assert.equal(counts.events,state.sequence);assert.equal(counts.outbox,counts.events);assert.equal(counts.unresolved,'0');
  const summary={revision,trackedDirty:execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!=='',
    build:JSON.parse(readFileSync('.local/liquidity-execution/build-manifest.json','utf8')),checks,faults,wallets,browser,observations,intents,
    inputReplay:{reports:records.length,available,independentFlatPriceArithmetic:true},economics,counts,reconciliation,state,metrics:indexer.metrics,replayMetrics:replay.metrics,
    phaseAcceptance:false,remaining:'maker kit and full phase closeout; P34 comparative workload separate'};
  writeFileSync(`${directory}/summary.json`,json(summary));console.log(json({stage:'p33-services-pass',intents:intents.length,reports:records.length,reconciliation}));
}finally{
  feeding=false;indexing=false;for(const child of children)await stop(child).catch(()=>child.kill('SIGKILL'));
  await Promise.allSettled([feedLoop,indexLoop].filter(Boolean));await api?.close();await runtime?.close();await replay?.close();await indexer?.close();
  try{await flush();}finally{ws.close();}
}
