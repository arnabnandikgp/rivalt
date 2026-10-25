import assert from 'node:assert/strict';
import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import {createWriteStream,writeFileSync} from 'node:fs';
import type {Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {GroupIndexer,type GroupConfig} from '../../packages/indexer/src/group-indexer.js';
import {GroupRuntime} from '../../packages/services/src/group-runtime.js';
import {groupServiceApi} from '../../packages/services/src/group-service-api.js';
import {json} from '../../packages/indexer/src/events.js';
import {groupRuntimeHarness} from './group-runtime-harness.js';
import {groupSafetyCases} from './group-safety-cases.js';
import {eventually} from './wire.js';

const directory=process.env.RIVALT_RUN_DIR!,revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=()=>Boolean(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim());
const startedDirty=dirty(),transport=await groupRuntimeHarness(process.env.RIVALT_RPC_URL!,directory);
const setup=await groupSafetyCases(transport.harness,async()=>{},{namespace:'p21-trading-services',setupOnly:true}),fixture=setup.fixture;
await setup.certificate();await transport.send('configure cross service test group',[sdk.getActivateCrossGroupV2Instruction({...fixture.safety,authority:fixture.payer})]);
await transport.finalize();
const anchor=transport.checks.find(check=>check.label==='setup clearing group')!.signature;
const config:GroupConfig={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:process.env.RIVALT_DATABASE_URL!,
  runId:'p21-trading-services',group:fixture.group,anchor,profile:'cross-safety-qualification'};
const indexer=new GroupIndexer(config),runtime=new GroupRuntime(config.databaseUrl,config.runId,config.rpcUrl),app=groupServiceApi(runtime);
let replay:GroupIndexer|undefined;
const children:ChildProcess[]=[];
const stop=async(child:ChildProcess)=>{if(child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');
  await eventually(async()=>child.exitCode!==null||child.signalCode!==null,Boolean,'owned trading service stop');};
const start=(role:'maker'|'orders'|'executor',key?:Keypair,marketIndex?:number,makerId?:number)=>{
  const identity=`${role}-${marketIndex??'group'}-${makerId??'none'}-${children.length}`;
  const environment:NodeJS.ProcessEnv={...process.env,RIVALT_RPC_URL:config.rpcUrl,RIVALT_DATABASE_URL:config.databaseUrl,RIVALT_RUN_ID:config.runId};
  if(key){const path=`${directory}/signer-${identity}.json`;writeFileSync(path,JSON.stringify(Array.from(key.secretKey)),{mode:0o600});
    Object.assign(environment,{RIVALT_GROUP_ROLE:role,RIVALT_MARKET_INDEX:String(marketIndex),RIVALT_MAKER_ID:String(makerId),RIVALT_SIGNER_PATH:path});}
  const child=spawn(process.execPath,['--import','tsx',`packages/services/src/${role==='executor'?'group-executor-main':'group-worker-main'}.ts`],{
    cwd:process.cwd(),env:environment,stdio:['ignore','pipe','pipe']});
  const output=createWriteStream(`${directory}/${identity}.log`);child.stdout!.pipe(output,{end:false});child.stderr!.pipe(output,{end:false});child.once('exit',()=>output.end());
  children.push(child);return child;
};
try{
  await indexer.open();await indexer.cycle();await runtime.open();const {binding}=await indexer.store.snapshot();
  const client=new sdk.GroupUserClient({version:2,chain:'solana:localnet',profile:'cross-safety-qualification',rpcUrl:config.rpcUrl,wsUrl:config.wsUrl,
    genesis:binding.genesis,anchor,anchorHash:binding.anchorHash,group:fixture.group,mint:fixture.mint.address,domain:binding.domain});
  const url=await app.listen({host:'127.0.0.1',port:0});start('executor');
  for(const market of [0,1])for(const maker of [0,1])start('maker',fixture.operators[maker+1].owner,market,maker);
  await eventually(()=>runtime.snapshot(),snapshot=>snapshot.makers.length===4&&snapshot.makers.every(maker=>maker.online),'four live quote makers');
  const post=async(path:string,payload:unknown)=>{
    const response=await fetch(`${url}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:json(payload)}),body=await response.json();
    assert.equal(response.status,200,`${path}: ${json(body)}`);return body;
  };
  const wallet:{label:string;signature:string;wire:string;fee:string}[]=[];
  async function signed(label:string,instructions:Instruction[]){
    const prepared=await client.prepare(label,fixture.owner.address,instructions);await prepared.transaction.sign([fixture.owner]);
    const intent=await client.signed(prepared,prepared.transaction);writeFileSync(`${directory}/wallet-${wallet.length}.json`,json(intent));
    const submitted=await post('/v2/submit',{requestId:intent.id,wire:intent.wire});assert.equal(submitted.signature,intent.signature);
    const finalized=await eventually(()=>client.reconcile(intent),result=>['failed','finalized'].includes(result.status),label);
    assert.equal(finalized.status,'finalized',`${label}: ${finalized.error}`);
    const queued=await eventually(()=>runtime.queue.get(intent.id),row=>row?.status==='finalized',label);
    assert.equal(queued.wire,intent.wire);assert.equal(queued.result.fee,finalized.fee);
    wallet.push({label,signature:intent.signature,wire:intent.wire,fee:finalized.fee!});
  }
  await signed('fund cross trading account',[await client.deposit(await client.snapshot(),fixture.owner.address,fixture.cross,fixture.operators[0].token.address,1_000_000n)]);
  await fixture.qualify();
  const fills:{marketIndex:number;side:number;lots:string;gross:string;fee:string;before:sdk.MarginAccountV2;after:sdk.MarginAccountV2}[]=[];
  async function trade(marketIndex:0|1,side:0|1,lots:bigint){
    const apiQuote=await post('/v2/quote',{actor:fixture.owner.address,margin:fixture.cross,marketIndex,side,lots:lots.toString()});assert.equal(apiQuote.available,true,json(apiQuote));
    // Treat the HTTP message as advisory. Rebuild from independent direct RPC
    // state and sign only the SDK's reviewed message.
    const quote=await client.quote(fixture.owner.address,fixture.cross,marketIndex,side,lots,{maxFee:1_000_000n,allInLimit:side===0?1_000_000_000n:0n});
    assert(quote);assert.deepEqual(JSON.parse(json(quote.allocation)),apiQuote.allocation);
    const before=(await client.snapshot()).roots[fixture.cross];
    await signed(`direct rebuilt ${marketIndex===0?'BTC':'ETH'} ${side===0?'open':'close'}`,quote.instructions);
    const after=(await client.snapshot()).roots[fixture.cross];
    fills.push({marketIndex,side,lots:lots.toString(),gross:quote.allocation.grossQuote.toString(),fee:quote.allocation.fee.toString(),before,after});
    return quote;
  }
  const open=await trade(0,0,100n);assert.equal(open.allocation.grossQuote,6_002_790n);assert.equal(open.allocation.fee,1201n);assert.equal(open.allocation.legs.length,2);
  await trade(1,0,10n);await trade(0,1,100n);await trade(1,1,10n);
  let snapshot=await client.snapshot();assert(snapshot.roots[fixture.cross].positions.every(position=>position.lots===0n));
  await fixture.qualify();snapshot=await client.snapshot();
  await signed('place durable BTC limit',[await client.manageOrder(snapshot,fixture.owner.address,fixture.cross,0,sdk.groupOrderAction('Place',{
    expectedId:1n,terms:{side:0,lots:1n,limit:61_000n,feeBudget:100n,startSlot:snapshot.slot,expirySlot:snapshot.slot+600n,trigger:0,threshold:0n,reduceOnly:false,generation:0n}}))]);
  const beforeOrder=(await client.snapshot()).roots[fixture.cross],orders=start('orders',fixture.payer);
  const filled=await eventually(()=>client.snapshot(),state=>state.roots[fixture.cross].book.orders.some(entry=>entry.order.id===1n&&entry.order.state===3),'actual order worker fill');
  await stop(orders);const order=filled.roots[fixture.cross].book.orders.find(entry=>entry.order.id===1n)!.order;
  assert.equal(order.filled,1n);assert.equal(order.notional,60_030n);assert.equal(order.feeCharged,13n);
  fills.push({marketIndex:0,side:0,lots:'1',gross:order.notional.toString(),fee:order.feeCharged.toString(),before:beforeOrder,after:filled.roots[fixture.cross]});
  await trade(0,1,1n);
  // Independent raw-transition audit. Checkpoints are observed chain inputs;
  // this checks exact two-slot funding application, lots/notional and fees,
  // without calling the allocation/preview implementation for expectations.
  for(const fill of fills){
    const quantity=BigInt(fill.lots),gross=BigInt(fill.gross),fee=(gross+4999n)/5000n,sign=fill.side===0?1n:-1n;
    assert.equal(BigInt(fill.fee),fee);assert.equal(fill.after.cash,fill.before.cash-fee);
    for(let index=0;index<2;index++){
      const before=fill.before.positions[index],after=fill.after.positions[index];
      assert.equal(after.lots,before.lots+(index===fill.marketIndex?sign*quantity:0n));
      assert.equal(after.virtualScaled,before.virtualScaled-before.lots*(after.fundingCheckpointScaled-before.fundingCheckpointScaled)-
        (index===fill.marketIndex?sign*gross*1_000_000_000n:0n));
    }
  }
  snapshot=await client.snapshot();assert.equal(snapshot.roots[fixture.cross].cash,997_453n);assert(snapshot.roots[fixture.cross].positions.every(position=>position.lots===0n));
  assert.equal(snapshot.roots[fixture.cross].reserved,0n);assert.equal(snapshot.state.fees,2547n);
  const intents=(await runtime.store.pool.query('SELECT request_id,signature,wire,status,budget,result FROM service_intents WHERE run_id=$1 ORDER BY created_at',[config.runId])).rows;
  for(const intent of intents){
    await eventually(()=>runtime.queue.get(intent.request_id),row=>row?.status==='finalized','original service finality');
    const original=await transport.rpc.call('getTransaction',[intent.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    assert.equal(original.transaction[0],intent.wire);assert.equal(original.meta.err,null);
  }
  const orderBudget=(await runtime.store.pool.query("SELECT cap::text,committed::text,spent::text FROM service_budgets WHERE run_id=$1 AND name='group-orders'",[config.runId])).rows[0];
  assert.deepEqual(orderBudget,{cap:'5000000',committed:'0',spent:'5000'});
  await transport.finalize();await indexer.cycle();const final=await indexer.store.snapshot(),reconciliation=await indexer.reconcile();
  assert.equal(final.state.roots[fixture.cross].cash,'997453');
  await indexer.store.pool.query('CREATE DATABASE rivalt_p21_trading_replay');const replayUrl=new URL(config.databaseUrl);replayUrl.pathname='/rivalt_p21_trading_replay';
  replay=new GroupIndexer({...config,databaseUrl:replayUrl.toString(),runId:'p21-trading-replay'});await replay.open();await replay.cycle();
  assert.deepEqual((await replay.store.snapshot()).state,final.state);await replay.reconcile();
  const finishedRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  writeFileSync(`${directory}/summary.json`,json({revision,finishedRevision,trackedDirty:startedDirty||dirty()||revision!==finishedRevision,
    scope:'P21A quote/direct routing/stored-order checkpoint; settlement/default-worker and full A26A pending',binding,wallet,intents,fills,
    orderBudget,reconciliation,freshReplay:true,ws:indexer.metrics.notifications,fixtureOutcomes:transport.checks.map(({history,...check})=>check)}));
  console.log(json({stage:'group-trading-services-pass',walletTransactions:wallet.length,storedOrderFills:1,reconciliation}));
}finally{
  for(const child of children)await stop(child).catch(()=>child.kill('SIGKILL'));
  await app.close();await replay?.close();await indexer.close();await runtime.close();
}
