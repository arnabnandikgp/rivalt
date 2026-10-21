import assert from 'node:assert/strict';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {address,type Instruction} from '@solana/kit';
import {Connection,type Keypair} from '@solana/web3.js';
import {getTransferSolInstruction} from '@solana-program/system';
import * as sdk from '@rivalt/sdk';
import {Indexer} from '../../packages/indexer/src/index.js';
import {Runtime} from '../../packages/services/src/runtime.js';
import {json,decode} from '../../packages/indexer/src/events.js';
import {addresses,payerKey,fixtureKey} from './custody-cases.js';
import {oracleSetup,type OracleHarness} from './oracle-cases.js';
import {publishFeed,feedAddress,type SourceChange} from './oracle-fixture.js';
import {WireRpc} from './wire.js';
const dir=process.env.RIVALT_RUN_DIR!,url=process.env.RIVALT_RPC_URL!,database=process.env.RIVALT_DATABASE_URL!,runId=dir.split('/').at(-1)!;
const rpc=new WireRpc(url),connection=new Connection(url,'confirmed'),payer=await payerKey(),a=await addresses();
const custody=JSON.parse(readFileSync(`${dir}/custody.json`,'utf8')),checks:string[]=[],transactions:any[]=[],children:ChildProcess[]=[];
const record=(name:string)=>{checks.push(name);console.log(`Oracle RPC: ${name}`);};
async function wait<T>(read:()=>Promise<T>,accept:(v:T)=>boolean,label:string,timeout=30000){const end=Date.now()+timeout;let last:any;while(Date.now()<end){try{last=await read();if(accept(last))return last;}catch(e){last=e;}await delay(150);}throw new Error(`${label}: ${last instanceof Error?last.message:json(last)}`);}
const read=async(key:string)=>{const x=await rpc.call('getAccountInfo',[key,{encoding:'base64',commitment:'finalized'}]);return x.value?Buffer.from(x.value.data[0],'base64'):null;};
const now=async()=>{const c=await read('SysvarC1ock11111111111111111111111111111111');return c!.readBigInt64LE(32);};
const slot=async()=>BigInt(await rpc.call('getSlot',[{commitment:'finalized'}]));
async function fetched(signature:string){
  await wait(()=>rpc.call('getSignatureStatuses',[[signature],{searchTransactionHistory:true}]),r=>r.value[0]?.confirmationStatus==='finalized','finalized');
  const tx=await wait(()=>rpc.call('getTransaction',[signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]),Boolean,'getTransaction');transactions.push({signature,tx});return tx;
}
async function send(label:string,instructions:Instruction[],signers:Keypair[]=[],error?:number|'reject'){
  const {transaction}=await sdk.signInstructions(connection,payer,instructions,signers),wire=Buffer.from(transaction.serialize()).toString('base64');
  const signature=await rpc.call('sendTransaction',[wire,{encoding:'base64',skipPreflight:true}]),tx=await fetched(signature);
  if(error===undefined)assert.equal(tx.meta.err,null,`${label}: ${tx.meta.logMessages}`);else{assert(tx.meta.err,label);if(error!=='reject')assert(tx.meta.logMessages.some((s:string)=>s.includes(`Error Number: ${error}.`)),`${label}: ${tx.meta.logMessages}`);}
  return {signature,tx};
}
const h:OracleHarness={send:async(...args)=>{await send(...args);},read,rent:async(n)=>BigInt(await rpc.call('getMinimumBalanceForRentExemption',[n])),slot,now,
  waitUntil:async(n)=>{await wait(slot,x=>x>=n,'actual slot',90000);},waitTime:async(n)=>{await wait(now,x=>x>=n,'actual clock',60000);},quote:async()=>{throw new Error('No unused quote fixture');}};
const setup=await oracleSetup(h),{owner,trader,routeState,makers}=setup;
const fundingKey=await fixtureKey('p07-funding-keeper');await send('fund explicit oracle worker SOL budget',[getTransferSolInstruction({source:payer,destination:fundingKey.address,amount:50_000_000n})]);
const keyPath=(name:string,key:Keypair)=>{const path=`${dir}/${name}.json`;writeFileSync(path,JSON.stringify([...key.secretKey]),{mode:0o600});return path;};
const paths={funding:keyPath('funding-key',fundingKey),a:keyPath('maker-a-key',makers[0].owner),b:keyPath('maker-b-key',makers[1].owner)};
const indexer=new Indexer({rpcUrl:url,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:database,runId,market:a.market,anchor:custody.checks.find((x:any)=>x.label==='initialize custody market').signature}),runtime=new Runtime(database,runId,url);
let running=true,sourceRunning=true,sourceEnabled=true,changes:Record<number,SourceChange>={},indexLoop:Promise<void>|undefined,sourceLoop:Promise<void>|undefined,number=0;
function start(role:string,path?:string){const fd=openSync(`${dir}/service-${role}-${++number}.log`,'w');const p=spawn(process.execPath,['--import','tsx','packages/services/src/main.ts'],{env:{...process.env,RIVALT_RUN_ID:runId,RIVALT_SERVICE_ROLE:role,...(path?{RIVALT_SIGNER_PATH:path}:{})},stdio:['ignore',fd,fd]});closeSync(fd);children.push(p);return p;}
async function stop(p:ChildProcess){if(p.exitCode!==null||p.signalCode!==null)return;const done=new Promise<void>(resolve=>p.once('exit',()=>resolve()));p.kill('SIGTERM');await Promise.race([done,delay(10000).then(()=>{if(p.exitCode===null&&p.signalCode===null){p.kill('SIGKILL');throw new Error('Worker stop timeout');}})]);}
async function publish(){const time=await now(),ixs=await Promise.all([0,1,2,3].map(i=>publishFeed(i,time,changes[i])));await send('signed controlled local dependency updates',ixs,[setup.primary,setup.guardKey]);}
const api='http://127.0.0.1:18081';
async function post(path:string,body:unknown){const r=await fetch(api+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const value=await r.json();assert(r.ok,json(value));return value;}
async function trade(id:string,side:number,lots='3'){
  const q=await post('/v1/quote',{owner:owner.address,side,lots});assert(q.available,json(q));
  const ixs=q.instructions.map((i:any)=>({programAddress:address(i.programAddress),accounts:i.accounts,data:Buffer.from(i.data,'base64')}));
  const before=sdk.getParticipantDecoder().decode((await read(trader))!);const r=await risk();
  const {transaction}=await sdk.signInstructions(connection,owner,ixs),job=await post('/v1/submit',{requestId:id,wire:Buffer.from(transaction.serialize()).toString('base64')});
  await wait(()=>runtime.queue.get(id),x=>x?.status==='finalized',id);const tx=await fetched(job.signature);assert.equal(tx.meta.err,null);
  const e=decode(job.signature,tx,a.eventAuthority).find(e=>e.type==='route')!.data;
  // Independent causal prefix and account transition, from authenticated sample
  // plus actual on-chain materialization time, rather than another SDK calculation.
  const start=r.oracle.sampledAt,end=r.oracle.heldUntil,t=BigInt(e.fundingTime),premium=r.oracle.premiumScaled;
  if(t>=start&&t<=end&&r.oracle.heldEpoch===BigInt(e.configEpoch))assert.equal(BigInt(e.fundingIndexScaled),r.oracle.fundingBase+premium*(t-start)/3600n);
  const f=BigInt(e.fundingIndexScaled),gross=BigInt(e.grossQuote),fee=(gross+4999n)/5000n,sign=side===0?1n:-1n;
  assert.equal(BigInt(e.traderVirtual),before.virtualScaled-before.lots*(f-before.fundingCheckpointScaled)-sign*gross*1_000_000_000n);
  assert.equal(BigInt(e.traderCash),before.cash-fee);return e;
}
const risk=async()=>sdk.getTestRouteStateDecoder().decode((await read(routeState))!),market=async()=>sdk.getMarketStateDecoder().decode((await read(a.market))!);
try{
  await indexer.open();await indexer.cycle();await runtime.open();indexLoop=(async()=>{while(running){try{await indexer.cycle();}catch{}await delay(100);}})();
  await publish();sourceLoop=(async()=>{while(sourceRunning){await delay(1500);if(sourceRunning&&sourceEnabled)await publish();}})();
  start('executor');start('maker-a',paths.a);start('maker-b',paths.b);start('api');let worker=start('funding',paths.funding);
  await wait(()=>runtime.snapshot(),s=>s.sourceMode==='Normal'&&s.makers.every(m=>m.online),'normal authenticated policy');
  record('distinct funding/executor/maker processes recover only after sustained valid sources');
  const initial=await risk();assert.equal(initial.oracle.quantity,100n);assert.equal(initial.oracle.bid,5_997_210n);assert.equal(initial.oracle.ask,6_002_790n);assert.equal(initial.oracle.premiumScaled,0n);
  record('independent two-maker bid/ask midpoint and unchanged consumption');
  await trade('p07-open',0);await wait(risk,r=>r.oracle.premiumScaled===285_000_000n,'consumption-qualified premium');
  await stop(worker);await wait(()=>runtime.store.pool.query("SELECT count(*)::int AS n FROM service_intents WHERE run_id=$1 AND budget='funding' AND status IN ('pending','unresolved')",[runId]),r=>r.rows[0].n===0,'funding queue drain');
  const held=await risk();await h.waitTime(held.oracle.sampledAt+3n);const close=await trade('p07-close',1);assert(BigInt(close.fundingIndexScaled)>held.oracle.fundingBase);
  const flat=sdk.getParticipantDecoder().decode((await read(trader))!);assert.equal(flat.lots,0n);assert.notEqual(flat.virtualScaled%1_000_000_000n,0n);
  const fraction=flat.virtualScaled%1_000_000_000n;await trade('p07-reopen',0);assert.equal(sdk.getParticipantDecoder().decode((await read(trader))!).virtualScaled%1_000_000_000n,fraction);await trade('p07-reclose',1);
  record('HTTP wallet routes accrue the prior sample causally and preserve flat/reopen fractions');
  worker=start('funding',paths.funding);
  changes={2:{level:1}};await publish();await wait(risk,r=>r.oracle.status===1&&r.oracle.heldUntil===0n,'missing guard policy');
  const refused=await fetch(api+'/v1/quote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({owner:owner.address,side:0,lots:'1'})});assert.equal(refused.status,400);
  record('authenticated invalid guard allows credible restrictive mode and blocks new risk');
  changes={1:{price:900_000n},3:{price:900_000n}};await publish();await wait(risk,r=>r.referencePrice===66_666n&&r.oracle.status===1,'collateral conversion');record('collateral depeg is converted instead of assuming dollar parity');
  changes={};await publish();await wait(()=>runtime.snapshot(),s=>s.sourceMode==='Normal','source recovery');
  await send('quarantine required maker',[await sdk.getQuarantineMakerInstructionAsync({...makers[0],authority:payer})]);await wait(risk,r=>r.oracle.status===1&&r.oracle.heldUntil===0n,'complete coverage failure');
  const f=(await market()).fundingIndexScaled,seq=(await risk()).observationSequence;await wait(risk,r=>r.observationSequence>=seq+2n,'two unavailable intervals');assert.equal((await market()).fundingIndexScaled,f);
  record('required-maker outage records invalid observations with zero new interval accrual');
  await send('jointly restore required maker',[await sdk.getApproveMakerInstructionAsync({...makers[0],authority:payer})],[makers[0].owner]);await wait(()=>runtime.snapshot(),s=>s.sourceMode==='Normal','maker recovery');
  await stop(worker);const gapStart=await risk(),fundingBefore=(await market()).fundingIndexScaled;
  await h.waitTime(gapStart.oracle.sampledAt+13n);assert.equal((await runtime.snapshot()).sourceMode,'Degraded');
  await h.waitTime(gapStart.oracle.sampledAt+31n);worker=start('funding',paths.funding);await wait(risk,r=>r.oracle.outcome===3,'long gap discarded');assert.equal((await market()).fundingIndexScaled,fundingBefore);
  record('worker outage derives restrictive mode from time and skips unverified catch-up');
  await wait(()=>runtime.snapshot(),s=>s.sourceMode==='Normal','post-gap sustained recovery');
  sourceEnabled=false;await delay(1800);await h.waitTime((await now())+22n);await wait(risk,r=>r.oracle.status===0,'stale source policy');
  await send('deposit remains independent of failing funding sources',[await sdk.getDepositInstructionAsync({...a,owner,participant:trader,quoteMint:setup.mint.address,userToken:setup.token.address,amount:1n})],[owner]);
  record('stale authenticated sources block valuation while ordinary deposit remains available');
  sourceEnabled=true;await publish();await wait(()=>runtime.snapshot(),s=>s.sourceMode==='Normal','final source recovery');
  await stop(worker);sourceRunning=false;await sourceLoop;await wait(()=>runtime.store.pool.query("SELECT count(*)::int AS n FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved')",[runId]),r=>r.rows[0].n===0,'durable jobs reconciled');
  running=false;await indexLoop;await indexer.cycle();const snapshot=await runtime.snapshot(),row=await indexer.store.snapshot();assert.equal(row.state.sequence,snapshot.m.sequence.toString());
  const rebuild=new Indexer({rpcUrl:url,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:database,runId:runId+'-rebuild',market:a.market,anchor:custody.checks.find((x:any)=>x.label==='initialize custody market').signature});
  try{await rebuild.open();await rebuild.cycle();assert.deepEqual((await rebuild.store.snapshot()).state,row.state);}finally{await rebuild.close();}
  assert(indexer.metrics.notifications>0);const budgets=(await runtime.store.pool.query('SELECT name,wallet,spent::text,committed::text,cap::text FROM service_budgets WHERE run_id=$1 ORDER BY name',[runId])).rows;assert(budgets.every(b=>b.committed==='0'&&BigInt(b.spent)<=BigInt(b.cap)));
  record('RPC/WS PostgreSQL checkpoint and fresh reconstruction reconcile exact accrued claims and explicit worker fees');
  const intents=(await runtime.store.pool.query('SELECT signature,budget,status FROM service_intents WHERE run_id=$1',[runId])).rows;
  const fees=new Map<string,bigint>(),samples:any[]=[];
  for(const job of intents){
    const tx=await fetched(job.signature);assert(['finalized','failed'].includes(job.status));
    if(job.budget){const budget=budgets.find(b=>b.name===job.budget)!;assert.equal(tx.transaction.message.accountKeys[0],budget.wallet);fees.set(job.budget,(fees.get(job.budget)??0n)+BigInt(tx.meta.fee));}
    if(job.budget==='funding'&&tx.meta.err===null){
      assert(tx.meta.computeUnitsConsumed<=960000);assert(tx.transaction.message.accountKeys.length<=20);
      const sampleEvents=decode(job.signature,tx,a.eventAuthority).filter(e=>e.type==='oracle');assert.equal(sampleEvents.length,1);
      samples.push({signature:job.signature,computeUnits:tx.meta.computeUnitsConsumed,accounts:tx.transaction.message.accountKeys.length,sequence:sampleEvents[0].data.sequence});
    }
  }
  for(const b of budgets)assert.equal(BigInt(b.spent),fees.get(b.name)??0n);
  record('independently fetched funding transactions meet CU/account limits and exactly reconcile payer fees');
  const events=(await runtime.store.pool.query("SELECT payload,signature,bytes FROM events WHERE run_id=$1 AND kind='oracle' ORDER BY sequence",[runId])).rows;
  const conformance={accounts:[{program:'clearing',name:'testRouteState',data:(await read(routeState))!.toString('base64')},{program:'clearing',name:'marketState',data:(await read(a.market))!.toString('base64')}],events:events.map(e=>e.bytes)};
  writeFileSync(`${dir}/oracle-conformance.json`,json(conformance));
  const legacy=JSON.parse(execFileSync(process.execPath,['tests/anchor-conformance/makers.cjs',`${dir}/oracle-conformance.json`],{encoding:'utf8'}));
  const canonical=(v:any):any=>{const walk=(x:any):any=>typeof x==='bigint'?x.toString():x instanceof Uint8Array?[...x]:Array.isArray(x)?x.map(walk):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).filter(([k])=>k!=='discriminator').map(([k,v])=>[k,walk(v)])):x;return walk(v);};
  assert.deepEqual(legacy.accounts[0],canonical(await risk()));assert.deepEqual(legacy.accounts[1],canonical(await market()));
  legacy.events.forEach((e:any,i:number)=>{const expected={...events[i].payload};delete expected.discriminator;e.data.domain=Buffer.from(e.data.domain).toString('hex');assert.deepEqual(e.data,expected);});
  record('isolated legacy Anchor decodes actual observation events and funding accounts byte-for-byte');
  const report={revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()!=='',runId,checks,metrics:indexer.metrics,budgets,samples,oracleEvents:events,final:row.state,vault:snapshot.actual,transactions:transactions.map(x=>({signature:x.signature,slot:x.tx.slot,err:x.tx.meta.err,fee:x.tx.meta.fee,computeUnits:x.tx.meta.computeUnitsConsumed})),binaries:Object.fromEntries(['clearing','maker_a','maker_b','oracle_fixture'].map(n=>[n,createHash('sha256').update(readFileSync(`target/deploy/${n}.so`)).digest('hex')]))};
  writeFileSync(`${dir}/oracle.json`,json(report)+'\n');
}finally{running=false;sourceRunning=false;await Promise.allSettled([indexLoop,sourceLoop]);for(const p of children)await stop(p);await runtime.close();await indexer.close();}
