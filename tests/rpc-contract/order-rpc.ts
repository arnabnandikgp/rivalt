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
import {orderTools} from './order-cases.js';
import {oracleSetup,type OracleHarness} from './oracle-cases.js';
import {publishFeed,feedAddress,type SourceChange} from './oracle-fixture.js';
import {WireRpc} from './wire.js';
const dir=process.env.RIVALT_RUN_DIR!,url=process.env.RIVALT_RPC_URL!,database=process.env.RIVALT_DATABASE_URL!,runId=dir.split('/').at(-1)!;
const rpc=new WireRpc(url),connection=new Connection(url,'confirmed'),payer=await payerKey(),a=await addresses();
const custody=JSON.parse(readFileSync(`${dir}/custody.json`,'utf8')),checks:string[]=[],transactions:any[]=[],children:ChildProcess[]=[],roles=new Map<ChildProcess,string>();
const record=(name:string)=>{checks.push(name);console.log(`Orders RPC: ${name}`);};
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
const fundingKey=await fixtureKey('p08-funding-keeper');await send('fund explicit oracle worker SOL budget',[getTransferSolInstruction({source:payer,destination:fundingKey.address,amount:50_000_000n})]);
const keyPath=(name:string,key:Keypair)=>{const path=`${dir}/${name}.json`;writeFileSync(path,JSON.stringify([...key.secretKey]),{mode:0o600});return path;};
const paths={funding:keyPath('funding-key',fundingKey),a:keyPath('maker-a-key',makers[0].owner),b:keyPath('maker-b-key',makers[1].owner)};
const indexer=new Indexer({rpcUrl:url,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:database,runId,market:a.market,anchor:custody.checks.find((x:any)=>x.label==='initialize custody market').signature}),runtime=new Runtime(database,runId,url);
let running=true,sourceRunning=true,sourceEnabled=true,changes:Record<number,SourceChange>={},indexLoop:Promise<void>|undefined,sourceLoop:Promise<void>|undefined,number=0;
function start(role:string,path?:string){const fd=openSync(`${dir}/service-${role}-${++number}.log`,'w');const p=spawn(process.execPath,['--import','tsx','packages/services/src/main.ts'],{env:{...process.env,RIVALT_RUN_ID:runId,RIVALT_SERVICE_ROLE:role,...(path?{RIVALT_SIGNER_PATH:path}:{})},stdio:['ignore',fd,fd]});closeSync(fd);children.push(p);roles.set(p,role);return p;}
async function stop(p:ChildProcess){if(p.exitCode!==null||p.signalCode!==null)return;const done=new Promise<void>(resolve=>p.once('exit',()=>resolve()));p.kill('SIGTERM');await Promise.race([done,delay(10000).then(()=>{if(p.exitCode===null&&p.signalCode===null){p.kill('SIGKILL');throw new Error('Worker stop timeout');}})]);}
let publication=Promise.resolve(),publishedAt=0n;
function publish(){
  // Periodic and explicit fault updates share one signed source publisher.
  // Distinct actual chain timestamps also prevent identical transaction bytes
  // when two publications obtain the same recent blockhash.
  const values=changes;
  const next=publication.then(async()=>{
    const time=await wait(now,t=>t>publishedAt,'next source publication second');
    const ixs=await Promise.all([0,1,2,3].map(i=>publishFeed(i,time,values[i])));
    await send('signed controlled local dependency updates',ixs,[setup.primary,setup.guardKey]);publishedAt=time;
  });
  publication=next;return next;
}
const api='http://127.0.0.1:18081';
async function post(path:string,body:unknown){const r=await fetch(api+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const value=await r.json();assert(r.ok,json(value));return value;}
try{
  await indexer.open();await indexer.cycle();await runtime.open();indexLoop=(async()=>{while(running){try{await indexer.cycle();}catch{}await delay(100);}})();
  const t=await orderTools(h,setup);
  const recover=t.recover;
  t.recover=async(price=60000n)=>{
    for(const [i,x]of makers.entries()){
      const r=sdk.getLegacyMakerRegistrationDecoder().decode((await read(x.registration))!);
      if(r.expirySlot-(await slot())<600n){await h.waitUntil(r.expirySlot);await send('renew actual maker epoch for long RPC race matrix',[(i===0?sdk.makerA:sdk.makerB).getPublishEpochInstruction({owner:x.owner,config:x.config,duration:3600n}),await sdk.getSyncMakerEpochInstructionAsync({...setup,...x})],[x.owner]);}
    }
    await recover(price);
  };
  await t.recover();
  // Sequential finalized race demonstrations deliberately leave sampling gaps.
  // Respect the six-second recovery policy instead of treating a fresh source
  // publication as instant permission to increase risk.
  const fresh=async()=>{
    if(sourceLoop&&sourceRunning){await wait(()=>runtime.snapshot(),s=>s.sourceMode==='Normal'&&s.now-s.risk.oracle.sampledAt<=3n,'fresh worker-owned observation');return;}
    const r=await t.risk();if(r.oracle.status!==2||await now()-r.oracle.sampledAt>=8n)await t.recover(r.referencePrice);
  };
  const place=t.place,fillOrder=t.fill,manual=t.manual;
  t.place=async(...args)=>{await fresh();return place(...args);};
  t.fill=async(...args)=>{await fresh();return fillOrder(...args);};
  t.manual=async(...args)=>{await fresh();return manual(...args);};
  let id=await t.place('RPC wallet places durable limit');let cancel=await t.cancelIx(id);await t.fill(id,1n);await send('RPC cancel wins after partial',[cancel],[owner]);await t.rejected('RPC stale keeper cannot fill cancelled remainder',await t.fillIx(id,1n));
  id=await t.place('RPC reverse cancel/fill race');const fill=await t.fillIx(id,1n);await t.cancel(id);await t.rejected('RPC cancel before first fill',fill);record('actual RPC partial/cancel and cancel/first-fill orderings preserve remaining authority');
  await t.sample();id=await t.place('RPC replace race');cancel=await t.cancelIx(id);await t.fill(id,1n);
  await send('RPC replacement preserves fee prefix',[await sdk.getReplaceOrderInstructionAsync({...setup,owner,participant:trader,id,version:1n,terms:await t.terms({lots:12n})})],[owner]);
  await t.rejected('RPC old cancel loses to replace',cancel,[owner]);await t.fill(id,1n);assert.equal((await t.order(id)).feeCharged,25n);await t.cancel(id);
  id=await t.place('RPC cancel wins before replacement');const replacement=await sdk.getReplaceOrderInstructionAsync({...setup,owner,participant:trader,id,version:1n,terms:await t.terms({lots:12n})});await t.cancel(id);await t.rejected('RPC cancelled order cannot be replaced',replacement,[owner]);record('both replace/cancel orderings and cumulative fee prefix hold over RPC');
  await t.sample();id=await t.place('RPC duplicate keeper prefix');const other=await fixtureKey('attacker'),duplicate=await t.fillIx(id,1n,0,other);await t.fill(id,1n);await t.rejected('RPC different keeper duplicate rejects',duplicate,[other]);await t.cancel(id);await t.flat();
  await t.sample();id=await t.place('RPC withdrawal race');await t.certify();const pending=await t.fillIx(id,1n);await send('RPC withdrawal before fill',[await t.withdrawIx(1n)],[owner]);await send('RPC fill after withdrawal',[sdk.routeComputeBudget(),pending]);await t.cancel(id);
  id=await t.place('RPC reverse withdrawal race');await t.certify();const withdrawal=await t.withdrawIx(1n);await t.fill(id,1n);await t.rejected('RPC fill invalidates stale withdrawal',withdrawal,[owner],6122);await t.cancel(id);await t.flat();record('duplicate keeper and both withdrawal/fill races commit only authorized state');
  async function pair(){const p=await t.participant(),id=p.book.lastOrderId+1n;const start=await slot(),common={side:1,lots:10n,reduceOnly:true,generation:p.generation,limit:54_000n,startSlot:start,expirySlot:start+3600n};
    await send('RPC existing-position protective pair',[await sdk.getPlaceProtectionInstructionAsync({...setup,owner,participant:trader,expectedId:id,tp:await t.terms({...common,trigger:1,threshold:61_000n}),sl:await t.terms({...common,trigger:2,threshold:59_000n})})],[owner]);return[id,id+1n];}
  await t.sample();await t.manual(0,10n);let [tp,sl]=await pair();await t.sample(61_000n);await t.fill(tp,4n);await t.sample(59_000n);await t.rejected('RPC clipped SL cannot reverse exposure',await t.fillIx(sl,7n));await t.fill(sl,6n);assert.equal((await t.participant()).lots,0n);
  await t.sample();await t.manual(0,10n);[tp,sl]=await pair();await t.sample(59_000n);await t.fill(sl,4n);await t.sample(61_000n);await t.fill(tp,6n);assert.equal((await t.participant()).lots,0n);
  await t.sample();await t.manual(0,10n);[tp,sl]=await pair();await t.flat();await t.manual(0,10n);await t.rejected('RPC reopened position cannot resurrect SL',await t.fillIx(sl,1n));await t.flat();record('both TP/SL orderings share one allowance; close/reopen invalidates old protection');
  await t.sample();id=await t.place('RPC cancellation during source failure');await t.sample(60_000n,{0:{level:1}});await t.cancel(id);assert.equal((await t.participant()).reserved,0n);await t.recover();record('wallet cancellation succeeds directly while source-dependent services are unavailable');
  await fresh();const expires=(await slot())+96n;id=await t.place('RPC exclusive expiry',{lots:1n,expirySlot:expires});await h.waitUntil(expires);
  await t.rejected('RPC current slot excludes expired authority',await t.fillIx(id,1n));await send('RPC permissionless cleanup releases expired reservation',[await sdk.getCleanupOrdersInstructionAsync({...setup,participant:trader})]);assert.equal((await t.order(id)).state,5);assert.equal((await t.participant()).reserved,0n);record('actual slot expiry and permissionless cleanup release remaining reserve');
  // Persist a real wallet order through the API before allowing an executor to broadcast.
  const ordersKey=await fixtureKey('p08-order-keeper');await send('fund separate order keeper SOL budget',[getTransferSolInstruction({source:payer,destination:ordersKey.address,amount:50_000_000n})]);const ordersPath=keyPath('orders-key',ordersKey);
  await publish();sourceLoop=(async()=>{while(sourceRunning){await delay(1500);if(sourceRunning)await publish();}})();void sourceLoop.catch(()=>{});
  let executor=start('executor');start('maker-a',paths.a);start('maker-b',paths.b);start('api');const fundingWorker=start('funding',paths.funding);
  await wait(()=>runtime.snapshot(),s=>s.sourceMode==='Normal'&&s.makers.every(m=>m.online),'service readiness');
  const p=await t.participant(),storedId=p.book.lastOrderId+1n;
  const ix=await sdk.getPlaceOrderInstructionAsync({...setup,owner,participant:trader,expectedId:storedId,terms:await t.terms({lots:70n,feeBudget:2000n})});
  const signed=await sdk.signInstructions(connection,owner,[ix]);const submitted=await post('/v1/submit',{requestId:'p08-wallet-order',wire:Buffer.from(signed.transaction.serialize()).toString('base64')});
  await wait(()=>runtime.queue.get('p08-wallet-order'),j=>j?.status==='finalized','wallet order finalization');assert.equal((await fetched(submitted.signature)).meta.err,null);
  // Stop broadcasting, persist a job in a separate discovery process, kill
  // that process, then restart two discovery workers against the same bytes.
  await stop(executor);const originalDiscovery=start('orders',ordersPath);
  const persisted=await wait(async()=> (await runtime.store.pool.query("SELECT request_id,wire,signature FROM service_intents WHERE run_id=$1 AND budget='orders'",[runId])).rows,rows=>rows.length>0,'durable order discovery');
  await stop(originalDiscovery);assert.equal((await t.order(storedId)).filled,0n);
  const orders1=start('orders',ordersPath),orders2=start('orders',ordersPath);executor=start('executor');
  await wait(()=>t.order(storedId),o=>o.state===3,'keeper completes bounded partial fills',60000);await stop(orders1);await stop(orders2);
  const done=await t.order(storedId);assert.equal(done.filled,70n);assert.equal(done.feeCharged,(done.notional+4999n)/5000n);
  const unchanged=(await runtime.store.pool.query('SELECT wire,signature FROM service_intents WHERE run_id=$1 AND request_id=$2',[runId,persisted[0].request_id])).rows[0];assert.equal(unchanged.wire,persisted[0].wire);assert.equal(unchanged.signature,persisted[0].signature);
  const listed=await fetch(api+'/v1/orders');assert.equal(listed.status,200);const ordersView=await listed.json();assert(json(ordersView).includes(storedId.toString()));record('HTTP signed wallet authority, persisted keeper bytes and two discovery processes complete 64+6 lots without overfill');
  const smallId=await t.place('RPC preferred size falls back within remaining fee budget',{lots:70n,feeBudget:13n});
  const smallerWorker=start('orders',ordersPath);await wait(()=>t.order(smallId),o=>o.filled===1n,'one-lot affordable partial',30000);await stop(smallerWorker);
  assert.equal((await t.order(smallId)).feeCharged,13n);await t.cancel(smallId);record('keeper finds a one-lot partial when its preferred size exceeds the lifetime fee budget');
  await stop(fundingWorker);for(const p of children.filter(p=>['maker-a','maker-b'].includes(roles.get(p)??'')))await stop(p);
  sourceRunning=false;await sourceLoop;await wait(()=>runtime.store.pool.query("SELECT count(*)::int AS n FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved')",[runId]),r=>r.rows[0].n===0,'durable jobs reconciled');for(const p of children)await stop(p);
  // Final real wallet close gives exact paired flat trader exposure.
  await t.recover();await t.flat();running=false;await indexLoop;await indexer.cycle();const snapshot=await runtime.snapshot(),row=await indexer.store.snapshot();assert.equal(row.state.sequence,snapshot.m.sequence.toString());
  const rebuild=new Indexer({rpcUrl:url,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:database,runId:runId+'-rebuild',market:a.market,anchor:custody.checks.find((x:any)=>x.label==='initialize custody market').signature});
  try{await rebuild.open();await rebuild.cycle();assert.deepEqual((await rebuild.store.snapshot()).state,row.state);}finally{await rebuild.close();}
  assert(indexer.metrics.notifications>0);const budgets=(await runtime.store.pool.query('SELECT name,wallet,spent::text,committed::text,cap::text FROM service_budgets WHERE run_id=$1 ORDER BY name',[runId])).rows;assert(budgets.every(b=>b.committed==='0'&&BigInt(b.spent)<=BigInt(b.cap)));
  const intents=(await runtime.store.pool.query('SELECT signature,budget,status FROM service_intents WHERE run_id=$1',[runId])).rows,fees=new Map<string,bigint>(),fills:any[]=[];
  for(const job of intents){const tx=await fetched(job.signature);assert(['finalized','failed'].includes(job.status));if(job.budget){const b=budgets.find(b=>b.name===job.budget)!;assert.equal(tx.transaction.message.accountKeys[0],b.wallet);fees.set(job.budget,(fees.get(job.budget)??0n)+BigInt(tx.meta.fee));}
    if(job.budget==='orders'&&!tx.meta.err){const event=decode(job.signature,tx,a.eventAuthority).find(e=>e.type==='route')!;assert([storedId.toString(),smallId.toString()].includes(event.data.orderId));fills.push({orderId:event.data.orderId,signature:job.signature,lots:event.data.lots,fee:event.data.fee,computeUnits:tx.meta.computeUnitsConsumed,accounts:tx.transaction.message.accountKeys.length});assert(tx.meta.computeUnitsConsumed<=320000);assert(tx.transaction.message.accountKeys.length<=20);}}
  assert.equal(fills.filter(x=>x.orderId===storedId.toString()).reduce((n,x)=>n+BigInt(x.lots),0n),70n);assert.equal(fills.filter(x=>x.orderId===smallId.toString()).reduce((n,x)=>n+BigInt(x.lots),0n),1n);assert(fills.length>=3);for(const b of budgets)assert.equal(BigInt(b.spent),fees.get(b.name)??0n);record('actual RPC/WS order events rebuild identically in fresh PostgreSQL and operator payer fees reconcile exactly');
  const events=(await runtime.store.pool.query("SELECT payload,signature,bytes FROM events WHERE run_id=$1 AND kind IN ('order','route') ORDER BY sequence",[runId])).rows;
  const conformance={accounts:[{program:'clearing',name:'participant',data:(await read(trader))!.toString('base64')}],events:events.map(e=>e.bytes)};writeFileSync(`${dir}/orders-conformance.json`,json(conformance));
  const legacy=JSON.parse(execFileSync(process.execPath,['tests/anchor-conformance/makers.cjs',`${dir}/orders-conformance.json`],{encoding:'utf8'}));
  const canonical=(v:any):any=>typeof v==='bigint'?v.toString():v instanceof Uint8Array?[...v]:Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='discriminator').map(([k,x])=>[k,canonical(x)])):v;
  assert.deepEqual(legacy.accounts[0],canonical(await t.participant()));legacy.events.forEach((e:any,i:number)=>{const expected={...events[i].payload};delete expected.discriminator;e.data.domain=Buffer.from(e.data.domain).toString('hex');assert.deepEqual(e.data,expected);});record('legacy Anchor independently decodes actual durable book and order/route critical events');
  writeFileSync(`${dir}/orders.json`,json({revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()!=='',runId,cohort:snapshot.members,intents:await publicIntents(runtime.store.pool,runId),checks,metrics:indexer.metrics,budgets,fills,events:events.length,final:row.state,vault:snapshot.actual,transactions:transactions.map(x=>({signature:x.signature,slot:x.tx.slot,err:x.tx.meta.err,fee:x.tx.meta.fee,computeUnits:x.tx.meta.computeUnitsConsumed})),binaries:Object.fromEntries(['clearing','maker_a','maker_b','oracle_fixture'].map(n=>[n,createHash('sha256').update(readFileSync(`target/deploy/${n}.so`)).digest('hex')]))})+'\n');
}finally{running=false;sourceRunning=false;await Promise.allSettled([indexLoop,sourceLoop]);for(const p of children)await stop(p);await runtime.close();await indexer.close();}
