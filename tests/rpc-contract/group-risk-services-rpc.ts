/** Fresh maximum-cohort P21A risk-worker qualification; internal actors/test assets. */
import assert from 'node:assert/strict';
import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import {createWriteStream,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {AccountRole,type Address} from '@solana/kit';
import {getCreateAccountInstruction,getTransferSolInstruction} from '@solana-program/system';
import {TOKEN_PROGRAM_ADDRESS,getInitializeAccount3Instruction,getMintToInstruction,getTransferCheckedInstruction} from '@solana-program/token';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {GroupIndexer,type GroupConfig} from '../../packages/indexer/src/group-indexer.js';
import {GroupRuntime} from '../../packages/services/src/group-runtime.js';
import {json} from '../../packages/indexer/src/events.js';
import {groupRuntimeHarness} from './group-runtime-harness.js';
import {groupSafetyCases} from './group-safety-cases.js';
import {fixtureKey} from './custody-cases.js';
import {eventually} from './wire.js';

const directory=process.env.RIVALT_RUN_DIR!,revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=()=>Boolean(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()),startedDirty=dirty();
const transport=await groupRuntimeHarness(process.env.RIVALT_RPC_URL!,directory),h=transport.harness;
const setup=await groupSafetyCases(h,async()=>{},{namespace:'p21-risk-services',setupOnly:true,makerDuration:2400n}),fixture=setup.fixture;
await setup.certificate();await transport.send('activate qualified cross group',[sdk.getActivateCrossGroupV2Instruction({...fixture.safety,authority:fixture.payer})]);
await transport.send('fund cross liquidation target',[await setup.cashInstruction(fixture.cross,1_000_000n,false)],[fixture.owner]);
const receiverOwner=await fixtureKey('p21-risk-receiver'),receiverToken=await fixtureKey('p21-risk-receiver-token');
await transport.send('receiver SOL rent and fee provision',[getTransferSolInstruction({source:fixture.payer,destination:receiverOwner.address,amount:1_000_000_000n})]);
const [receiverPortfolio]=await sdk.findGroupPortfolioPda({group:fixture.group,owner:receiverOwner.address,index:0});
const [receiver]=await sdk.findMarginPda({portfolio:receiverPortfolio,subaccountIndex:0});
await transport.send('explicit receiver portfolio',[await sdk.getCreatePortfolioV2InstructionAsync({...fixture.common,owner:receiverOwner,index:0})],[receiverOwner]);
await transport.send('explicit consenting cross receiver',[await sdk.getRegisterMarginV2InstructionAsync({...fixture.common,owner:receiverOwner,portfolio:receiverPortfolio,
  subaccountIndex:0,mode:0,isolatedMarketIndex:255,role:2})],[receiverOwner]);fixture.roots.push(receiver);
await transport.send('receiver owns minted test collateral',[getCreateAccountInstruction({payer:fixture.payer,newAccount:receiverToken,lamports:await h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),
  getInitializeAccount3Instruction({account:receiverToken.address,mint:fixture.mint.address,owner:receiverOwner.address}),
  getMintToInstruction({mint:fixture.mint.address,token:receiverToken.address,mintAuthority:fixture.payer,amount:1_000_000n})],[receiverToken]);
await transport.send('receiver deposits own funded cash',[await setup.cashInstruction(receiver,1_000_000n,false,receiverOwner,receiverToken.address)],[receiverOwner]);
async function route(index:0|1,side:0|1,parts:bigint[],root=fixture.cross,signer=fixture.owner){
  const quote=await setup.route(index,side,parts,side===1,root,signer);
  const {intent}=sdk.getExecuteGroupRouteV2InstructionDataDecoder().decode(quote.instruction.data!);
  await transport.send(`actual risk lifecycle ${index}:${side}`,[{...quote.instruction,
    accounts:[...quote.instruction.accounts!,{address:fixture.markets[1-index],role:AccountRole.WRITABLE}],
    data:sdk.getExecuteMarginRouteV2InstructionDataEncoder().encode({...await fixture.stamp(),intent})}],[signer]);
}
await fixture.qualify();await route(0,0,[50n,50n]);await route(1,0,[2n,3n]);await route(1,0,[1n],receiver,receiverOwner);
await fixture.publish(0,{price:52_000_000_000n});await fixture.publish(2,{price:52_000_000_000n});await fixture.qualify();
await transport.finalize();
const anchor=transport.checks.find(check=>check.label==='setup clearing group')!.signature;
const config:GroupConfig={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:process.env.RIVALT_DATABASE_URL!,
  runId:'p21-risk-services',group:fixture.group,anchor,profile:'cross-safety-qualification'};
let indexer=new GroupIndexer(config),replay:GroupIndexer|undefined;
const runtime=new GroupRuntime(config.databaseUrl,config.runId,config.rpcUrl),children:ChildProcess[]=[],captures:Record<string,Record<string,string|null>>={};
const stop=async(child:ChildProcess,signal:NodeJS.Signals='SIGTERM')=>{if(child.exitCode!==null||child.signalCode!==null)return;child.kill(signal);
  await eventually(async()=>child.exitCode!==null||child.signalCode!==null,Boolean,'owned risk process stop');};
function start(role:'risk'|'executor'|'maker',key=receiverOwner,marketIndex?:number,makerId?:number){
  const name=`${role}-${children.length}`,path=`${directory}/signer-${name}.json`;
  writeFileSync(path,JSON.stringify(Array.from(key.secretKey)),{mode:0o600});
  const child=spawn(process.execPath,['--import','tsx',`packages/services/src/${role==='executor'?'group-executor-main':'group-worker-main'}.ts`],{
    cwd:process.cwd(),env:{...process.env,RIVALT_RUN_ID:config.runId,RIVALT_GROUP_ROLE:role,RIVALT_SIGNER_PATH:path,RIVALT_RECEIVER_MARGIN:receiver,
      RIVALT_MARKET_INDEX:String(marketIndex),RIVALT_MAKER_ID:String(makerId)},stdio:['ignore','pipe','pipe']});
  const output=createWriteStream(`${directory}/${name}.log`);child.stdout!.pipe(output,{end:false});child.stderr!.pipe(output,{end:false});child.once('exit',()=>output.end());
  children.push(child);return child;
}
async function capture(label:string){
  const keys=[fixture.group,fixture.registry,fixture.vault,fixture.guard,fixture.resolution,...fixture.markets,...fixture.roots,
    ...fixture.operators.map(operator=>operator.token.address),receiverToken.address];
  captures[label]=Object.fromEntries(await Promise.all(keys.map(async key=>[key,(await h.read(key))?.toString('base64')??null])));
  writeFileSync(`${directory}/captures.json`,json(captures));
}
const resolution=async()=>sdk.getGroupResolutionV2Decoder().decode((await h.read(fixture.resolution))!);
async function nextIntent(prefix:string){
  const intent=await eventually<{request_id:string;signature:string;wire:string}|undefined>(async()=>(await runtime.store.pool.query(
    'SELECT request_id,signature,wire FROM service_intents WHERE run_id=$1 AND starts_with(request_id,$2) ORDER BY created_at LIMIT 1',[config.runId,prefix])).rows[0],value=>Boolean(value),prefix);
  assert(intent);return intent;
}
async function drain(){
  const intents=(await runtime.store.pool.query('SELECT request_id FROM service_intents WHERE run_id=$1',[config.runId])).rows;
  for(const intent of intents){const result=await eventually(()=>runtime.queue.get(intent.request_id),row=>['finalized','failed'].includes(row?.status),'original risk finality');assert.equal(result.status,'finalized');}
}
try{
  await indexer.open();await indexer.cycle();await runtime.open();const {binding}=await indexer.store.snapshot();
  await capture('before-liquidation');let risk=start('risk');
  const liquidation=await nextIntent('risk:liquidate:');await stop(risk);const executor=start('executor');
  await eventually(()=>runtime.queue.get(liquidation.request_id),row=>row?.status==='finalized','funded receiver liquidation');
  await capture('after-liquidation');
  const targetAfter=await fixture.rootState(fixture.cross),receiverAfter=await fixture.rootState(receiver);
  assert.equal(targetAfter.positions[0].lots,36n);assert.equal(receiverAfter.positions[0].lots,64n);assert.equal(receiverAfter.positions[1].lots,1n);
  await route(0,1,[32n,32n],receiver,receiverOwner);await route(0,1,[18n,18n]);await route(1,1,[2n,3n]);await route(1,1,[1n],receiver,receiverOwner);
  const makerWorkers:ChildProcess[]=[];
  for(const marketIndex of [0,1])for(const makerId of [0,1])makerWorkers.push(start('maker',fixture.operators[makerId+1].owner,marketIndex,makerId));
  // One distinct portfolio/owner per added member makes the real reconciled
  // identity set exceed a single 100-account RPC request, without fake rows.
  while(fixture.roots.length<64){
    const index=fixture.roots.length,owner=await fixtureKey(`p21-risk-member-${index}`);
    await transport.send('cohort owner rent',[getTransferSolInstruction({source:fixture.payer,destination:owner.address,amount:50_000_000n})]);
    const [portfolio]=await sdk.findGroupPortfolioPda({group:fixture.group,owner:owner.address,index:0});
    const [margin]=await sdk.findMarginPda({portfolio,subaccountIndex:0});
    await transport.send('distinct cohort portfolio',[await sdk.getCreatePortfolioV2InstructionAsync({...fixture.common,owner,index:0})],[owner]);
    await transport.send('canonical member before default',[await sdk.getRegisterMarginV2InstructionAsync({...fixture.common,owner,portfolio,subaccountIndex:0,mode:0,isolatedMarketIndex:255,role:0})],[owner]);
    fixture.roots.push(margin);
  }
  // Exercise the real owner publication/sync path, with a declared 2,400-slot
  // initial epoch. All renewed epochs retain the runtime's 3,600-slot policy.
  const epochDeadline=Date.now()+150_000;
  while(true){
    const registrations=await Promise.all(fixture.makers.flat().map(async maker=>sdk.getMakerRegistrationV2Decoder().decode((await h.read(maker.registration))!)));
    if(registrations.every(registration=>registration.quoteEpoch>1n))break;
    assert(Date.now()<epochDeadline,'Bounded real maker epoch renewal');await delay(500);
  }
  for(const worker of makerWorkers)await stop(worker);await drain();
  await fixture.qualify();await route(0,0,[10n,10n]);await route(1,0,[5n,5n]);
  await fixture.publish(0,{price:10_000_000_000n});await fixture.publish(2,{price:10_000_000_000n});
  await fixture.publish(4,{price:4_000_000_000n});await fixture.publish(5,{price:4_000_000_000n});await fixture.qualify();
  await transport.send('allocate actual venue fees to insurance',[sdk.getAllocateGroupFeesV2Instruction({...fixture.common,authority:fixture.payer,amount:1000n})]);
  await transport.send('actual insurance token donation',[getTransferCheckedInstruction({source:fixture.operators[0].token.address,mint:fixture.mint.address,
    destination:fixture.vault,authority:fixture.owner,amount:7n,decimals:6})],[fixture.owner]);
  await transport.send('classify actual donated surplus',[sdk.getClassifyGroupSurplusV2Instruction({...fixture.common,authority:fixture.payer})]);
  await transport.send('ordinary pause cannot block default',[sdk.getPauseGroupCustodyV2Instruction({...fixture.common,authority:fixture.payer,paused:true})]);
  await capture('before-default');await stop(executor);risk=start('risk');
  const freeze=await nextIntent('risk:freeze:');await stop(risk);start('executor');
  await eventually(()=>runtime.queue.get(freeze.request_id),row=>row?.status==='finalized','authenticated paused-group freeze');
  await capture('frozen-default');assert.equal((await resolution()).header.stage,2);
  risk=start('risk');
  const deadline=Date.now()+14*60_000;let killed=false,lastStage=-1,totalNotifications=0;
  while((await resolution()).header.stage!==12){
    assert(Date.now()<deadline,'Bounded complete-group worker resolution');const header=(await resolution()).header;
    if(header.stage!==lastStage){console.log(json({stage:'resolution-progress',pass:header.stage,cursor:header.cursor,count:header.count}));lastStage=header.stage;}
    if(!killed&&header.stage===3&&header.cursor>=4){
      const killedPid=risk.pid;await stop(risk,'SIGKILL');await drain();
      await indexer.cycle();const partial=await indexer.store.snapshot();assert.equal(partial.state.group?.mode,3);await indexer.reconcile();
      totalNotifications+=indexer.metrics.notifications;await indexer.close();indexer=new GroupIndexer(config);await indexer.open();await indexer.cycle();
      assert.deepEqual((await indexer.store.snapshot()).state,partial.state);await indexer.reconcile();
      risk=start('risk');killed=true;writeFileSync(`${directory}/restart.json`,json({killed:killedPid,restarted:risk.pid,stage:header.stage,cursor:header.cursor}));
    }
    await delay(250);
  }
  assert(killed);await stop(risk);await drain();await capture('complete-default');
  // Recovery checks can observe, but never resume or re-enable cross trading.
  for(let index=0;index<6;index++)await fixture.publish(index);
  risk=start('risk');
  await eventually(resolution,state=>state.header.recoverySince>0n&&state.header.recoveryLast-state.header.recoverySince>=6n,'permissionless recovery qualification');
  await stop(risk);await drain();assert.equal((await fixture.groupState()).mode,3);
  await transport.send('explicit authority resumes isolated mode',[sdk.getRecoverGroupResolutionV2Instruction({...fixture.safety,...fixture.sources,
    caller:fixture.payer,epoch:(await resolution()).header.epoch,resume:true})]);
  assert.equal((await fixture.groupState()).mode,1);await capture('resumed-default');
  await transport.finalize();await indexer.cycle();const final=await indexer.store.snapshot();
  const chunkSizes:number[]=[],call=indexer.rpc.call.bind(indexer.rpc);
  indexer.rpc.call=async(method:string,params:unknown[]=[])=>{if(method==='getMultipleAccounts')chunkSizes.push((params[0] as unknown[]).length);return call(method,params);};
  const reconciliation=await indexer.reconcile();assert(reconciliation.accounts>100);assert(chunkSizes.length>=2&&chunkSizes.every(size=>size<=100));
  const direct=await runtime.snapshot();assert.equal(direct.members.length,64);assert.equal(Object.keys(direct.portfolios).length,60);
  await indexer.store.pool.query('CREATE DATABASE rivalt_p21_risk_replay');const replayUrl=new URL(config.databaseUrl);replayUrl.pathname='/rivalt_p21_risk_replay';
  replay=new GroupIndexer({...config,databaseUrl:replayUrl.toString(),runId:'p21-risk-replay'});await replay.open();await replay.cycle();
  assert.deepEqual((await replay.store.snapshot()).state,final.state);await replay.reconcile();
  const intents=(await runtime.store.pool.query('SELECT request_id,signature,wire,budget FROM service_intents WHERE run_id=$1 ORDER BY created_at',[config.runId])).rows;
  const transactions=[],spent=new Map<string,bigint>();
  for(const intent of intents){
    const transaction=await transport.rpc.call('getTransaction',[intent.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    assert.equal(transaction.transaction[0]===intent.wire,true);assert.equal(transaction.meta.err,null);
    const isPage=intent.request_id.startsWith('risk:page:'),units=transaction.meta.computeUnitsConsumed;
    assert(units*5<=(isPage?1_200_000:400_000)*4,'Actual risk compute headroom');
    spent.set(intent.budget,(spent.get(intent.budget)??0n)+BigInt(transaction.meta.fee));
    transactions.push({requestId:intent.request_id,signature:intent.signature,budget:intent.budget,fee:transaction.meta.fee,units,bytes:Buffer.from(intent.wire,'base64').length});
  }
  const budgets=(await runtime.store.pool.query('SELECT name,cap::text,committed::text,spent::text FROM service_budgets WHERE run_id=$1 ORDER BY name',[config.runId])).rows;
  for(const budget of budgets){assert.equal(budget.committed,'0');assert.equal(budget.spent,(spent.get(budget.name)??0n).toString());}
  const finishedRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const summary={revision,finishedRevision,trackedDirty:startedDirty||dirty()||revision!==finishedRevision,binding,
    scope:'P21A funded liquidation, paused-group default, 64-member process/indexer recovery; AwaitValuation/artifact binding/full A26A still separate',
    keys:{group:fixture.group,registry:fixture.registry,vault:fixture.vault,resolution:fixture.resolution,markets:fixture.markets,roots:fixture.roots,liquidationTarget:fixture.cross,receiver},
    transactions,budgets,reconciliation,chunkSizes,freshReplay:true,ws:totalNotifications+indexer.metrics.notifications,
    fixtureOutcomes:transport.checks.map(({history,...check})=>check)};
  writeFileSync(`${directory}/summary.json`,json(summary));
  const audit=execFileSync('python3',['tests/financial/group-service-risk-reference.py',directory],{encoding:'utf8'});
  writeFileSync(`${directory}/independent-audit.json`,audit);console.log(audit.trim());
  console.log(json({stage:'group-risk-services-pass',transactions:transactions.length,reconciliation}));
}catch(error){
  // Retain original failures while RPC/PG are still alive, before owned cleanup.
  try{
    const failed=(await runtime.store.pool.query('SELECT request_id,signature,wire,status,budget,result FROM service_intents WHERE run_id=$1 ORDER BY created_at',[config.runId])).rows;
    writeFileSync(`${directory}/failed-run-intents.json`,json(failed));
    for(const [index,intent] of failed.entries()){
      const transaction=await transport.rpc.call('getTransaction',[intent.signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:0}]);
      writeFileSync(`${directory}/failed-run-original-${index}.json`,json(transaction));
    }
  }catch{ /* Cleanup still runs if the failed transport is unavailable. */ }
  throw error;
}finally{
  for(const child of children)await stop(child).catch(()=>child.kill('SIGKILL'));
  await replay?.close();await indexer.close();await runtime.close();
}
