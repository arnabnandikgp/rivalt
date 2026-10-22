import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync, statfsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import * as sdk from '@rivalt/sdk';
import { Indexer } from '../../packages/indexer/src/index.js';
import { json, decode } from '../../packages/indexer/src/events.js';
import { environment, wait } from './environment.js';
import { summarize, type Attempt } from './metrics.js';
import { submissionFault } from './submission-fault.js';
import { publicIntents } from '../e2e/evidence.js';

const args=process.argv.slice(2),seconds=Number(args[args.indexOf('--sweep-seconds')+1]??60);
if(!args.includes('--sweep-seconds')||!Number.isInteger(seconds)||seconds<10||seconds>600)throw new Error('Declare --sweep-seconds 10..600');
const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8'}).trim();
const revision=git('rev-parse','HEAD'),sourceDirty=Boolean(git('status','--porcelain'));
if(sourceDirty&&!args.includes('--development'))throw new Error('Commit source before acceptance; --development is explicitly provisional');
const dir=process.env.RIVALT_RUN_DIR!,startedUtc=new Date().toISOString(),records:Attempt[]=[],faults:any[]=[],phases:any[]=[];
const manifest={revision,sourceDirty,startedUtc,command:process.argv.slice(2),host:{platform:process.platform,arch:process.arch,node:process.version},
  slotTimeMs:50,fundingIntervalSeconds:5,budgetProfile:'soak24',maxRecoveryTransactions:200000,
  accountMix:'3 funded trader owners, 2 shared maker participants, 1 funded risk receiver; round-robin attempts, at most one unresolved attempt per trader; open sizes 1 lot or 100 every tenth offered attempt, close the same actual exposure',
  transport:'HTTP quote and immutable submission journal; separate executor/other worker processes; actual finalized RPC + PostgreSQL/WS indexer',
  latencyDefinition:'Monotonic elapsed milliseconds; processed/confirmed times are first polling observations (upper bounds), wallet fixture signing separate; every offered attempt retained',
  binaries:Object.fromEntries(['clearing','maker_a','maker_b','oracle_fixture'].map(n=>[n,createHash('sha256').update(readFileSync(`target/deploy/${n}.so`)).digest('hex')])),
  identities:Object.fromEntries(['Cargo.lock','pnpm-lock.yaml','tests/anchor-conformance/pnpm-lock.yaml','scenarios/local-profile-v1.json'].map(n=>[n,createHash('sha256').update(readFileSync(n)).digest('hex')]))};
writeFileSync(`${dir}/manifest.json`,json(manifest));
console.log(`P12 provisional=${sourceDirty} environment ${dir}`);
let env:Awaited<ReturnType<typeof environment>>|undefined;
try{
  env=await environment();const e=env;
  const busy=new Set<number>(),positions=[0n,0n,0n],pending=new Set<Promise<void>>();let offered=0;
  async function request(path:string,body:any){const response=await fetch('http://127.0.0.1:18081'+path,{method:'POST',headers:{'content-type':'application/json'},body:json(body),signal:AbortSignal.timeout(5000)});const result=await response.json() as any;if(!response.ok)throw Object.assign(new Error(result.error??String(response.status)),{code:result.code});return result;}
  async function attempt(phase:string,fault:boolean,scheduled:number){
    const number=offered++,actor=number%3,row:Attempt={id:`load:${number}`,phase,offeredAt:scheduled,actor,fault,status:'offered'};
    records.push(row);
    if(busy.has(actor)){row.status='unfilled-account-busy';appendFileSync(`${dir}/attempts.jsonl`,json(row)+'\n');return;}
    busy.add(actor);const user=e.actors[actor];
    try{
      const lots=positions[actor]===0n?(number%10===0?100n:1n):positions[actor]<0n?-positions[actor]:positions[actor],side=positions[actor]>0n?1:0;
      const beforeQuote=performance.now();let q:any;
      try{q=await request('/v1/quote',{owner:user.owner.address,side,lots:lots.toString()});}finally{row.quoteMs=performance.now()-beforeQuote;}
      if(!q.available){row.status='unfilled-no-liquidity';return;}
      row.eligible=true;
      const instructions=q.instructions.map((i:any)=>({...i,data:Buffer.from(i.data,'base64')}));
      const signStarted=performance.now(),{transaction}=await sdk.signInstructions(e.connection,user.owner,instructions);
      row.signingMs=performance.now()-signStarted;
      const bytes=transaction.serialize(),wire=Buffer.from(bytes).toString('base64');row.bytes=bytes.length;row.accounts=transaction.message.staticAccountKeys.length;
      const signedAt=performance.now();
      // Persist the immutable signature identity before ingress. No signed attempt is rebuilt.
      const signature=await import('@solana/kit').then(({getBase58Decoder})=>getBase58Decoder().decode(transaction.signatures[0]));row.signature=signature;
      appendFileSync(`${dir}/signed.jsonl`,json({requestId:row.id,signature,wireSha256:createHash('sha256').update(bytes).digest('hex'),offeredAt:row.offeredAt})+'\n');
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
          appendFileSync(`${dir}/fills.jsonl`,json({id:row.id,signature,requested:{side,lots},quote:q.allocation,events:fills})+'\n');
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
  await wait(async()=>{const s=await e.runtime.snapshot();return s.sourceMode==='Normal'&&s.makers.every(x=>x.online);},Boolean,'post-fault normal recovery');
  await capture('start');
  for(const rate of [1,5,10]){
    const name=`sweep-${rate}`,start=performance.now(),first=records.length;
    console.log(`Offered-load ${rate}/s for ${seconds} real seconds`);
    for(let n=0;n<rate*seconds;n++){
      const due=start+n*1000/rate;await delay(Math.max(0,due-performance.now()));
      // Bound driver memory; a saturated driver is still an offered/unfilled attempt.
      if(pending.size>=32){const row:Attempt={id:`load:${offered++}`,phase:name,offeredAt:Date.now(),actor:offered%3,fault:false,status:'unfilled-driver-limit'};records.push(row);appendFileSync(`${dir}/attempts.jsonl`,json(row)+'\n');continue;}
      const task=attempt(name,false,Date.now());pending.add(task);void task.finally(()=>pending.delete(task));
    }
    await delay(Math.max(0,start+seconds*1000-performance.now()));
    await Promise.all(pending);
    const end=performance.now();phases.push({name,rate,durationSeconds:seconds,elapsedSeconds:(end-start)/1000,...summarize(records.slice(first))});
    await capture(name);writeFileSync(`${dir}/progress.json`,json({manifest,phases,faults}));
    console.log(json(phases.at(-1)));
  }
  // Stop new discovery/source changes before final history/fee reconciliation.
  await e.stopSources();for(const role of ['maker-a','maker-b','funding','settlement','orders','risk'])await e.stop(role);
  await wait(async()=>{await e.runtime.execute();return Number((await e.runtime.store.pool.query("SELECT count(*) FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved')",[e.runId])).rows[0].count);},n=>n===0,'terminal known submissions',60_000);
  await e.stop('executor');await e.stop('indexer');
  const indexer=new Indexer(e.config);await indexer.open();await indexer.cycle();const final=await indexer.reconcile(),state=(await indexer.store.snapshot()).state;
  const bounded=new Indexer({...e.config,runId:e.runId+'-bound',maxRecoveryTransactions:2});await bounded.open();await assert.rejects(()=>bounded.cycle(),/History recovery exceeds 2-transaction/);assert.equal((await bounded.store.snapshot()).checkpoint,null);await bounded.close();
  const rebuilt=new Indexer({...e.config,runId:e.runId+'-rebuild'});await rebuilt.open();await rebuilt.cycle();assert.deepEqual((await rebuilt.store.snapshot()).state,state);const rebuiltFinal=await rebuilt.reconcile();await rebuilt.close();
  const intents:any[]=await publicIntents(e.runtime.store.pool,e.runId),budgets=(await e.runtime.store.pool.query('SELECT name,wallet,cap,committed,spent FROM service_budgets WHERE run_id=$1 ORDER BY name',[e.runId])).rows;
  for(const budget of budgets){const fees=intents.filter(x=>x.budget===budget.name&&['finalized','failed'].includes(String(x.status))).reduce((n,x)=>n+BigInt((x.result as any).fee),0n);assert.equal(fees,BigInt(budget.spent));assert.equal(BigInt(budget.committed),0n);assert(fees<=BigInt(budget.cap));}
  const closingBalances=Object.fromEntries(await Promise.all(Object.entries(e.openingBalances).map(async([role,initial])=>{
    const balance=BigInt((await e.rpc.call('getBalance',[initial.address,{commitment:'finalized'}])).value),name=role==='settlement'?'keeper':role==='maker-a'?'maker-0':role==='maker-b'?'maker-1':role;
    const budget=budgets.find(b=>b.name===name);assert(budget,`Missing ${name} budget`);assert.equal(BigInt(initial.lamports)-balance,BigInt(budget.spent),`${role} actual funded network fees`);
    return [role,{...initial,closingLamports:balance.toString(),actualFees:budget.spent}];
  })));
  const finalSnapshot=await capture('final');
  await indexer.close();
  const baseline=phases[0],targets={quote:baseline.quote.p95!==null&&baseline.quote.p95<=200,normalSuccess:baseline.normalEligible>0&&baseline.normalSuccess>=.99,routeHeadroom:Math.max(...phases.map(x=>x.maxUnits))<=320_000};
  const result={...manifest,finishedUtc:new Date().toISOString(),result:Object.values(targets).every(Boolean)?'pass':'fail',scope:'finite offered-load development/qualification; A17 remains not-run until actual 24h',targets,phases,faults,final,rebuiltFinal,finalSnapshot,intents,budgets,closingBalances,sourceErrors:e.sourceErrors};
  writeFileSync(`${dir}/load.json`,json(result));assert.equal(e.sourceErrors.length,0,'source publisher errors retained');
  console.log(`Load targets ${result.result}: ${dir}/load.json`);if(result.result==='fail')process.exitCode=2;
}catch(error){writeFileSync(`${dir}/failure.json`,json({revision,sourceDirty,at:new Date().toISOString(),error:error instanceof Error?error.message:String(error),phases}));throw error;}
finally{await env?.close();}
