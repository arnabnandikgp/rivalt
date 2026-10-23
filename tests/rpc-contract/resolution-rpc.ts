import { publicIntents } from '../e2e/evidence.js';
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
import {resolutionTools,resolutionCases} from './resolution-cases.js';
import {oracleSetup,type OracleHarness} from './oracle-cases.js';
import {publishFeed,feedAddress,type SourceChange} from './oracle-fixture.js';
import {WireRpc} from './wire.js';
const dir=process.env.RIVALT_RUN_DIR!,url=process.env.RIVALT_RPC_URL!,database=process.env.RIVALT_DATABASE_URL!,runId=dir.split('/').at(-1)!;
const rpc=new WireRpc(url),connection=new Connection(url,'confirmed'),payer=await payerKey(),a=await addresses();
const custody=JSON.parse(readFileSync(`${dir}/custody.json`,'utf8')),checks:string[]=[],transactions:any[]=[],children:ChildProcess[]=[],roles=new Map<ChildProcess,string>();
const record=(name:string)=>{checks.push(name);console.log(`Resolution RPC: ${name}`);};
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
const setup=await oracleSetup(h),{trader,owner,makers}=setup;
const anchor=custody.checks.find((x:any)=>x.label==='initialize custody market').signature;
const config={rpcUrl:url,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:database,runId,market:a.market,anchor};
let indexer=new Indexer(config);
const runtime=new Runtime(database,runId,url);
let running=true,sourceRunning=false,indexLoop:Promise<void>|undefined,sourceLoop:Promise<void>|undefined;
let number=0,sourcePrice=60_000n,publishedAt=0n;
const t=await resolutionTools(h,setup);
const keyPath=(name:string,key:Keypair)=>{const path=`${dir}/${name}.json`;writeFileSync(path,JSON.stringify([...key.secretKey]),{mode:0o600});return path;};
function start(role:string,path?:string){
  const fd=openSync(`${dir}/service-${role}-${++number}.log`,'w');
  const p=spawn(process.execPath,['--import','tsx','packages/services/src/main.ts'],{env:{...process.env,RIVALT_RUN_ID:runId,RIVALT_SERVICE_ROLE:role,...(path?{RIVALT_SIGNER_PATH:path}:{})},stdio:['ignore',fd,fd]});
  closeSync(fd);children.push(p);roles.set(p,role);return p;
}
async function stop(p:ChildProcess,signal:'SIGTERM'|'SIGKILL'='SIGTERM'){
  if(p.exitCode!==null||p.signalCode!==null)return;
  const done=new Promise<void>(resolve=>p.once('exit',()=>resolve()));p.kill(signal);
  await Promise.race([done,delay(10000).then(()=>{if(p.exitCode===null&&p.signalCode===null){p.kill('SIGKILL');throw new Error('Worker stop timeout');}})]);
}
function indexing(){running=true;indexLoop=(async()=>{while(running){try{await indexer.cycle();}catch{}await delay(100);}})();}
async function publish(){
  const time=await wait(now,t=>t>publishedAt,'next actual source timestamp');
  await send('actual signed source worker publication',await Promise.all([0,1,2,3].map(i=>publishFeed(i,time,{price:i%2===0?sourcePrice*1_000_000n:1_000_000n}))),[setup.primary,setup.guardKey]);publishedAt=time;
}
function sources(){sourceRunning=true;sourceLoop=(async()=>{while(sourceRunning){await publish();await delay(1200);}})();void sourceLoop.catch(()=>{});}
async function stopSources(){sourceRunning=false;await sourceLoop;sourceLoop=undefined;}
async function drain(){await wait(()=>runtime.store.pool.query("SELECT count(*)::int AS n FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved')",[runId]),r=>r.rows[0].n===0,'all signed jobs reconciled');}
async function rebuild(suffix:string){
  const other=new Indexer({...config,runId:runId+suffix});
  try{await other.open();await other.cycle();assert.deepEqual((await other.store.snapshot()).state,(await indexer.store.snapshot()).state);}finally{await other.close();}
}
const independent=(input:unknown)=>JSON.parse(execFileSync('python3',['tests/financial/resolution-reference.py'],{input:json(input),encoding:'utf8'}));
async function verifyExpected(expected:any){
  const s=await t.state(),m=await t.market(),members=(await t.registry()).members;
  assert.equal(m.settlement,0n);assert.equal(m.insurance.toString(),expected.insurance);
  for(const e of expected.rows){const p=await t.participant(members[e.id]),row=s.rows[e.id];assert.equal(p.cash.toString(),e.cash);assert.equal(p.lots,0n);assert.equal(p.virtualScaled,0n);for(const k of ['collected','claim','insuredScaled','impairedScaled','paid','roundingScaled']as const)assert.equal(row[k].toString(),e[k]);}
}
try{
  await indexer.open();await indexer.cycle();await runtime.open();indexing();
  const matrix=await resolutionCases(h,setup);
  record('signed RPC liquidation, rejection matrix, deterministic full-cohort resolution and authorized recovery match independent Python');
  await t.recover();
  const receiver=await t.provision('p09-service-risk',30_000n),riskPath=keyPath('risk-key',receiver.owner);
  const fundingKey=await fixtureKey('p09-funding-worker');await send('fund distinct funding worker network budget',[getTransferSolInstruction({source:payer,destination:fundingKey.address,amount:50_000_000n})]);
  const fundingPath=keyPath('funding-key',fundingKey);
  await send('replenish target using real custody for service default',[await sdk.getDepositInstructionAsync({...setup,owner,participant:trader,quoteMint:setup.mint.address,userToken:setup.token.address,amount:200_000n})],[owner]);
  const insuranceToken=await fixtureKey('insurance-token');
  await send('replenish insurance through actual SPL custody for two-debtor allocation',[await sdk.getFundInsuranceInstructionAsync({...setup,authority:payer,quoteMint:setup.mint.address,source:insuranceToken.address,amount:10007n})]);
  await t.recover();await t.splitOpen();const oldOrder=await t.place('old order must never survive liquidation/default epochs',{lots:1n,feeBudget:100n});
  let executor=start('executor'),funding=start('funding',fundingPath);start('api');sources();
  await wait(()=>runtime.snapshot(),s=>s.sourceMode==='Normal'&&s.risk.referencePrice===60000n,'normal worker funding');
  sourcePrice=42_000n;
  await wait(()=>runtime.snapshot(),s=>s.risk.referencePrice===42000n&&s.sourceMode!=='NoCredibleBounds','distress observation');
  const initialTarget=await t.participant(),initialReceiver=await t.participant(receiver.participant);
  let risk1=start('risk',riskPath);
  await wait(()=>t.participant(),p=>p.lots===5n,'funded five-lot service liquidation');await stop(risk1);
  const liquidated=await t.participant(),received=await t.participant(receiver.participant);
  assert.equal(liquidated.cash,initialTarget.cash-105n);assert.equal(received.cash,initialReceiver.cash+105n);assert.equal(received.lots,5n);assert.equal((await t.order(oldOrder)).state,6);
  record('risk worker halves a ten-lot transfer to five when its real funded receiver cannot support ten; exact funded fee and order invalidation');
  sourcePrice=10_000n;await wait(()=>runtime.snapshot(),s=>s.risk.referencePrice===10000n&&s.sourceMode!=='NoCredibleBounds','bankruptcy observation');
  await stop(funding);await drain();await stop(executor);
  const beforeFreeze=await t.market(),members=(await t.registry()).members,cohort=await Promise.all(members.map(t.participant));
  const discover=start('risk',riskPath);
  const persisted=await wait(()=>runtime.store.pool.query("SELECT request_id,wire,signature FROM service_intents WHERE run_id=$1 AND budget='risk' AND request_id LIKE 'risk:freeze:%' AND status='pending'",[runId]),r=>r.rows.length===1,'persisted freeze before broadcast');
  await stop(discover,'SIGKILL');
  assert.equal((await t.market()).mode,2);assert.equal((await t.participant()).lots,5n);
  risk1=start('risk',riskPath);let risk2=start('risk',riskPath);executor=start('executor');
  await wait(()=>t.state(),s=>s.header.stage>=3&&s.header.stage<10&&s.header.collectedTotal>0n,'durable collected cohort stage');
  await stop(executor,'SIGKILL');await stop(risk1,'SIGKILL');await stop(risk2,'SIGKILL');
  const interrupted=await t.state();assert(interrupted.header.stage>=3&&interrupted.header.stage<12&&interrupted.header.collectedTotal>0n&&interrupted.header.paidApplied===0n);
  const expectedInput={participants:cohort,price:interrupted.header.price,funding:interrupted.header.funding,insurance:beforeFreeze.insurance,settlement:beforeFreeze.settlement},expected=independent(expectedInput);
  await t.reconcile();await runtime.snapshot();
  running=false;await indexLoop;await indexer.cycle();
  await rebuild('-frozen-rebuild');
  const frozenProjection=(await indexer.store.snapshot()).state;
  const unchanged=(await runtime.store.pool.query('SELECT wire,signature FROM service_intents WHERE run_id=$1 AND request_id=$2',[runId,persisted.rows[0].request_id])).rows[0];
  assert.deepEqual(unchanged,{wire:persisted.rows[0].wire,signature:persisted.rows[0].signature});
  const metricsBeforeRestart={...indexer.metrics};
  await indexer.close();indexer=new Indexer(config);await indexer.open();indexing();
  record('persisted signed freeze survives discovery kill; two keepers stop between pages and a fresh PostgreSQL projection reconstructs the frozen ledger');
  risk1=start('risk',riskPath);risk2=start('risk',riskPath);executor=start('executor');
  await wait(()=>t.state(),s=>s.header.stage===12&&s.header.recoveryLast-s.header.recoverySince>=6n&&s.header.recoverySince>0n,'complete recovered default',90000);
  await verifyExpected(expected);assert.equal((await t.market()).mode,3);
  const resolutionResponse=await fetch('http://127.0.0.1:18081/v1/resolution');assert.equal(resolutionResponse.status,200);const view=await resolutionResponse.json();assert.equal(view.frozen,true);assert.equal(view.resolution.header.stage,12);
  await stop(risk1);await stop(risk2);await drain();
  const frozenMarket=await t.market();await send('separate authority resumes after complete recovered cohort',[sdk.resolutionComputeBudget(),await t.recoverIx(true)]);
  assert.equal((await t.market()).termsEpoch,frozenMarket.termsEpoch+1n);assert.equal((await t.risk()).oracle.status,0);
  record('restarted risk workers finish exactly the independent payout, expose frozen progress over HTTP, and cannot resume without separate authority');
  // A true source outage must wait on real chain time, never an invented mark.
  await stopSources();await stop(executor);sourcePrice=60_000n;
  await t.recover();const deadline=(await t.risk()).oracle.sourceDeadline;
  await t.sample(60_000n,{0:{level:1}});assert.equal((await t.risk()).oracle.sourceDeadline,deadline);
  const outageStart=await now();await h.waitTime(deadline+30n);
  await send('authority proves actual source-emergency grace interval',[sdk.resolutionComputeBudget(),await t.freeze(true)]);
  assert.equal((await t.state()).header.stage,1);assert.equal((await t.state()).header.price,0n);
  risk1=start('risk',riskPath);executor=start('executor');
  await delay(2500);assert.equal((await t.state()).header.stage,1);assert.equal((await t.state()).header.price,0n);
  const emergencyCohort=await Promise.all((await t.registry()).members.map(t.participant)),emergencyMarket=await t.market();
  sources();
  await wait(()=>t.state(),s=>s.header.stage===12&&s.header.recoverySince>0n&&s.header.recoveryLast-s.header.recoverySince>=6n,'source recovery and complete cohort',90000);
  const eh=(await t.state()).header,emergencyExpected=independent({participants:emergencyCohort,price:eh.price,funding:eh.funding,insurance:emergencyMarket.insurance,settlement:emergencyMarket.settlement});
  await verifyExpected(emergencyExpected);await stop(risk1);await drain();
  await send('explicit recovery after real source-emergency resolution',[sdk.resolutionComputeBudget(),await t.recoverIx(true)]);
  const outageElapsed=(await now())-outageStart;
  record('actual source outage retains zero pinned price until authenticated recovery; risk worker then resolves all members without manufactured valuation');
  await stopSources();for(const p of children)await stop(p);await drain();running=false;await indexLoop;await indexer.cycle();
  const snapshot=await runtime.snapshot(),row=await indexer.store.snapshot();assert.equal(row.state.sequence,snapshot.m.sequence.toString());
  assert(Object.values(snapshot.participants).every(p=>p.lots===0n&&p.virtualScaled===0n&&p.reserved===0n));assert.equal(snapshot.m.settlement,0n);
  await rebuild('-final-rebuild');assert(indexer.metrics.notifications>0);
  const budgets=(await runtime.store.pool.query('SELECT name,wallet,spent::text,committed::text,cap::text FROM service_budgets WHERE run_id=$1 ORDER BY name',[runId])).rows;
  assert(budgets.every(b=>b.committed==='0'&&BigInt(b.spent)<=BigInt(b.cap)));
  const jobs=(await runtime.store.pool.query('SELECT request_id,signature,budget,status FROM service_intents WHERE run_id=$1',[runId])).rows,fees=new Map<string,bigint>(),work:any[]=[];
  for(const job of jobs){
    const tx=await fetched(job.signature);assert(['finalized','failed'].includes(job.status));
    const b=budgets.find(b=>b.name===job.budget)!;assert.equal(tx.transaction.message.accountKeys[0],b.wallet);fees.set(job.budget,(fees.get(job.budget)??0n)+BigInt(tx.meta.fee));
    if(job.budget==='risk'&&!tx.meta.err){
      assert(tx.meta.computeUnitsConsumed<=960000);assert(tx.transaction.message.accountKeys.length<=20);
      const wire=await rpc.call('getTransaction',[job.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
      const bytes=Buffer.from(wire.transaction[0],'base64').length;assert(bytes<=1232);
      const events=decode(job.signature,tx,a.eventAuthority);assert(events.some(e=>e.type==='liquidation'||e.type==='resolution'));
      work.push({requestId:job.request_id,signature:job.signature,computeUnits:tx.meta.computeUnitsConsumed,transactionBytes:bytes,accounts:tx.transaction.message.accountKeys.length,events:events.map(e=>({type:e.type,sequence:e.data.sequence,kind:e.data.kind,header:e.data.header}))});
    }
  }
  for(const b of budgets)assert.equal(BigInt(b.spent),fees.get(b.name)??0n);
  record('final actual RPC/WS account and vault reconciliation, fresh PostgreSQL rebuild, and separately funded risk/funding operator fees agree exactly');
  const events=(await runtime.store.pool.query("SELECT payload,signature,bytes FROM events WHERE run_id=$1 AND kind IN ('liquidation','resolution') ORDER BY sequence",[runId])).rows;
  const conformance={accounts:[{program:'clearing',name:'resolutionState',data:(await read(t.resolution))!.toString('base64')}],events:events.map(e=>e.bytes)};
  writeFileSync(`${dir}/resolution-conformance.json`,json(conformance));
  const legacy=JSON.parse(execFileSync(process.execPath,['tests/anchor-conformance/makers.cjs',`${dir}/resolution-conformance.json`],{encoding:'utf8'}));
  const canonical=(v:any):any=>typeof v==='bigint'?v.toString():v instanceof Uint8Array?[...v]:Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='discriminator').map(([k,x])=>[k,canonical(x)])):v;
  assert.deepEqual(legacy.accounts[0],canonical(await t.state()));
  for(const [i,e]of legacy.events.entries()){const expected={...events[i].payload};delete expected.discriminator;e.data.domain=Buffer.from(e.data.domain).toString('hex');if(e.data.header)e.data.header.registryHash=Buffer.from(e.data.header.registryHash).toString('hex');assert.deepEqual(e.data,expected);}
  record('isolated legacy Anchor independently decodes actual complete resolution ledger and every liquidation/resolution event');
  writeFileSync(`${dir}/resolution.json`,json({revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()!=='',runId,cohort:snapshot.members,intents:await publicIntents(runtime.store.pool,runId),checks,matrix,expectedInput,expected,interrupted:interrupted.header,frozenProjection,emergencyExpected,outageElapsed,metricsBeforeRestart,metrics:indexer.metrics,budgets,work,events:events.length,final:row.state,vault:snapshot.actual,transactions:transactions.map(x=>({signature:x.signature,slot:x.tx.slot,err:x.tx.meta.err,fee:x.tx.meta.fee,computeUnits:x.tx.meta.computeUnitsConsumed})),binaries:Object.fromEntries(['clearing','maker_a','maker_b','oracle_fixture'].map(n=>[n,createHash('sha256').update(readFileSync(`target/deploy/${n}.so`)).digest('hex')]))})+'\n');
}finally{
  running=false;sourceRunning=false;await Promise.allSettled([indexLoop,sourceLoop]);for(const p of children)await stop(p);await runtime.close();await indexer.close();
}
