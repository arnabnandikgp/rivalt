/** P21B: fixed 150-offer/300-second population, real faults and reconciled exits. */
import assert from 'node:assert/strict';
import {execFileSync,type ChildProcess} from 'node:child_process';
import {writeFileSync,appendFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import type {Address,Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {GroupIndexer,type GroupConfig} from '../../packages/indexer/src/group-indexer.js';
import {GroupRuntime} from '../../packages/services/src/group-runtime.js';
import {GroupQuoteUnavailable} from '../../packages/services/src/group-quote.js';
import {groupApi} from '../../packages/indexer/src/group-api.js';
import {groupServiceApi} from '../../packages/services/src/group-service-api.js';
import {json} from '../../packages/indexer/src/events.js';
import {groupRuntimeHarness} from '../rpc-contract/group-runtime-harness.js';
import {groupSafetyCases} from '../rpc-contract/group-safety-cases.js';
import {WorkloadActors,until} from './group-workload-actors.js';
import {workloadMetrics,type WorkloadOffer} from './group-workload-metrics.js';

const directory=process.env.RIVALT_RUN_DIR!,revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=()=>Boolean(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim());assert(!dirty(),'Qualification requires a clean tracked revision');
execFileSync('python3',['ops/check-ports.py','18096']);
const transport=await groupRuntimeHarness(process.env.RIVALT_RPC_URL!,directory),h=transport.harness;
const setup=await groupSafetyCases(h,async()=>{},{namespace:'p21-workload',setupOnly:true}),fixture=setup.fixture;
await setup.certificate();await transport.send('activate qualified workload group',[sdk.getActivateCrossGroupV2Instruction({...fixture.safety,authority:fixture.payer})]);
// Exactly equal trader capital: one 1m cross root versus two 500k isolated roots.
for(const root of fixture.operators[0].capital){await setup.certificate();await transport.send('allocate equal comparison capital',[await setup.cashInstruction(root,500_000n,true)],[fixture.owner]);}
await transport.send('fund equal-capital cross account',[await setup.cashInstruction(fixture.cross,1_000_000n,false)],[fixture.owner]);
await fixture.qualify();await transport.finalize();
const anchor=transport.checks.find(check=>check.label==='setup clearing group')!.signature;
const config:GroupConfig={rpcUrl:process.env.RIVALT_RPC_URL!,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:process.env.RIVALT_DATABASE_URL!,runId:'p21-workload',group:fixture.group,anchor,profile:'cross-safety-qualification'};
let indexer=new GroupIndexer(config),replay:GroupIndexer|undefined;
const runtime=new GroupRuntime(config.databaseUrl,config.runId,config.rpcUrl),actors=new WorkloadActors(config,runtime,directory),app=groupServiceApi(runtime);
const offers:WorkloadOffer[]=[],otherWallet:any[]=[],exitAttempts:any[]=[],sourceErrors:string[]=[];
const pending=new Set<string>(),promises:Promise<void>[]=[];
let sourceStop=false,sourceTask:Promise<void>|undefined,started=0,indexerChild:ChildProcess|undefined,sourceOutage=false;
const funding:ChildProcess[]=[],makers:ChildProcess[]=[];
const keys={group:fixture.group,registry:fixture.registry,vault:fixture.vault,resolution:fixture.resolution,markets:fixture.markets,roots:fixture.roots,
  traderRoots:[fixture.cross,...fixture.operators[0].capital],tokens:fixture.operators.map(operator=>operator.token.address)};
async function capture(name:string){const raw:Record<string,string|null>={};for(const key of [keys.group,keys.registry,keys.vault,keys.resolution,...keys.markets,...keys.roots,...keys.tokens])raw[key]=(await h.read(key))?.toString('base64')??null;writeFileSync(`${directory}/${name}.json`,json(raw));}
const phase=(elapsed:number)=>elapsed<50_000?'normal-before-faults':elapsed<95_000?'ETH-source-outage-and-recovery':elapsed<125_000?'RPC-acknowledgement-and-executor-recovery':elapsed<215_000?'maker-loss-and-epoch-recovery':elapsed<245_000?'worker-indexer-restarts':'normal-after-faults';
try{
  await indexer.open();await indexer.cycle();await runtime.open();await actors.open();const {binding}=await indexer.store.snapshot();
  const client=new sdk.GroupUserClient({version:2,chain:'solana:localnet',profile:'cross-safety-qualification',rpcUrl:config.rpcUrl,wsUrl:config.wsUrl,
    genesis:binding.genesis,anchor,anchorHash:binding.anchorHash,group:fixture.group,mint:fixture.mint.address,domain:binding.domain});
  const endpoint=await app.listen({host:'127.0.0.1',port:0});
  // These are real unsigned on-chain simulations, not extra load fills.
  const capitalComparison:any[]=[];
  for(const marketIndex of [0,1] as const)for(const [mode,margin] of [['cross',fixture.cross],['isolated',fixture.operators[0].capital[marketIndex]]] as const){
    const quote=await client.quote(fixture.owner.address,margin,marketIndex,0,100n,{maxFee:1_000_000n,allInLimit:100_000_000n});
    let simulated=false;if(quote){await client.prepare('equal-capital unsigned comparison',fixture.owner.address,quote.instructions);simulated=true;}
    capitalComparison.push({mode,margin,marketIndex,lots:'100',accountCash:(await client.snapshot()).roots[margin].cash,available:!!quote,simulated,
      totalModeCapital:'1000000',initialMarginBps:1000,maintenanceMarginBps:500,positiveUnpaidCredit:'0',correlationDiscount:'0'});
  }
  assert(capitalComparison.find(row=>row.mode==='cross'&&row.marketIndex===0).simulated);
  assert(!capitalComparison.find(row=>row.mode==='isolated'&&row.marketIndex===0).available);
  const initial=await client.snapshot();await capture('initial-accounts');
  await indexer.close();indexerChild=actors.start('indexer');actors.start('executor');
  for(const market of [0,1])for(const maker of [0,1])makers.push(actors.start('maker',fixture.operators[maker+1].owner,market,maker));
  for(const market of [0,1])funding.push(actors.start('funding',fixture.payer,market));
  sourceTask=(async()=>{while(!sourceStop){try{for(let feed=0;feed<6;feed++)if(!(sourceOutage&&feed>=4))await fixture.publish(feed);}catch(error){sourceErrors.push(String(error));}await delay(1000);}})();
  await until(()=>runtime.snapshot('confirmed'),state=>state.makers.every(maker=>maker.online)&&state.marketStates.every(market=>sdk.groupSourceMode(state.state,market,state.now,state.slot)==='Normal'),'live makers and qualified continuous sources');
  await until(()=>fetch('http://127.0.0.1:18096/ready').then(response=>response.status),status=>status===200,'live indexer');
  async function submit(label:string,instructions:Instruction[],key:Keypair,offer?:WorkloadOffer){
    const prepared=await client.prepare(label,key.address,instructions);if(offer)offer.preparedMs=Date.now();
    await prepared.transaction.sign([key]);const intent=await client.signed(prepared,prepared.transaction);
    if(offer){offer.signature=intent.signature;offer.wire=intent.wire;offer.bytes=Buffer.from(intent.wire,'base64').length;}
    writeFileSync(`${directory}/original-${intent.id}.json`,json(intent));
    if(offer?.population==='scheduled'&&Date.now()-started>=100_000&&!actors.expectedWire){actors.expectedWire=intent.wire;actors.expectedSignature=intent.signature;}
    const directReceipt=offer?undefined:{label,signature:intent.signature,wire:intent.wire,status:'pending'};
    if(directReceipt)otherWallet.push(directReceipt);
    if(offer){
      const response=await fetch(`${endpoint}/v2/submit`,{method:'POST',headers:{'content-type':'application/json'},body:json({requestId:intent.id,wire:intent.wire})});
      assert.equal(response.status,200);const submitted=await response.json();assert.equal(submitted.signature,intent.signature);offer.submittedMs=Date.now();
    }else{
      // Certification and cash exit are direct SDK actions, outside service ingress.
      // A lost acknowledgement still reconciles the same saved signature.
      await client.broadcast(intent).catch(()=>{});
    }
    const final=await until(()=>client.reconcile(intent),row=>['finalized','failed'].includes(row.status),`original ${label}`,35_000);
    if(offer)await until(()=>runtime.queue.get(intent.id),row=>['finalized','failed'].includes(row?.status),'original service reconciliation');
    const transaction=await transport.rpc.call('getTransaction',[intent.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    assert.equal(transaction.transaction[0],intent.wire);assert.equal(String(transaction.meta.fee),final.fee);
    const result={label,signature:intent.signature,wire:intent.wire,status:final.status,error:transaction.meta.err,fee:String(transaction.meta.fee),units:transaction.meta.computeUnitsConsumed,bytes:Buffer.from(intent.wire,'base64').length};
    writeFileSync(`${directory}/original-finalized-${intent.id}.json`,json(transaction));
    if(offer)Object.assign(offer,{status:final.status,reason:final.status==='failed'?(transaction.meta.logMessages?.some((line:string)=>line.includes('group_margin/mod.rs:21'))?'group-sequence-race':`chain:${json(transaction.meta.err)}`):undefined,finalizedMs:Date.now(),fee:result.fee,units:result.units});
    else Object.assign(directReceipt!,result);return result;
  }
  async function attempt(id:number,margin:Address,marketIndex:0|1,scheduledMs:number,population:'scheduled'|'drain',key=fixture.owner){
    const offer:WorkloadOffer={id,population,phase:population==='scheduled'?phase(scheduledMs-started):'position-drain',margin,marketIndex,scheduledMs,startedMs:Date.now(),status:'offered'};offers.push(offer);
    const persist=()=>{offer.finishedMs=Date.now();appendFileSync(`${directory}/offers.jsonl`,json(offer)+'\n');};
    if(population==='scheduled'&&offer.startedMs-scheduledMs>1000){offer.status='not-attempted';offer.reason='scheduler-deadline-missed';persist();return;}
    if(pending.has(margin)){offer.status='not-attempted';offer.reason='account-original-pending';persist();return;}
    pending.add(margin);
    try{
      const state=await client.snapshot('confirmed'),position=state.roots[margin].positions[marketIndex];
      const side=position.lots>0n?1:0,lots=population==='drain'?(position.lots<0n?-position.lots:position.lots):5n;
      if(lots===0n){offer.status='not-attempted';offer.reason='already-flat';return;}
      offer.side=side;offer.lots=String(lots);
      const quote=await runtime.quote(key.address,margin,marketIndex,side,lots);offer.diagnostic=quote.diagnostic;
      if(!quote.available){offer.status='quote-refused';offer.reason=quote.code;return;}offer.quoteMs=Date.now();
      // Build again from direct authenticated RPC; service messages are advisory.
      const direct=await client.quote(key.address,margin,marketIndex,side,lots,{maxFee:1_000_000n,allInLimit:side===0?100_000_000n:0n,reduceOnly:position.lots!==0n});
      if(!direct){offer.status='quote-refused';offer.reason='direct-maker-capacity-or-whole-account-health';return;}
      offer.allocation=direct.allocation;
      await submit(`workload ${population} ${id}`,direct.instructions,key,offer);
    }catch(error){offer.error=String(error);
      if(error instanceof GroupQuoteUnavailable){offer.status='quote-refused';offer.reason=error.code;offer.diagnostic=error.diagnostic;}
      else if(offer.signature){offer.status='unresolved';offer.reason='signed-original-requires-reconciliation';}
      else {offer.status='prepare-refused';offer.reason=/\((\d{4})\)/.test(String(error))?`simulation:${String(error).match(/\((\d{4})\)/)![1]}`:
        String(error).includes('source unavailable')?'required-market-source-unavailable':String(error).includes('changed')?'snapshot-changed':'input-or-rpc-unavailable';}
    }finally{if(offer.status!=='unresolved')pending.delete(margin);persist();}
  }
  started=Date.now();const faultDone=new Set<string>();
  async function faults(elapsed:number){
    const once=async(name:string,when:number,run:()=>Promise<void>)=>{if(elapsed>=when&&!faultDone.has(name)){faultDone.add(name);await run();actors.faults.push({kind:name,at:Date.now(),elapsedMs:Date.now()-started});}};
    await once('ETH-publishers-stopped',50_000,async()=>{sourceOutage=true;});
    await once('ETH-publishers-restored',85_000,async()=>{sourceOutage=false;});
    if(actors.dropped&&actors.executor?.signalCode==='SIGKILL')await once('original-executor-restarted',0,async()=>{actors.start('executor');});
    await once('BTC-maker-A-killed',125_000,async()=>{await actors.stop(makers[0],true);});
    await once('BTC-maker-A-restarted',205_000,async()=>{makers[0]=actors.start('maker',fixture.operators[1].owner,0,0);});
    await once('ETH-funding-worker-killed',220_000,async()=>{await actors.stop(funding[1],true);});
    await once('ETH-funding-worker-restarted',226_000,async()=>{funding[1]=actors.start('funding',fixture.payer,1);});
    await once('indexer-killed',232_000,async()=>{await actors.stop(indexerChild!,true);});
    await once('indexer-restarted',238_000,async()=>{indexerChild=actors.start('indexer');});
  }
  const choices=[[fixture.cross,0],[fixture.operators[0].capital[0],0],[fixture.cross,1],[fixture.operators[0].capital[1],1]] as const;
  for(let id=0;id<150;id++){
    const scheduledMs=started+id*2000;await delay(Math.max(0,scheduledMs-Date.now()));await faults(Date.now()-started);
    const [margin,market]=choices[id%choices.length];promises.push(attempt(id,margin,market,scheduledMs,'scheduled'));
    if(id%15===0)console.log(json({stage:'workload-progress',offered:id+1,elapsedMs:Date.now()-started}));
  }
  await delay(Math.max(0,started+300_000-Date.now()));await faults(Date.now()-started);await Promise.all(promises);
  assert.equal(offers.filter(offer=>offer.population==='scheduled').length,150);assert(actors.dropped&&actors.persistedBeforeBroadcast,'Actual original-send fault exercised');
  assert(!offers.some(offer=>offer.status==='unresolved'),'No unresolved wallet original');
  // Close every trader, then internal maker A against B. This is additional drain,
  // not retroactive qualification offered throughput or external hedge evidence.
  for(const [margin,market] of [...choices,[fixture.operators[1].capital[0],0],[fixture.operators[1].capital[1],1]] as const){
    const key=fixture.operators[1].capital.includes(margin)?fixture.operators[1].owner:fixture.owner;
    for(let retries=0;;retries++){
      if((await client.snapshot()).roots[margin].positions[market].lots===0n)break;
      assert(retries<25,'Bounded close drain');await attempt(offers.length,margin,market,Date.now(),'drain',key);await delay(500);
    }
  }
  assert(Object.values((await client.snapshot()).roots).every(root=>root.positions.every(position=>position.lots===0n)),'All internal participant inventory flat');
  // Measure exits while samplers still compete for the group stamp. If a bounded
  // attempt cannot complete, record that limit; explicit quiescent drain follows.
  const exitBaseline=await client.snapshot();
  async function exit(root:Address,busy:boolean){
    for(let attemptIndex=0;attemptIndex<(busy?4:6);attemptIndex++){
      if((await client.snapshot()).roots[root].cash===exitBaseline.roots[root].cash-1n)return true;
      const record:any={root,busy,attempt:attemptIndex,at:Date.now()};exitAttempts.push(record);
      try{const snapshot=await client.snapshot('confirmed'),plan=await client.exit(snapshot,fixture.owner.address,root,fixture.operators[0].token.address,1n);
        record.verificationOnly=plan.verificationOnly;const result=await submit('admissible one-atom exit',plan.instructions,fixture.owner);Object.assign(record,{signature:result.signature,status:result.status});}
      catch(error){record.status='unsigned-refused';record.error=String(error);if(otherWallet.some(receipt=>receipt.status==='pending'))throw error;}
    }
    return (await client.snapshot()).roots[root].cash===exitBaseline.roots[root].cash-1n;
  }
  const busyExits=[];for(const root of keys.traderRoots)busyExits.push({root,completed:await exit(root,true)});
  for(const child of [...funding,...makers])await actors.stop(child);sourceStop=true;await sourceTask;
  actors.faults.push({kind:'explicit-flat-post-workload-quiescence',at:Date.now()});
  await until(()=>runtime.queue.pending(),rows=>rows.length===0,'all worker originals drained');
  for(const root of keys.traderRoots)assert(await exit(root,false),'Final admissible funded exit');
  await until(()=>runtime.queue.pending(),rows=>rows.length===0,'all wallet originals drained');
  await actors.stop(actors.executor!);await actors.stop(indexerChild!);await transport.finalize();
  indexer=new GroupIndexer(config);await indexer.open();await indexer.cycle();const final=await indexer.store.snapshot(),reconciliation=await indexer.reconcile();
  await capture('final-accounts');
  const historyApi=groupApi(indexer);
  try{const history=await historyApi.inject('/v2/trades?latest=true&limit=30');assert.equal(history.statusCode,200);
    const sequences=history.json().items.map((row:any)=>BigInt(row.sequence));assert(sequences.length>0);
    assert(sequences.every((value:bigint,index:number)=>index===0||value>sequences[index-1]),'Actual PostgreSQL history is numerically ordered');
    const latest=(await runtime.store.pool.query("SELECT max(sequence)::text AS sequence FROM events WHERE run_id=$1 AND kind='margin-route'",[config.runId])).rows[0].sequence;
    assert.equal(String(sequences.at(-1)),latest);
  }finally{await historyApi.close();}
  const events=(await runtime.store.pool.query('SELECT sequence::text,signature,kind,payload,bytes FROM events WHERE run_id=$1 AND sequence>$2 ORDER BY events.sequence',[config.runId,initial.state.sequence.toString()])).rows;
  writeFileSync(`${directory}/financial-events.json`,json(events));
  const intents=(await runtime.store.pool.query('SELECT request_id,signature,wire,status,budget,result FROM service_intents WHERE run_id=$1 ORDER BY created_at',[config.runId])).rows;
  const fees=new Map<string,bigint>();
  for(const intent of intents){assert(['finalized','failed'].includes(intent.status));const original=await transport.rpc.call('getTransaction',[intent.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    assert.equal(original.transaction[0],intent.wire);assert.equal(String(original.meta.fee),intent.result.fee);
    if(intent.budget)fees.set(intent.budget,(fees.get(intent.budget)??0n)+BigInt(original.meta.fee));}
  const budgets=(await runtime.store.pool.query('SELECT name,cap::text,committed::text,spent::text FROM service_budgets WHERE run_id=$1',[config.runId])).rows;
  for(const budget of budgets){assert.equal(budget.committed,'0');assert.equal(BigInt(budget.spent),fees.get(budget.name)??0n);}
  await indexer.store.pool.query('CREATE DATABASE rivalt_p21_workload_replay');const replayUrl=new URL(config.databaseUrl);replayUrl.pathname='/rivalt_p21_workload_replay';
  replay=new GroupIndexer({...config,databaseUrl:replayUrl.toString(),runId:'p21-workload-replay'});await replay.open();await replay.cycle();assert.deepEqual((await replay.store.snapshot()).state,final.state);await replay.reconcile();
  const ws=(await runtime.store.pool.query("SELECT count(*)::text FROM observations WHERE run_id=$1 AND source='ws-confirmed'",[config.runId])).rows[0].count;assert(BigInt(ws)>0n);
  const finishedRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(finishedRevision,revision);assert(!dirty());
  writeFileSync(`${directory}/summary.json`,json({revision,finishedRevision,trackedDirty:false,binding,keys,initialSequence:initial.state.sequence,
    durationMs:300000,offeredIntervalMs:2000,started,metrics:workloadMetrics(offers),offers,otherWallet,capitalComparison,busyExits,exitAttempts,
    faults:actors.faults,sourceErrors,originalAcknowledgementFault:{signature:actors.expectedSignature,persistedBeforeBroadcast:actors.persistedBeforeBroadcast,dropped:actors.dropped},
    budgets,intents,reconciliation,freshReplay:true,numericHistoryChecked:true,ws,allInventoryFlat:true,actualWithdrawnAtoms:'3',fixtureTransactions:transport.checks.length}));
  const audit=execFileSync('python3',['tests/financial/group-workload-reference.py',directory],{encoding:'utf8'});writeFileSync(`${directory}/independent-audit.json`,audit);console.log(audit.trim());
  console.log(json({stage:'group-workload-pass',metrics:workloadMetrics(offers),reconciliation}));
}catch(error){writeFileSync(`${directory}/workload-failure.json`,json({revision,error:String(error),offers,otherWallet,exitAttempts,faults:actors.faults,sourceErrors}));throw error;}
finally{sourceStop=true;await sourceTask;await actors.close();await app.close();await replay?.close();await indexer.close().catch(()=>{});await runtime.close();}
