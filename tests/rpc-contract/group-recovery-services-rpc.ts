/** Fresh artifact binding and missing-price recovery; internal actors/test assets. */
import assert from 'node:assert/strict';
import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import {createWriteStream,readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {AccountRole,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {GroupIndexer,type GroupConfig} from '../../packages/indexer/src/group-indexer.js';
import {GroupRuntime} from '../../packages/services/src/group-runtime.js';
import {groupApi} from '../../packages/indexer/src/group-api.js';
import {json} from '../../packages/indexer/src/events.js';
import {groupRuntimeHarness} from './group-runtime-harness.js';
import {groupSafetyCases} from './group-safety-cases.js';
import {eventually} from './wire.js';

const directory=process.env.RIVALT_RUN_DIR!,revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=()=>Boolean(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()),startedDirty=dirty();
const transport=await groupRuntimeHarness(process.env.RIVALT_RPC_URL!,directory),h=transport.harness;
const setup=await groupSafetyCases(h,async()=>{},{namespace:'p21-recovery-services',setupOnly:true}),fixture=setup.fixture;
await setup.certificate();await transport.send('activate qualified cross group',[sdk.getActivateCrossGroupV2Instruction({...fixture.safety,authority:fixture.payer})]);
await transport.send('fund cross recovery account',[await setup.cashInstruction(fixture.cross,1_000_000n,false)],[fixture.owner]);
await fixture.qualify();
for(const marketIndex of [0,1]){
  const quote=await setup.route(marketIndex,0,[2n,3n],false,fixture.cross);
  const {intent}=sdk.getExecuteGroupRouteV2InstructionDataDecoder().decode(quote.instruction.data!);
  await transport.send('open both actual cross positions',[{...quote.instruction,
    accounts:[...quote.instruction.accounts!,{address:fixture.markets[1-marketIndex],role:AccountRole.WRITABLE}],
    data:sdk.getExecuteMarginRouteV2InstructionDataEncoder().encode({...await fixture.stamp(),intent})}],[fixture.owner]);
}
await transport.finalize();
const anchor=transport.checks.find(check=>check.label==='setup clearing group')!.signature;
const config:GroupConfig={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:process.env.RIVALT_DATABASE_URL!,
  runId:'p21-recovery-services',group:fixture.group,anchor,profile:'cross-safety-qualification'};
let indexer=new GroupIndexer(config),replay:GroupIndexer|undefined,app:ReturnType<typeof groupApi>|undefined;
const runtime=new GroupRuntime(config.databaseUrl,config.runId,config.rpcUrl),children:ChildProcess[]=[],captures:Record<string,Record<string,string|null>>={};
const stop=async(child:ChildProcess,signal:NodeJS.Signals='SIGTERM')=>{if(child.exitCode!==null||child.signalCode!==null)return;child.kill(signal);
  await eventually(async()=>child.exitCode!==null||child.signalCode!==null,Boolean,'owned recovery process stop');};
function start(role:'risk'|'executor'){
  const name=`${role}-${children.length}`,path=`${directory}/signer-${name}.json`;
  // The ordinary trader owns no group authority, and receives no receiver consent.
  writeFileSync(path,JSON.stringify(Array.from(fixture.owner.secretKey)),{mode:0o600});
  const child=spawn(process.execPath,['--import','tsx',`packages/services/src/${role==='executor'?'group-executor-main':'group-worker-main'}.ts`],{
    cwd:process.cwd(),env:{...process.env,RIVALT_RUN_ID:config.runId,RIVALT_GROUP_ROLE:role,RIVALT_SIGNER_PATH:path,RIVALT_RECEIVER_MARGIN:''},stdio:['ignore','pipe','pipe']});
  const log=`${directory}/${name}.log`,output=createWriteStream(log);child.stdout!.pipe(output,{end:false});child.stderr!.pipe(output,{end:false});child.once('exit',()=>output.end());
  children.push(child);return {child,log};
}
async function capture(label:string){
  captures[label]=Object.fromEntries(await Promise.all(setup.protectedKeys().map(async key=>[key,(await h.read(key))?.toString('base64')??null])));
  writeFileSync(`${directory}/captures.json`,json(captures));
}
const resolution=async()=>sdk.getGroupResolutionV2Decoder().decode((await h.read(fixture.resolution))!);
async function drain(){
  const intents=(await runtime.store.pool.query('SELECT request_id FROM service_intents WHERE run_id=$1',[config.runId])).rows;
  for(const intent of intents){const result=await eventually(()=>runtime.queue.get(intent.request_id),row=>['finalized','failed'].includes(row?.status),'original recovery finality');assert.equal(result.status,'finalized');}
}
try{
  await indexer.open();await indexer.cycle();await runtime.open();const {binding}=await indexer.store.snapshot();
  assert.equal(binding.artifactSet,sdk.GROUP_ARTIFACT_SET);
  const client=new sdk.GroupUserClient({version:2,chain:'solana:localnet',profile:'cross-safety-qualification',rpcUrl:config.rpcUrl,wsUrl:config.wsUrl,
    genesis:binding.genesis,anchor,anchorHash:binding.anchorHash,group:fixture.group,mint:fixture.mint.address,domain:binding.domain});
  const reads:{method:string;full:boolean;keys:number;milliseconds:number}[]=[],call=client.rpc.call.bind(client.rpc);
  client.rpc.call=async(method:string,params:unknown[]=[])=>{
    const started=performance.now(),result=await call(method,params);
    if(method==='getMultipleAccounts')reads.push({method,full:!(params[1] as {dataSlice?:unknown}).dataSlice,keys:(params[0] as unknown[]).length,milliseconds:performance.now()-started});
    return result;
  };
  await client.environment();const coldReads=reads.splice(0);await client.environment();const warmReads=reads.splice(0);
  assert.deepEqual(coldReads.map(read=>[read.full,read.keys]),[[false,8],[true,4]]);
  assert.deepEqual(warmReads.map(read=>[read.full,read.keys]),[[false,8]]);
  await assert.rejects(()=>new sdk.GroupArtifactVerifier(client.rpc).verify(fixture.owner.address),/authority/);
  await assert.rejects(()=>new sdk.GroupArtifactVerifier(client.rpc,[{...sdk.GROUP_ARTIFACTS[0],sha256:'0'.repeat(64)}]).verify(fixture.payer.address),/Unqualified group clearing artifact/);
  writeFileSync(`${directory}/artifact-checks.json`,json({artifactSet:binding.artifactSet,artifacts:sdk.GROUP_ARTIFACTS,coldReads,warmReads,wrongAuthorityRejected:true,wrongCodeHashRejected:true}));
  console.log(json({stage:'artifact-binding-pass',coldReads,warmReads}));
  app=groupApi(indexer);const apiUrl=await app.listen({host:'127.0.0.1',port:0});
  assert.equal((await fetch(`${apiUrl}/v2/group`)).status,200);await app.close();app=undefined;await assert.rejects(()=>fetch(`${apiUrl}/v2/group`));
  // ETH alone remains unavailable; BTC/collateral continue to receive actual
  // signed source updates. Grace is measured by the real on-chain Clock.
  await h.advance(21n);for(const index of [0,1,2,3])await fixture.publish(index);
  await h.advance(30n);for(const index of [0,1,2,3])await fixture.publish(index);
  await transport.send('explicit authority freezes after ETH source grace',[sdk.getFreezeGroupV2Instruction({...fixture.safety,...fixture.sources,
    ...await fixture.stamp(),caller:fixture.payer,target:fixture.cross,emergency:true})]);
  await capture('await-valuation');const waiting=(await resolution()).header;
  assert.equal(waiting.stage,1);assert.deepEqual([...waiting.prices],[0n,0n]);
  let risk=start('risk');
  await eventually(async()=>readFileSync(risk.log,'utf8'),log=>log.includes('fresh-group-recovery-sources-unavailable'),'partial source recovery refusal');
  const killedPid=risk.child.pid;await stop(risk.child,'SIGKILL');
  assert.equal((await runtime.store.pool.query('SELECT count(*)::int AS count FROM service_intents WHERE run_id=$1',[config.runId])).rows[0].count,0);
  await capture('waiting-unchanged');assert.deepEqual(captures['waiting-unchanged'],captures['await-valuation']);
  await indexer.cycle();const waitingProjection=(await indexer.store.snapshot()).state;await indexer.reconcile();
  const earlierNotifications=indexer.metrics.notifications;await indexer.close();indexer=new GroupIndexer(config);await indexer.open();await indexer.cycle();
  assert.deepEqual((await indexer.store.snapshot()).state,waitingProjection);await indexer.reconcile();
  for(let index=0;index<6;index++)await fixture.publish(index);
  risk=start('risk');
  const pending=await eventually<{request_id:string}|undefined>(async()=>(await runtime.store.pool.query(
    'SELECT request_id FROM service_intents WHERE run_id=$1 ORDER BY created_at LIMIT 1',[config.runId])).rows[0],Boolean,'all-source valuation intent');
  assert(pending);await stop(risk.child);start('executor');await drain();
  const valued=(await resolution()).header;assert.equal(valued.stage,2);assert.deepEqual([...valued.prices],[60_000n,30_000n]);assert.deepEqual(valued.funding,waiting.funding);
  await capture('frozen-emergency');risk=start('risk');
  writeFileSync(`${directory}/restart.json`,json({killed:killedPid,restarted:risk.child.pid,stage:waiting.stage}));
  const deadline=Date.now()+180_000;let previousStage=-1;
  while((await resolution()).header.stage!==12){
    assert(Date.now()<deadline,'Bounded seven-root emergency resolution');const header=(await resolution()).header;
    if(header.stage!==previousStage){console.log(json({stage:'emergency-progress',pass:header.stage,cursor:header.cursor}));previousStage=header.stage;}
    await delay(200);
  }
  await stop(risk.child);await drain();await capture('complete-emergency');
  for(let index=0;index<6;index++)await fixture.publish(index);
  risk=start('risk');await eventually(resolution,state=>state.header.recoverySince>0n&&state.header.recoveryLast-state.header.recoverySince>=6n,'all-source recovery qualification');
  await stop(risk.child);await drain();assert.equal((await fixture.groupState()).mode,3);
  await transport.send('explicit authority resumes only isolated mode',[sdk.getRecoverGroupResolutionV2Instruction({...fixture.safety,...fixture.sources,
    caller:fixture.payer,epoch:waiting.epoch,resume:true})]);
  assert.equal((await fixture.groupState()).mode,1);await capture('resumed-emergency');
  // Direct SDK exits from both modes after resolution, with the read API stopped.
  const walletTransactions:{label:string;signature:string;fee:number;units:number;bytes:number}[]=[];
  async function signed(label:string,instructions:Instruction[]){
    const prepared=await client.prepare(label,fixture.owner.address,instructions);await prepared.transaction.sign([fixture.owner]);
    const intent=await client.signed(prepared,prepared.transaction);writeFileSync(`${directory}/wallet-intent-${walletTransactions.length}.json`,json(intent));
    await client.broadcast(intent);const result=await eventually(()=>client.reconcile(intent),value=>['failed','finalized'].includes(value.status),label);assert.equal(result.status,'finalized');
    const transaction=await transport.rpc.call('getTransaction',[intent.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    assert.equal(transaction.transaction[0],intent.wire);assert.equal(transaction.meta.err,null);
    walletTransactions.push({label,signature:intent.signature,fee:transaction.meta.fee,units:transaction.meta.computeUnitsConsumed,bytes:Buffer.from(intent.wire,'base64').length});
  }
  await h.advance(21n);
  for(const root of [fixture.cross,fixture.operators[0].capital[1]]){
    for(let attempt=0;;attempt++){
      assert(attempt<3,'Bounded post-resolution certificate/exit');const snapshot=await client.snapshot();
      const plan=await client.exit(snapshot,fixture.owner.address,root,fixture.operators[0].token.address,1n);
      await signed(plan.verificationOnly?'SDK post-resolution complete-group proof':'SDK post-resolution funded withdrawal',plan.instructions);
      if(!plan.verificationOnly)break;
    }
  }
  await capture('emergency-exit');await transport.finalize();await indexer.cycle();const final=await indexer.store.snapshot(),reconciliation=await indexer.reconcile();
  assert(indexer.metrics.notifications>0);
  await indexer.store.pool.query('CREATE DATABASE rivalt_p21_recovery_replay');const replayUrl=new URL(config.databaseUrl);replayUrl.pathname='/rivalt_p21_recovery_replay';
  replay=new GroupIndexer({...config,databaseUrl:replayUrl.toString(),runId:'p21-recovery-replay'});await replay.open();await replay.cycle();
  assert.deepEqual((await replay.store.snapshot()).state,final.state);await replay.reconcile();
  const intents=(await runtime.store.pool.query('SELECT request_id,signature,wire FROM service_intents WHERE run_id=$1 ORDER BY created_at',[config.runId])).rows;
  const transactions=[];let spent=0n;
  for(const intent of intents){
    const transaction=await transport.rpc.call('getTransaction',[intent.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    assert.equal(transaction.transaction[0],intent.wire);assert.equal(transaction.meta.err,null);spent+=BigInt(transaction.meta.fee);
    const units=transaction.meta.computeUnitsConsumed,bytes=Buffer.from(intent.wire,'base64').length;
    assert(units*5<=1_200_000*4&&bytes<=1232);transactions.push({requestId:intent.request_id,signature:intent.signature,fee:transaction.meta.fee,units,bytes});
  }
  const budget=(await runtime.store.pool.query('SELECT name,cap::text,committed::text,spent::text FROM service_budgets WHERE run_id=$1',[config.runId])).rows;
  assert.equal(budget.length,1);assert.equal(budget[0].committed,'0');assert.equal(budget[0].spent,spent.toString());
  const finishedRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  writeFileSync(`${directory}/summary.json`,json({revision,finishedRevision,trackedDirty:startedDirty||dirty()||revision!==finishedRevision,binding,
    scope:'P21A pinned artifacts, partial-price refusal, worker/indexer AwaitValuation restart, complete recovery and direct flat exits; no P21B qualification',
    keys:{group:fixture.group,registry:fixture.registry,vault:fixture.vault,resolution:fixture.resolution,markets:fixture.markets,roots:fixture.roots,
      cross:fixture.cross,isolated:fixture.operators[0].capital[1],token:fixture.operators[0].token.address},
    transactions,walletTransactions,budget,reconciliation,freshReplay:true,apiStopped:true,ws:earlierNotifications+indexer.metrics.notifications,
    fixtureOutcomes:transport.checks.map(({history,...check})=>check)}));
  const audit=execFileSync('python3',['tests/financial/group-recovery-reference.py',directory],{encoding:'utf8'});writeFileSync(`${directory}/independent-audit.json`,audit);console.log(audit.trim());
  console.log(json({stage:'group-recovery-services-pass',transactions:transactions.length,walletTransactions:walletTransactions.length,reconciliation}));
}catch(error){
  try{writeFileSync(`${directory}/failed-run-intents.json`,json((await runtime.store.pool.query(
    'SELECT request_id,signature,status,result FROM service_intents WHERE run_id=$1 ORDER BY created_at',[config.runId])).rows));}catch{}
  throw error;
}finally{
  for(const child of children)await stop(child).catch(()=>child.kill('SIGKILL'));
  await app?.close();await replay?.close();await indexer.close();await runtime.close();
}
