import assert from 'node:assert/strict';
import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import {createWriteStream,writeFileSync} from 'node:fs';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {GroupIndexer,type GroupConfig} from '../../packages/indexer/src/group-indexer.js';
import {GroupRuntime} from '../../packages/services/src/group-runtime.js';
import {json} from '../../packages/indexer/src/events.js';
import {groupRuntimeHarness} from './group-runtime-harness.js';
import {groupSafetyCases} from './group-safety-cases.js';
import {eventually} from './wire.js';

const directory=process.env.RIVALT_RUN_DIR!,revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=()=>Boolean(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim());
const startedDirty=dirty(),transport=await groupRuntimeHarness(process.env.RIVALT_RPC_URL!,directory);
const setup=await groupSafetyCases(transport.harness,async()=>{},{namespace:'p21-workers',setupOnly:true}),fixture=setup.fixture;
await setup.certificate();await transport.send('configure cross worker test group',[sdk.getActivateCrossGroupV2Instruction({...fixture.safety,authority:fixture.payer})]);
await transport.finalize();
const anchor=transport.checks.find(check=>check.label==='setup clearing group')!.signature;
const config:GroupConfig={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:process.env.RIVALT_DATABASE_URL!,
  runId:'p21-market-workers',group:fixture.group,anchor,profile:'cross-safety-qualification'};
const indexer=new GroupIndexer(config),runtime=new GroupRuntime(config.databaseUrl,config.runId,config.rpcUrl);
let replay:GroupIndexer|undefined;
const children:ChildProcess[]=[];
const stop=async(child:ChildProcess)=>{
  if(child.exitCode!==null||child.signalCode!==null)return;
  child.kill('SIGTERM');await eventually(async()=>child.exitCode!==null||child.signalCode!==null,Boolean,'owned market worker stop');
};
const start=(role:'maker'|'funding'|'executor',marketIndex?:number,makerId?:number,key?:Keypair)=>{
  const identity=`${role}-${marketIndex??'group'}-${makerId??'none'}-${children.length}`;
  const environment:NodeJS.ProcessEnv={...process.env,RIVALT_RPC_URL:config.rpcUrl,RIVALT_DATABASE_URL:config.databaseUrl,RIVALT_RUN_ID:config.runId};
  if(key){
    const path=`${directory}/signer-${identity}.json`;writeFileSync(path,JSON.stringify(Array.from(key.secretKey)),{mode:0o600});
    Object.assign(environment,{RIVALT_GROUP_ROLE:role,RIVALT_MARKET_INDEX:String(marketIndex),RIVALT_MAKER_ID:String(makerId),RIVALT_SIGNER_PATH:path});
  }
  const child=spawn(process.execPath,['--import','tsx',`packages/services/src/${role==='executor'?'group-executor-main':'group-worker-main'}.ts`],{
    cwd:process.cwd(),env:environment,stdio:['ignore','pipe','pipe']});
  const output=createWriteStream(`${directory}/${identity}.log`);child.stdout!.pipe(output,{end:false});child.stderr!.pipe(output,{end:false});
  child.once('exit',()=>output.end());children.push(child);return child;
};
try{
  await indexer.open();await indexer.cycle();await runtime.open();
  const before=await runtime.snapshot();assert.equal(before.makers.length,4);assert(before.makers.every(maker=>maker.approved&&maker.synchronized));
  const initialRoots=await Promise.all(fixture.roots.map(transport.harness.read));
  const executor=start('executor');const makers:ChildProcess[]=[];
  for(const market of [0,1])for(const maker of [0,1])makers.push(start('maker',market,maker,fixture.operators[maker+1].owner));
  const funding=[0,1].map(market=>start('funding',market,undefined,fixture.payer));
  const heartbeat=await eventually(async()=>(await runtime.store.pool.query('SELECT * FROM group_maker_heartbeats WHERE run_id=$1 ORDER BY market_index,maker_id',[config.runId])).rows,
    rows=>rows.length===4,'four distinct live market makers');
  assert.deepEqual(heartbeat.map(row=>[row.market_index,row.maker_id]),[[0,0],[0,1],[1,0],[1,1]]);
  await eventually(()=>runtime.snapshot(),snapshot=>snapshot.marketStates.every((market,index)=>market.observationSequence>=before.marketStates[index].observationSequence+2n),
    'both budgeted funding workers publish observations');
  // Same internal owner across BTC/ETH must not overwrite heartbeat identity.
  makers[0].kill('SIGKILL');await eventually(async()=>makers[0].signalCode==='SIGKILL',Boolean,'actual maker process kill');
  const restarted=start('maker',0,0,fixture.operators[1].owner);
  await eventually(async()=>(await runtime.store.pool.query('SELECT process_id FROM group_maker_heartbeats WHERE run_id=$1 AND market_index=0 AND maker_id=0',[config.runId])).rows[0],
    row=>row?.process_id===restarted.pid,'market maker restart heartbeat');

  await transport.harness.advance(21n); // No fixture publishes: genuine expired sources.
  const stale=await eventually(()=>runtime.snapshot(),snapshot=>snapshot.marketStates.every(market=>market.oracle.status===0),'both samplers record source unavailability');
  assert(stale.marketStates.every(market=>sdk.groupSourceMode(stale.state,market,stale.now,stale.slot)==='NoCredibleBounds'));
  await stop(funding[0]);
  await eventually(async()=>(await runtime.store.pool.query("SELECT count(*) FROM service_intents WHERE run_id=$1 AND budget='group-funding-0' AND status IN ('pending','unresolved')",[config.runId])).rows[0].count,
    count=>count==='0','stopped BTC funding drains original intent');
  const btcStopped=await runtime.snapshot();
  const ethContinues=await eventually(()=>runtime.snapshot(),snapshot=>snapshot.marketStates[1].observationSequence>=btcStopped.marketStates[1].observationSequence+2n,'independent ETH sampler progress');
  assert.equal(ethContinues.marketStates[0].observationSequence,btcStopped.marketStates[0].observationSequence);
  await stop(funding[1]);for(const child of [...makers,restarted])await stop(child);
  await eventually(async()=>(await runtime.store.pool.query("SELECT count(*) FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved')",[config.runId])).rows[0].count,
    count=>count==='0','all original worker outcomes resolved');
  await stop(executor);
  assert.deepEqual(await Promise.all(fixture.roots.map(transport.harness.read)),initialRoots,'Funding sampling never writes margin roots');
  const intents=(await runtime.store.pool.query('SELECT request_id,signature,wire,status,budget,result FROM service_intents WHERE run_id=$1 ORDER BY created_at',[config.runId])).rows;
  const fees=new Map<string,bigint>();
  for(const intent of intents){
    assert.equal(intent.status,'finalized');
    const transaction=await transport.rpc.call('getTransaction',[intent.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    assert.equal(transaction.transaction[0],intent.wire);assert.equal(transaction.meta.err,null);assert.equal(String(transaction.meta.fee),intent.result.fee);
    fees.set(intent.budget,(fees.get(intent.budget)??0n)+BigInt(transaction.meta.fee));
  }
  const budgets=(await runtime.store.pool.query('SELECT name,cap::text,committed::text,spent::text FROM service_budgets WHERE run_id=$1 ORDER BY name',[config.runId])).rows;
  assert.equal(budgets.length,6);
  for(const budget of budgets){assert.equal(budget.committed,'0');assert.equal(BigInt(budget.spent),fees.get(budget.name)??0n);assert(BigInt(budget.spent)<=BigInt(budget.cap));}
  for(const market of [0,1])assert((fees.get(`group-funding-${market}`)??0n)>0n);
  await indexer.cycle();const final=await indexer.store.snapshot(),reconciliation=await indexer.reconcile();
  await indexer.store.pool.query('CREATE DATABASE rivalt_p21_workers_replay');const replayUrl=new URL(config.databaseUrl);replayUrl.pathname='/rivalt_p21_workers_replay';
  replay=new GroupIndexer({...config,databaseUrl:replayUrl.toString(),runId:'p21-workers-replay'});await replay.open();await replay.cycle();
  assert.deepEqual((await replay.store.snapshot()).state,final.state);await replay.reconcile();
  const finishedRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  writeFileSync(`${directory}/summary.json`,json({revision,finishedRevision,trackedDirty:startedDirty||dirty()||revision!==finishedRevision,
    scope:'P21A market-worker checkpoint; no funded position/order/default-worker or full A26A acceptance',
    binding:final.binding,budgets,intents,heartbeats:heartbeat.map(row=>({market:row.market_index,maker:row.maker_id,owner:row.owner})),
    restartedMaker:{before:makers[0].pid,after:restarted.pid},staleSourcesRecorded:true,independentMarketStop:true,unchangedMarginRoots:true,
    reconciliation,freshReplay:true,ws:indexer.metrics.notifications,fixtureOutcomes:transport.checks.map(({history,...check})=>check)}));
  console.log(json({stage:'group-market-workers-pass',transactions:intents.length,budgets,reconciliation}));
}finally{
  for(const child of children)await stop(child).catch(()=>child.kill('SIGKILL'));
  await replay?.close();await indexer.close();await runtime.close();
}
