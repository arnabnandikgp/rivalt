import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpus,totalmem } from 'node:os';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync, statfsSync, readdirSync, statSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { observer } from './observer.js';
import { verifyReads } from './read-api.js';
import { sustained } from './sustained.js';
import { AccountRole } from '@solana/kit';
import { performance } from 'node:perf_hooks';
import * as sdk from '@rivalt/sdk';
import { Indexer } from '../../packages/indexer/src/index.js';
import { json, decode } from '../../packages/indexer/src/events.js';
import { environment, wait } from './environment.js';
import { summarize, type Attempt } from './metrics.js';
import { submissionFault } from './submission-fault.js';
import { largeHistory } from './history.js';
import { resources as diskResources } from './resources.js';
import { publicIntents } from '../e2e/evidence.js';

const args=process.argv.slice(2),modes=['--sweep-seconds','--exercise-seconds','--exercise-tail-seconds','--final-check-seconds','--qualification-seconds','--soak-seconds'].filter(x=>args.includes(x));
if(modes.length!==1)throw new Error('Declare one finite sweep, 900-second exercise, 360-second tail, 180-second final check, 1800-second qualification, or actual 86400-second soak');
const mode=modes[0],extended=mode!=='--sweep-seconds',long=mode==='--soak-seconds',qualification=mode==='--qualification-seconds',seconds=Number(args[args.indexOf(mode)+1]);
if(!Number.isInteger(seconds)||(long?seconds!==86400:extended?seconds!==(qualification?1800:mode==='--exercise-tail-seconds'?360:mode==='--final-check-seconds'?180:900):seconds<10||seconds>3600))throw new Error('Invalid real elapsed duration');
const rates=args.includes('--rates')?args[args.indexOf('--rates')+1]?.split(',').map(Number):(extended?[.25]:[1,5,10]);
if(!rates?.length||rates.length>5||new Set(rates).size!==rates.length||rates.some(r=>![.25,.5,1,5,10].includes(r))||extended&&(rates.length!==1||rates[0]>1))throw new Error('Declare supported unique rates; sustained run has one baseline');
const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8'}).trim();
const revision=git('rev-parse','HEAD'),sourceDirty=Boolean(git('status','--porcelain'));
if(sourceDirty&&!args.includes('--development'))throw new Error('Commit source before acceptance; --development is explicitly provisional');
const dir=process.env.RIVALT_RUN_DIR!,startedUtc=new Date().toISOString(),records:Attempt[]=[],faults:any[]=[],phases:any[]=[];
const manifest={revision,sourceDirty,startedUtc,command:process.argv.slice(2),host:{platform:process.platform,arch:process.arch,node:process.version,logicalCpus:cpus().length,physicalMemoryBytes:totalmem()},
  slotTimeMs:50,surfpoolInstructionProfiling:false,fundingIntervalSeconds:5,quoteDispatchMarginSeconds:1,minRemainingQuoteSlots:10,quoteSnapshotCommitment:'confirmed',budgetProfile:'soak24',maxRecoveryTransactions:200000,
  accountMix:'3 funded trader owners, 2 shared maker participants, 1 funded risk receiver; round-robin attempts, at most one unresolved attempt per trader; open sizes 1 lot or 100 every tenth offered attempt, close the same actual exposure',
  transport:'HTTP quote and immutable submission journal; separate executor/other worker processes; actual finalized RPC + PostgreSQL/WS indexer',
  latencyDefinition:'Monotonic elapsed milliseconds; processed/confirmed times are first polling observations (upper bounds), wallet fixture signing separate; every offered attempt retained',
  traderBuild:extended?Object.fromEntries(readdirSync('apps/trader/dist',{recursive:true}).map(String).filter(n=>statSync('apps/trader/dist/'+n).isFile()).sort().map(n=>[n,createHash('sha256').update(readFileSync('apps/trader/dist/'+n)).digest('hex')])):null,
  binaries:Object.fromEntries(['clearing','maker_a','maker_b','oracle_fixture'].map(n=>[n,createHash('sha256').update(readFileSync(`target/deploy/${n}.so`)).digest('hex')])),
  identities:Object.fromEntries(['Cargo.lock','pnpm-lock.yaml','tests/anchor-conformance/pnpm-lock.yaml','scenarios/local-profile-v1.json'].map(n=>[n,createHash('sha256').update(readFileSync(n)).digest('hex')]))};
writeFileSync(`${dir}/manifest.json`,json(manifest));
console.log(`P12 provisional=${sourceDirty} environment ${dir}`);
let env:Awaited<ReturnType<typeof environment>>|undefined,ui:Awaited<ReturnType<typeof observer>>|undefined,control:ReturnType<typeof sustained>|undefined;
let visibility:any=null,sustainedResult:any=null,historyResult:any=null;const auxiliaries:Indexer[]=[];const index=(config:ConstructorParameters<typeof Indexer>[0])=>{const x=new Indexer(config);auxiliaries.push(x);return x;};

try{
  env=await environment();const e=env;
  const binding=await e.runtime.environment();
  const client=new sdk.UserClient({version:1,chain:'solana:localnet',rpcUrl:e.url,wsUrl:e.wsUrl,genesis:binding.genesis,anchor:binding.anchor,market:e.a.market,mint:e.setup.mint.address,domain:binding.domain});
  function broadcastTimes(){
    const earliest=new Map<string,number>();
    for(const name of readdirSync(dir).filter(n=>/^executor-.*\.log$/.test(n)))for(const line of readFileSync(`${dir}/${name}`,'utf8').split('\n')){
      let value:any;try{value=JSON.parse(line);}catch{continue;}
      if(value.event==='executor-broadcast'&&value.runId===e.runId)earliest.set(value.signature,Math.min(earliest.get(value.signature)??Infinity,value.at));
    }
    for(const row of records){const at=row.signature?earliest.get(row.signature):undefined;if(at!==undefined&&row.signedAtEpochMs!==undefined){row.firstBroadcastMs=at-row.signedAtEpochMs;assert(row.firstBroadcastMs>=0,'Host wall clock moved backwards');}}
    writeFileSync(`${dir}/broadcasts.json`,json(records.filter(r=>r.firstBroadcastMs!==undefined).map(r=>({id:r.id,signature:r.signature,signedAtEpochMs:r.signedAtEpochMs,firstBroadcastMs:r.firstBroadcastMs}))));
  }
  const busy=new Set<number>(),positions=[0n,0n,0n],pending=new Set<Promise<void>>();let offered=0;
  async function request(path:string,body:any){const response=await fetch('http://127.0.0.1:18081'+path,{method:'POST',headers:{'content-type':'application/json'},body:json(body),signal:AbortSignal.timeout(5000)});const result=await response.json() as any;if(!response.ok)throw Object.assign(new Error(result.error??String(response.status)),{code:result.code});return result;}
  async function attempt(phase:string,fault:boolean,scheduled:number){
    const number=offered++,actor=number%3,row:Attempt={id:`load:${number}`,phase,offeredAt:scheduled,actor,fault,status:'offered'};
    records.push(row);
    if(busy.has(actor)){row.status='unfilled-account-busy';appendFileSync(`${dir}/attempts.jsonl`,json(row)+'\n');return;}
    busy.add(actor);const user=e.actors[actor];
    try{
      const lots=positions[actor]===0n?(number%10===0?100n:1n):positions[actor]<0n?-positions[actor]:positions[actor],side=positions[actor]>0n?1:0;
      row.side=side;row.lots=String(lots);const beforeQuote=performance.now();let q:any;
      try{q=await request('/v1/quote',{owner:user.owner.address,side,lots:lots.toString()});}finally{row.quoteMs=performance.now()-beforeQuote;}
      if(!q.available){row.status='unfilled-no-liquidity';return;}
      row.eligible=true;
      appendFileSync(`${dir}/quotes.jsonl.gz`,gzipSync(json({id:row.id,snapshotSlot:q.snapshotSlot,snapshotCommitment:q.snapshotCommitment,confirmedPendingSamples:q.confirmedPendingSamples,audit:q.audit,allocation:q.allocation})+'\n'));
      const validateStarted=performance.now();
      const validated=await client.validateQuote(await client.snapshot('confirmed'),user.owner.address,side,lots,q);
      row.validationMs=performance.now()-validateStarted;const instructions=validated.instructions;
      const signStarted=performance.now(),{transaction}=await sdk.signInstructions(e.connection,user.owner,instructions);
      row.signingMs=performance.now()-signStarted;
      const bytes=transaction.serialize(),wire=Buffer.from(bytes).toString('base64');row.bytes=bytes.length;row.accounts=transaction.message.staticAccountKeys.length;
      const signedAt=performance.now();row.signedAtEpochMs=Date.now();
      // Persist the immutable signature identity before ingress. No signed attempt is rebuilt.
      const signature=await import('@solana/kit').then(({getBase58Decoder})=>getBase58Decoder().decode(transaction.signatures[0]));row.signature=signature;
      appendFileSync(`${dir}/signed.jsonl`,json({requestId:row.id,signature,wireSha256:createHash('sha256').update(bytes).digest('hex'),offeredAt:row.offeredAt,signedAtEpochMs:row.signedAtEpochMs})+'\n');
      try{const result=await request('/v1/submit',{requestId:row.id,wire});assert.equal(result.signature,signature);}catch{row.code='submission-acknowledgement-unknown';}
      row.submitMs=performance.now()-signedAt;row.status='unresolved';
      const end=performance.now()+30_000;
      while(performance.now()<end){
        const result=await e.rpc.call('getSignatureStatuses',[[signature],{searchTransactionHistory:true}]);const s=result.value[0],elapsed=performance.now()-signedAt;
        if(s){row.processedMs??=elapsed;if(['confirmed','finalized'].includes(s.confirmationStatus))row.confirmedMs??=elapsed;}
        if(s?.confirmationStatus==='finalized'){
          const tx=await e.rpc.call('getTransaction',[signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
          if(!tx?.meta){await delay(100);continue;}
          assert.deepEqual(tx.meta.err,s.err);e.txLog(row.id,signature,tx);row.finalizedMs=elapsed;row.fee=String(tx.meta.fee);row.units=tx.meta.computeUnitsConsumed;
          row.status=tx.meta.err?'failed':'finalized';row.code=tx.meta.err?JSON.stringify(tx.meta.err):undefined;
          const fills=decode(signature,tx,e.a.eventAuthority).filter(x=>x.type==='route');
          if(row.status==='finalized'){assert.equal(fills.length,1);assert.equal(fills[0].data.lots,lots.toString());}
          const p=sdk.getParticipantDecoder().decode((await e.read(user.participant))!);positions[actor]=p.lots;
          if(row.status==='finalized')ui?.track(signature,fills[0].data.sequence,fault);
          const gross=BigInt(fills[0]?.data.grossQuote??0),ref=BigInt(q.audit.referencePrice),sign=side===0?1n:-1n;
          appendFileSync(`${dir}/fills.jsonl.gz`,gzipSync(json({id:row.id,signature,requested:{side,lots},quote:q.allocation,events:fills,shortfall:fills.length?{bpsNumerator:sign*(gross-lots*ref)*10000n,bpsDenominator:lots*ref,venueFeeAtoms:fills[0].data.fee,networkFeeLamports:row.fee}:null})+'\n'));
          break;
        }
        await delay(100);
      }
    }catch(error){row.status=row.signature?'unresolved':'quote-unavailable';row.code=error instanceof Error?String((error as Error&{code?:string}).code??error.message):'request failed';}
    finally{
      // An unresolved signed action retains this account's admission lock for the run.
      if(row.status!=='unresolved')busy.delete(actor);
      appendFileSync(`${dir}/attempts.jsonl`,json(row)+'\n');
    }
  }
  async function capture(label:string){
    const s=await e.runtime.snapshot(),row=await e.runtime.store.snapshot(),disk=statfsSync('.');
    const sample={label,at:new Date().toISOString(),slot:s.slot,chain:{market:{...s.m,grossLots:s.risk.grossLots},participants:s.participants,registry:{count:s.members.length,members:s.members},actualVault:s.actual,risk:s.risk},
      projection:{sequence:row.state.sequence,checkpoint:row.checkpoint,syncedAt:row.synced_at,error:row.error},
      sourceMode:s.sourceMode,diskFreeBytes:disk.bavail*disk.bsize,process:process.memoryUsage(),
      databaseBytes:String((await e.runtime.store.pool.query('SELECT pg_database_size(current_database())::text AS bytes')).rows[0].bytes)};
    appendFileSync(`${dir}/snapshots.jsonl`,json(sample)+'\n');writeFileSync(`${dir}/latest.json`,json(sample));
    execFileSync('python3',['tests/load/reconcile.py',`${dir}/latest.json`],{stdio:['ignore','pipe','pipe']});
    return sample;
  }
  faults.push(await submissionFault(e));
  writeFileSync(`${dir}/submission-fault.json`,json(faults));
  await wait(async()=>{const s=await e.runtime.snapshot();return s.sourceMode==='Normal'&&s.makers.every(x=>x.online);},Boolean,'post-fault normal recovery');
  const openingSnapshot=await capture('start');
  if(extended){
    assert(readFileSync('apps/trader/dist/index.html').length>0,'Built production trader required');
    if(long){const disk=statfsSync('.');assert(disk.bavail*disk.bsize>=3*1024**3,'Reserve at least 3 GiB before the long run');}
    ui=await observer(e);control=sustained(e,seconds,capture,()=>ui!.poll());
  }
  for(const rate of rates){
    const name=`${long?'soak':extended?'exercise':'sweep'}-${rate}`,start=performance.now(),firstWall=Date.now(),first=records.length;
    console.log(`Offered-load ${rate}/s for ${seconds} real seconds`);
    for(let n=0;n<rate*seconds||extended&&Date.now()-firstWall<seconds*1000;n++){
      control?.assertHealthy();const due=start+n*1000/rate;await delay(Math.max(0,due-performance.now()));
      // Bound driver memory; a saturated driver is still an offered/unfilled attempt.
      if(pending.size>=32){const row:Attempt={id:`load:${offered++}`,phase:name,offeredAt:Date.now(),actor:offered%3,fault:control?.fault()??false,status:'unfilled-driver-limit'};records.push(row);appendFileSync(`${dir}/attempts.jsonl`,json(row)+'\n');continue;}
      const task=attempt(name,control?.fault()??false,Date.now());pending.add(task);void task.finally(()=>pending.delete(task));
    }
    await delay(Math.max(0,start+seconds*1000-performance.now()));
    await Promise.all(pending);
    broadcastTimes();const end=performance.now();phases.push({name,rate,durationSeconds:seconds,elapsedSeconds:(end-start)/1000,...summarize(records.slice(first))});
    await capture(name);writeFileSync(`${dir}/progress.json`,json({manifest,phases,faults}));
    console.log(json(phases.at(-1)));
  }
  if(control){sustainedResult=await control.close();control=undefined;assert(sustainedResult.continuity.monotonicSeconds>=seconds&&sustainedResult.continuity.wallSeconds>=seconds);}
  if(ui){for(let n=0;n<6;n++){await ui.poll();await delay(500);}visibility=await ui.close();ui=undefined;}
  if(qualification){
    // Keep authenticated sources/makers/funding alive, but freeze participant cash writers.
    for(const role of ['settlement','orders','risk'])await e.stop(role);
    await wait(async()=>{await e.runtime.execute();return Number((await e.runtime.store.pool.query("SELECT count(*) FROM service_intents WHERE run_id=$1 AND budget IN ('keeper','orders','risk') AND status IN ('pending','unresolved')",[e.runId])).rows[0].count);},n=>n===0,'history participant writers drained');
    historyResult=await largeHistory(e);await capture('after-large-history');
  }
  // Stop new discovery/source changes before final history/fee reconciliation.
  await e.stopSources();for(const role of ['maker-a','maker-b','funding','settlement','orders','risk'])await e.stop(role);
  await wait(async()=>{await e.runtime.execute();return Number((await e.runtime.store.pool.query("SELECT count(*) FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved')",[e.runId])).rows[0].count);},n=>n===0,'terminal known submissions',60_000);
  await e.stop('executor');
  if(extended){
    let s=await e.runtime.snapshot();
    const g=s.certificate,current=g.sequence===s.m.sequence&&g.observation===s.risk.observationSequence&&g.count===s.members.length;
    const start=current?g.next:0,certificate={mode:current?(start===s.members.length?'reuse-complete':'resume'):'new',start,count:s.members.length,sequence:s.m.sequence,observation:s.risk.observationSequence};
    for(let next=start;next<s.members.length;next+=8){
      const ix=await sdk.getCheckExitCohortInstructionAsync({...s,sequence:s.m.sequence,observation:s.risk.observationSequence,start:next});
      await e.send('final complete-cohort exit certificate',[{...ix,accounts:[...ix.accounts,...s.members.slice(next,next+8).map(address=>({address,role:AccountRole.READONLY}))]}]);
    }
    s=await e.runtime.snapshot();assert.equal(s.certificate.sequence,s.m.sequence);assert.equal(s.certificate.observation,s.risk.observationSequence);assert.equal(s.certificate.next,s.members.length);
    const owner=e.actors[0],before=sdk.getParticipantDecoder().decode((await e.read(owner.participant))!).cash;
    const signature=await e.send('final actual one-atom cash withdrawal',[await sdk.getWithdrawTradingInstructionAsync({...s,owner:owner.owner,participant:owner.participant,quoteMint:e.setup.mint.address,userToken:owner.token.address,sequence:s.m.sequence,observation:s.risk.observationSequence,amount:1n})],[owner.owner]);
    assert.equal(sdk.getParticipantDecoder().decode((await e.read(owner.participant))!).cash,before-1n);writeFileSync(`${dir}/withdrawal.json`,json({signature,certificate,cashBefore:before,cashAfter:before-1n,amount:1n}));
  }
  await e.stop('indexer');
  const indexer=index(e.config);await indexer.open();await indexer.cycle();const final=await indexer.reconcile(),state=(await indexer.store.snapshot()).state;const readApi=extended?await verifyReads(indexer):null;if(readApi)writeFileSync(`${dir}/read-api.json`,json(readApi));
  const bound=qualification?10000:2,bounded=index({...e.config,runId:e.runId+'-bound',maxRecoveryTransactions:bound});await bounded.open();await assert.rejects(()=>bounded.cycle(),new RegExp(`History recovery exceeds ${bound}-transaction`));assert.equal((await bounded.store.snapshot()).checkpoint,null);await bounded.close();
  let rebuildDatabase=e.database;
  if(extended){const name='p12_rebuild';await e.runtime.store.pool.query('CREATE DATABASE '+name);const url=new URL(e.database);url.pathname='/'+name;rebuildDatabase=url.toString();}
  const rebuildStart=performance.now();const rebuilt=index({...e.config,databaseUrl:rebuildDatabase,runId:e.runId+'-rebuild'});await rebuilt.open();await rebuilt.cycle();assert.deepEqual((await rebuilt.store.snapshot()).state,state);const rebuiltFinal=await rebuilt.reconcile();const rebuildMetrics={...rebuilt.metrics,elapsedSeconds:(performance.now()-rebuildStart)/1000};await rebuilt.close();if(long||qualification)assert(rebuildMetrics.fetched>10000,'Long-history recovery must actually exceed the default bound');
  writeFileSync(`${dir}/final-storage.json`,json(await diskResources(e)));
  const intents:any[]=await publicIntents(e.runtime.store.pool,e.runId),budgets=(await e.runtime.store.pool.query('SELECT name,wallet,cap,committed,spent FROM service_budgets WHERE run_id=$1 ORDER BY name',[e.runId])).rows;
  for(const budget of budgets){const fees=intents.filter(x=>x.budget===budget.name&&['finalized','failed'].includes(String(x.status))).reduce((n,x)=>n+BigInt((x.result as any).fee),0n);assert.equal(fees,BigInt(budget.spent));assert.equal(BigInt(budget.committed),0n);assert(fees<=BigInt(budget.cap));}
  const closingBalances=Object.fromEntries(await Promise.all(Object.entries(e.openingBalances).map(async([role,initial])=>{
    const balance=BigInt((await e.rpc.call('getBalance',[initial.address,{commitment:'finalized'}])).value),name=role==='settlement'?'keeper':role==='maker-a'?'maker-0':role==='maker-b'?'maker-1':role;
    const budget=budgets.find(b=>b.name===name);assert(budget,`Missing ${name} budget`);assert.equal(BigInt(initial.lamports)-balance,BigInt(budget.spent),`${role} actual funded network fees`);
    return [role,{...initial,closingLamports:balance.toString(),actualFees:budget.spent}];
  })));
  const sourceClosing=BigInt((await e.rpc.call('getBalance',[e.sourceBudget.address,{commitment:'finalized'}])).value);assert.equal(e.sourceBudget.committed,0n);assert.equal(e.sourceBudget.openingLamports-sourceClosing,e.sourceBudget.spent,'Actual source fixture payer fees');
  const finalSnapshot=await capture('final');
  const observations=(await e.runtime.store.pool.query("SELECT payload FROM events WHERE run_id=$1 AND kind='oracle' AND sequence>$2 ORDER BY sequence",[e.runId,openingSnapshot.chain.market.sequence.toString()])).rows.map(x=>x.payload);
  appendFileSync(`${dir}/funding-observations.jsonl.gz`,gzipSync(observations.map(x=>json(x)).join('\n')+'\n'));
  let capCoveredSeconds=0n,previous:any={referencePrice:openingSnapshot.chain.risk.referencePrice,oracle:openingSnapshot.chain.risk.oracle};
  for(const sample of observations){const v=BigInt(previous.oracle.premiumScaled),atCap=(v<0n?-v:v)*10000n===BigInt(previous.referencePrice)*1_000_000_000n*50n;if(atCap)capCoveredSeconds+=BigInt(sample.oracle.coveredSeconds)-BigInt(previous.oracle.coveredSeconds);previous=sample;}
  const fundingQuality={capCoveredSeconds,coveredSeconds:finalSnapshot.chain.risk.oracle.coveredSeconds-openingSnapshot.chain.risk.oracle.coveredSeconds,skippedSeconds:finalSnapshot.chain.risk.oracle.skippedSeconds-openingSnapshot.chain.risk.oracle.skippedSeconds,
    sampleCount:observations.length,capSamples:observations.filter(x=>{const v=BigInt(x.oracle.premiumScaled);return (v<0n?-v:v)*10000n===BigInt(x.referencePrice)*1_000_000_000n*50n;}).length,
    retainedFractions:Object.fromEntries(Object.entries(finalSnapshot.chain.participants).map(([key,p])=>[key,p.virtualScaled%1_000_000_000n])),
    samplingSensitivity:'Not varied in this run; selected cadence five seconds. P07/P11 hold/accrual reference evidence is unchanged.'};
  await indexer.close();
  const reference=JSON.parse(execFileSync('python3',['tests/load/reference.py',`${dir}/quotes.jsonl.gz`],{encoding:'utf8'}));writeFileSync(`${dir}/reference.json`,json(reference));
  const baseline=phases[0],targets={quote:baseline.quote.p95!==null&&baseline.quote.p95<=200,normalSuccess:baseline.normalEligible>0&&baseline.normalSuccess>=.99,routeHeadroom:Math.max(...phases.map(x=>x.maxUnits))<=320_000,...(qualification?{normalOfferedAvailability:baseline.normalAvailability>=.5}: {})};
  const result={...manifest,finishedUtc:new Date().toISOString(),result:Object.values(targets).every(Boolean)?'pass':'fail',scope:long?'actual 24-hour sustained run':qualification?'D35 bounded 1800-second qualification plus >10000 actual RPC history replay; 24-hour endurance deferred':extended?`${seconds}-second ${mode==='--final-check-seconds'?'final-check probe':'sustained harness exercise'}; A17 not-run`:'finite qualification; A17 not-run',reference,readApi,fundingQuality,sustained:sustainedResult,visibility,history:historyResult,rebuildMetrics,rebuildKind:extended?'fresh PostgreSQL database':'fresh projection in same database',sourceBudget:{...e.sourceBudget,closingLamports:sourceClosing},targets,phases,faults,final,rebuiltFinal,finalSnapshot,intents,budgets,closingBalances,sourceErrors:e.sourceErrors};
  writeFileSync(`${dir}/load.json`,json(result));assert.equal(e.sourceErrors.length,0,'source publisher errors retained');
  console.log(`Load targets ${result.result}: ${dir}/load.json`);if(result.result==='fail')process.exitCode=2;
}catch(error){writeFileSync(`${dir}/failure.json`,json({revision,sourceDirty,at:new Date().toISOString(),error:error instanceof Error?error.message:String(error),phases,faults}));throw error;}
finally{await control?.abort();const cleanup=await Promise.allSettled([ui?.close(),env?.close(),...auxiliaries.map(x=>x.close())]);if(cleanup.some(r=>r.status==='rejected'))throw new Error('Load environment cleanup failed; see retained run artifacts');}
