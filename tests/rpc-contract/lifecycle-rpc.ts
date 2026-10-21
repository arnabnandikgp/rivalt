import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { address, type Instruction } from '@solana/kit';
import { Connection, Keypair } from '@solana/web3.js';
import { getCreateAccountInstruction,getTransferSolInstruction } from '@solana-program/system';
import { TOKEN_PROGRAM_ADDRESS,getInitializeAccount3Instruction,getMintToInstruction,getTokenDecoder } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { Indexer } from '../../packages/indexer/src/index.js';
import { json,decode } from '../../packages/indexer/src/events.js';
import { Runtime } from '../../packages/services/src/runtime.js';
import { signedWire } from '../../packages/services/src/queue.js';
import { addresses,fixtureKey,payerKey } from './custody-cases.js';
import { makerAddresses } from './maker-cases.js';
import { WireRpc } from './wire.js';

const dir=process.env.RIVALT_RUN_DIR!,url=process.env.RIVALT_RPC_URL!,database=process.env.RIVALT_DATABASE_URL!;
assert.equal(new URL(url).hostname,'127.0.0.1');
const runId=dir.split('/').at(-1)!,rpc=new WireRpc(url),connection=new Connection(url,'confirmed'),a=await addresses(),payer=await payerKey();
const owner=await fixtureKey('trader'),mint=await fixtureKey('mint'),token=await fixtureKey('user-token'),keeper=await fixtureKey('p06-keeper');
const makers=await Promise.all([0,1].map(makerAddresses)),[participant]=await sdk.findParticipantPda({market:a.market,owner:owner.address}),[routeState]=await sdk.findRouteStatePda({market:a.market}),[guard]=await sdk.findGuardPda({market:a.market});
const custody=JSON.parse(readFileSync(`${dir}/custody.json`,'utf8'));
const checks:string[]=[],transactions:any[]=[],children:ChildProcess[]=[];
const record=(label:string)=>{checks.push(label);console.log(`Lifecycle: ${label}`);};
async function wait<T>(read:()=>Promise<T>,accept:(value:T)=>boolean,label:string,timeout=20000){const end=Date.now()+timeout;let last:any;while(Date.now()<end){try{last=await read();if(accept(last))return last;}catch(e){last=e;}await delay(100);}throw new Error(`${label}: ${last instanceof Error?last.message:json(last)}`);}
async function read(key:string){const r=await rpc.call('getAccountInfo',[key,{encoding:'base64',commitment:'finalized'}]);return Buffer.from(r.value.data[0],'base64');}
async function confirmed(signature:string){
  await wait(()=>rpc.call('getSignatureStatuses',[[signature],{searchTransactionHistory:true}]),x=>x.value[0]?.confirmationStatus==='finalized','finalization');
  const tx=await wait(()=>rpc.call('getTransaction',[signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]),Boolean,'transaction fetch');
  assert.equal(tx.meta.err,null,json(tx.meta));transactions.push({signature,tx});return tx;
}
async function send(label:string,ixs:Instruction[],signers:Keypair[]=[]){
  const {transaction}=await sdk.signInstructions(connection,payer,ixs,signers),wire=Buffer.from(transaction.serialize()).toString('base64');
  const simulation=await rpc.call('simulateTransaction',[wire,{encoding:'base64',sigVerify:true,commitment:'confirmed'}]);assert.equal(simulation.value.err,null,`${label}: ${simulation.value.logs}`);
  const signature=await rpc.call('sendTransaction',[wire,{encoding:'base64',skipPreflight:true}]);await confirmed(signature);return signature;
}
const indexer=new Indexer({rpcUrl:url,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:database,runId,market:a.market,anchor:custody.checks.find((x:any)=>x.label==='initialize custody market').signature});
const runtime=new Runtime(database,runId,url);
let indexing=true,indexingPromise:Promise<void>|undefined;
const signPath=(name:string,key:Keypair)=>{const path=`${dir}/${name}.json`;writeFileSync(path,JSON.stringify(Array.from(key.secretKey)),{mode:0o600});return path;};
const paths={keeper:signPath('keeper',keeper),a:signPath('maker-a',makers[0].owner),b:signPath('maker-b',makers[1].owner)};
let processNumber=0;
function start(role:string,extra:Record<string,string>={}){
  const fd=openSync(`${dir}/service-${role}-${++processNumber}.log`,'w');
  const child=spawn(process.execPath,['--import','tsx','packages/services/src/main.ts'],{env:{...process.env,RIVALT_RUN_ID:runId,RIVALT_SERVICE_ROLE:role,...extra},stdio:['ignore',fd,fd]});closeSync(fd);children.push(child);return child;
}
async function stop(p:ChildProcess,signal:NodeJS.Signals='SIGTERM'){if(p.exitCode!==null || p.signalCode!==null)return;const closed=new Promise<void>(resolve=>p.once('exit',()=>resolve()));p.kill(signal);await Promise.race([closed,delay(15000).then(()=>{if(p.exitCode===null && p.signalCode===null){p.kill('SIGKILL');throw new Error('Service did not stop');}})]);}
let executor:ChildProcess|undefined,drop=false,dropSignature='',persistedBeforeBroadcast=false;
const proxy=createServer(async(req,res)=>{
  try{
    const parts:Buffer[]=[];for await(const part of req)parts.push(Buffer.from(part));const body=Buffer.concat(parts).toString(),q=JSON.parse(body);
    if(q.method==='sendTransaction' && drop){
      const signed=signedWire(q.params[0]);dropSignature=signed.signature;
      const row=(await runtime.store.pool.query('SELECT wire FROM service_intents WHERE run_id=$1 AND signature=$2',[runId,signed.signature])).rows[0];
      persistedBeforeBroadcast=row?.wire===q.params[0];assert(persistedBeforeBroadcast);
    }
    const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body});const text=await response.text();
    if(q.method==='sendTransaction' && drop){drop=false;executor?.kill('SIGKILL');res.destroy();return;}
    res.setHeader('content-type','application/json');res.end(text);
  }catch{res.destroy();}
});
await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));
const proxyUrl=`http://127.0.0.1:${(proxy.address() as any).port}`,apiUrl='http://127.0.0.1:18081';
const post=async(path:string,body:unknown)=>{const r=await fetch(apiUrl+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
const get=async(path:string)=>{const r=await fetch(apiUrl+path);if(!r.ok)throw new Error('API unavailable');return r.json();};
async function submit(id:string,ixs:Instruction[]){
  const {transaction}=await sdk.signInstructions(connection,owner,ixs),wire=Buffer.from(transaction.serialize()).toString('base64');
  const r=await post('/v1/submit',{requestId:id,wire});assert.equal(r.status,200,json(r.body));return {wire,signature:r.body.signature};
}
async function done(id:string){const result=await wait(()=>get(`/v1/submissions/${id}`),r=>['finalized','failed','expired-unexecuted'].includes(r.status),id);assert.equal(result.status,'finalized',json(result));return confirmed(result.signature);}
const quoted=(q:any):Instruction[]=>q.instructions.map((i:any)=>({programAddress:address(i.programAddress),accounts:i.accounts,data:Buffer.from(i.data,'base64')}));
try{
  await send('fund explicitly budgeted keeper',[getTransferSolInstruction({source:payer,destination:keeper.address,amount:10_000_000n})]);
  for(const [id,x] of makers.entries()){
    await send('register real maker capital',[
      getTransferSolInstruction({source:payer,destination:x.owner.address,amount:1_000_000_000n}),
      await sdk.getRegisterParticipantInstructionAsync({...a,owner:x.owner}),
      getCreateAccountInstruction({payer,newAccount:x.token,lamports:BigInt(await rpc.call('getMinimumBalanceForRentExemption',[165])),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),
      getInitializeAccount3Instruction({account:x.token.address,mint:mint.address,owner:x.owner.address}),
      getMintToInstruction({mint:mint.address,token:x.token.address,mintAuthority:payer,amount:50_000_000n}),
    ],[x.owner,x.token]);
    const m=sdk.getMarketStateDecoder().decode(await read(a.market));
    await send('initialize expiring maker authority',[await (id===0?sdk.makerA:sdk.makerB).getInitializeConfigInstructionAsync({...x,domain:m.domain,duration:512n})],[x.owner]);
    await send('fund maker through token CPI',[await sdk.getDepositInstructionAsync({...x,participant:x.capital,quoteMint:mint.address,userToken:x.token.address,amount:50_000_000n})],[x.owner]);
    await send('register maker pricing',[await sdk.getRegisterMakerInstructionAsync({...x,authority:payer,makerId:id,inventoryLimit:100_000n})],[x.owner]);
  }
  await send('activate synthetic trading and initialize guard',[
    await sdk.getInitializeTestRoutesInstructionAsync({...a,authority:payer,reference:60_000n,duration:3600n}),await sdk.getInitializeExitGuardInstructionAsync({...a,payer}),
    getMintToInstruction({mint:mint.address,token:token.address,mintAuthority:payer,amount:100_000_000n}),
  ]);
  await indexer.open();await indexer.cycle();await runtime.open();
  indexingPromise=(async()=>{while(indexing){try{await indexer.cycle();}catch{}await delay(100);}})();
  const api=start('api');executor=start('executor',{RIVALT_RPC_URL:proxyUrl});
  let makerA=start('maker-a',{RIVALT_SIGNER_PATH:paths.a}),makerB=start('maker-b',{RIVALT_SIGNER_PATH:paths.b});
  await wait(()=>get('/ready'),x=>x.ready,'service readiness');
  await wait(()=>get('/v1/operators'),x=>x.makers.length===2 && x.makers.every((m:any)=>m.online && BigInt(m.quoteEpoch)>=2n),'distinct maker daemons publish expired epochs',20_000+512*Number(process.env.RIVALT_SLOT_TIME??100));
  assert.notEqual(makerA.pid,makerB.pid);assert.notEqual(makers[0].owner.address,makers[1].owner.address);
  record('separate A/B keypairs and processes publish/sync real expired epochs; funded fee budgets visible');
  drop=true;
  const deposit=await submit('wallet-deposit',[await sdk.getDepositInstructionAsync({...a,owner,participant,quoteMint:mint.address,userToken:token.address,amount:100_000_000n})]);
  await wait(async()=>executor!.signalCode,x=>x==='SIGKILL','executor killed after dropped broadcast acknowledgement');
  assert.equal(dropSignature,deposit.signature);assert(persistedBeforeBroadcast);
  executor=start('executor',{RIVALT_RPC_URL:proxyUrl});await done('wallet-deposit');
  const duplicate=await post('/v1/submit',{requestId:'wallet-deposit',wire:deposit.wire});assert.equal(duplicate.body.signature,deposit.signature);
  assert.equal(sdk.getParticipantDecoder().decode(await read(participant)).cash,100_000_000n);
  record('signed wallet bytes committed before broadcast; lost acknowledgement plus SIGKILL/restart and duplicate POST apply one deposit');
  const changed=await sdk.signInstructions(connection,owner,[await sdk.getDepositInstructionAsync({...a,owner,participant,quoteMint:mint.address,userToken:token.address,amount:1n})]);
  assert.equal((await post('/v1/submit',{requestId:'wallet-deposit',wire:Buffer.from(changed.transaction.serialize()).toString('base64')})).status,400);
  record('same idempotency key with different signed bytes rejected');
  const open=(await post('/v1/quote',{owner:owner.address,side:0,lots:'100'})).body;
  assert(open.available,json(open));assert.deepEqual(open.allocation.legs.map((l:any)=>[l.makerId,l.lots]),[[0,'21'],[1,'79']]);assert.equal(open.allocation.grossQuote,'6002790');assert.equal(open.allocation.fee,'1201');
  await submit('wallet-open',quoted(open));await done('wallet-open');
  let p=sdk.getParticipantDecoder().decode(await read(participant));assert.equal(p.lots,100n);assert.equal(p.virtualScaled,-6_002_790_000_000_000n);assert.equal(p.cash,99_998_799n);
  record('HTTP quote and wallet-paid submission execute independently priced 21/79 split with one 2 bps fee');
  const beforeStale=await read(participant),stale=await submit('wallet-stale-open',quoted(open));
  const staleResult=await wait(()=>get('/v1/submissions/wallet-stale-open'),x=>x.status==='failed','stale quote authority rejected');
  const staleTx=await rpc.call('getTransaction',[stale.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
  assert.equal(staleTx.meta.err.InstructionError[1].Custom,6117);assert.deepEqual(await read(participant),beforeStale);
  assert.equal(staleResult.result.error.InstructionError[1].Custom,6117);
  record('consumed quote nonce fails through actual API/executor/RPC with no financial projection or duplicated fill');
  await stop(makerA);await wait(()=>get('/v1/operators'),x=>x.makers.find((m:any)=>m.makerId===0).online===false,'maker outage visible');
  await send('publish next synthetic common reference',[await sdk.getPublishTestRiskInstructionAsync({...a,authority:payer,reference:61_000n,duration:3600n})]);
  const close=(await post('/v1/quote',{owner:owner.address,side:1,lots:'100'})).body;
  assert(close.available,json(close));assert.deepEqual(close.allocation.legs.map((l:any)=>[l.makerId,l.lots]),[[1,'100']]);assert.equal(close.allocation.grossQuote,'6097000');assert.equal(close.allocation.fee,'1220');
  await submit('wallet-close',quoted(close));await done('wallet-close');
  p=sdk.getParticipantDecoder().decode(await read(participant));assert.equal(p.lots,0n);assert.equal(p.cash,99_997_579n);assert.equal(p.virtualScaled,94_210_000_000_000n);
  assert.equal(sdk.getMarketStateDecoder().decode(await read(a.market)).settlement,0n);
  record('maker A outage excluded from labeled quote universe; B closes common position with 94,210 unpaid atoms and zero fabricated settlement cash');
  makerA=start('maker-a',{RIVALT_SIGNER_PATH:paths.a});await wait(()=>get('/v1/operators'),x=>x.makers.every((m:any)=>m.online),'maker return visible');record('maker return observable with same on-chain authority');
  let settlement=start('settlement',{RIVALT_SIGNER_PATH:paths.keeper});
  await wait(async()=>(await runtime.queue.pending()).some(id=>id.startsWith('keeper:')),Boolean,'keeper durable work');
  await stop(settlement,'SIGKILL');settlement=start('settlement',{RIVALT_SIGNER_PATH:paths.keeper});
  const contender=start('settlement',{RIVALT_SIGNER_PATH:paths.keeper});
  await wait(async()=>sdk.getParticipantDecoder().decode(await read(participant)),p=>p.virtualScaled===0n && p.cash===100_091_789n,'funded ordinary settlement');
  await wait(async()=>{const s=await runtime.snapshot();return s.certificate.sequence===s.m.sequence && s.certificate.next===3;},Boolean,'fresh complete cohort certificate');
  await stop(settlement);await stop(contender);
  const funded=await runtime.snapshot();assert.equal(funded.m.settlement,0n);assert.equal(funded.participants[makers[0].capital].cash,49_979_420n);assert.equal(funded.participants[makers[1].capital].cash,49_926_370n);
  record('keeper restart and competing workers collect 20,580 + 73,630 loss atoms, then settle exactly 94,210 to winner');
  const walletBefore=getTokenDecoder().decode(await read(token.address)).amount;
  await submit('wallet-withdraw',[await sdk.getWithdrawTradingInstructionAsync({...a,owner,participant,routeState,guard,quoteMint:mint.address,userToken:token.address,sequence:funded.m.sequence,observation:funded.risk.observationSequence,amount:100_091_789n})]);await done('wallet-withdraw');
  assert.equal(getTokenDecoder().decode(await read(token.address)).amount,walletBefore+100_091_789n);assert.equal(sdk.getParticipantDecoder().decode(await read(participant)).cash,0n);
  record('wallet directly withdraws all flat funded cash through SPL CPI after complete-cohort authorization');
  // Keep enough user margin for an expired, never-broadcast route authority test.
  await submit('wallet-redeposit',[await sdk.getDepositInstructionAsync({...a,owner,participant,quoteMint:mint.address,userToken:token.address,amount:10_000_000n})]);await done('wallet-redeposit');
  await stop(executor);const expire=(await post('/v1/quote',{owner:owner.address,side:0,lots:'1'})).body;assert(expire.available);
  const expired=await submit('wallet-expired',quoted(expire)),blockhash=signedWire(expired.wire).blockhash;
  const ambiguous=await submit('wallet-ambiguous-deposit',[await sdk.getDepositInstructionAsync({...a,owner,participant,quoteMint:mint.address,userToken:token.address,amount:1n})]);
  const ambiguousHash=signedWire(ambiguous.wire).blockhash;
  const beforeExpiry=await read(participant);
  await wait(()=>rpc.call('isBlockhashValid',[blockhash,{commitment:'finalized'}]),x=>x.value===false,'real blockhash expiry',45000);
  await wait(()=>rpc.call('isBlockhashValid',[ambiguousHash,{commitment:'finalized'}]),x=>x.value===false,'second blockhash expiry',45000);
  executor=start('executor',{RIVALT_RPC_URL:proxyUrl});
  await wait(()=>get('/v1/submissions/wallet-expired'),x=>x.status==='expired-unexecuted','expiry plus unchanged authoritative nonce');
  assert.deepEqual(await read(participant),beforeExpiry);
  assert.equal(await rpc.call('getTransaction',[expired.signature,{commitment:'finalized',maxSupportedTransactionVersion:0}]),null);
  record('actual blockhash expiry plus finalized unchanged nonce resolves unexecuted intent without re-signing or resubmission');
  await wait(()=>get('/v1/submissions/wallet-ambiguous-deposit'),x=>x.status==='unresolved' && x.attempts>0,'absent deposit history remains unresolved');
  assert.deepEqual(await read(participant),beforeExpiry);
  record('expired deposit without monotonic authority remains unresolved; missing history alone is never reported as execution or nonexecution');
  for(const child of children)await stop(child);
  const feeState=await runtime.snapshot();
  const feeProbe=await sdk.signInstructions(connection,keeper,[await sdk.getCollectLossInstructionAsync({...a,participant,routeState,guard,sequence:feeState.m.sequence,observation:feeState.risk.observationSequence,amount:1n})]);
  const feeWire=Buffer.from(feeProbe.transaction.serialize()).toString('base64'),feeSigned=signedWire(feeWire);
  const beforeBudget=(await runtime.store.pool.query("SELECT * FROM service_budgets WHERE run_id=$1 AND name='keeper'",[runId])).rows[0];
  await runtime.queue.put('keeper:hidden-failed-fee',feeWire,{kind:'sequence',account:a.market,value:feeState.m.sequence.toString()},'keeper');
  await runtime.queue.step('keeper:hidden-failed-fee');
  await wait(()=>rpc.call('getSignatureStatuses',[[feeSigned.signature],{searchTransactionHistory:true}]),x=>x.value[0]?.confirmationStatus==='finalized','failed fee probe finalization');
  const failedFee=await rpc.call('getTransaction',[feeSigned.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);assert(failedFee.meta.err);transactions.push({signature:feeSigned.signature,tx:failedFee});
  const realCall=runtime.rpc.call.bind(runtime.rpc);
  runtime.rpc.call=async(method,params=[])=>method==='getSignatureStatuses'?{value:[null]}:realCall(method,params);
  await wait(()=>rpc.call('isBlockhashValid',[feeSigned.blockhash,{commitment:'finalized'}]),x=>x.value===false,'hidden failed transaction expiry',45000);
  await runtime.queue.step('keeper:hidden-failed-fee');
  assert.equal((await runtime.queue.get('keeper:hidden-failed-fee')).status,'expired-unexecuted');
  assert.equal((await runtime.queue.get('keeper:hidden-failed-fee')).result.fee,null);
  const held=(await runtime.store.pool.query("SELECT * FROM service_budgets WHERE run_id=$1 AND name='keeper'",[runId])).rows[0];
  assert.equal(BigInt(held.committed),BigInt(beforeBudget.committed)+20_000n);assert.equal(held.spent,beforeBudget.spent);
  runtime.rpc.call=realCall;await runtime.queue.step('keeper:hidden-failed-fee');
  assert.equal((await runtime.queue.get('keeper:hidden-failed-fee')).status,'failed');
  const resolved=(await runtime.store.pool.query("SELECT * FROM service_budgets WHERE run_id=$1 AND name='keeper'",[runId])).rows[0];
  assert.equal(resolved.committed,beforeBudget.committed);assert.equal(BigInt(resolved.spent),BigInt(beforeBudget.spent)+BigInt(failedFee.meta.fee));
  record('hidden failed landing cannot release fee reservation on expiry; restored RPC history reconciles actual charged network fee');
  const budget=await runtime.store.pool.query('SELECT * FROM service_budgets WHERE run_id=$1',[runId]);assert.equal(budget.rows.length,3);
  for(const row of budget.rows){assert(BigInt(row.spent)>0n);assert(BigInt(row.spent)+BigInt(row.committed)<=BigInt(row.cap));}
  const rows=(await runtime.store.pool.query('SELECT * FROM service_intents WHERE run_id=$1 ORDER BY created_at',[runId])).rows;
  for(const row of rows.filter(r=>r.status==='finalized')){const tx=await confirmed(row.signature);assert.equal(tx.transaction.message.accountKeys[0],signedWire(row.wire).keys[0]);}
  const makerFees=rows.filter(r=>r.budget?.startsWith('maker-')).map(r=>r.signature);assert(makerFees.length>=2);
  for(const row of budget.rows){const fees=rows.filter(r=>r.budget===row.name && ['finalized','failed'].includes(r.status)).reduce((n,r)=>n+BigInt(r.result.fee),0n);assert.equal(fees,BigInt(row.spent));}
  await assert.rejects(()=>runtime.store.pool.query("UPDATE service_intents SET wire='changed' WHERE run_id=$1",[runId]),/immutable signed intent/);
  record('operator reservations and spend reconcile to independently fetched payer/fee records; immutable intent bytes enforced by PostgreSQL');
  await runtime.queue.budget('negative-cap',keeper.address,1n);
  const limit=await sdk.signInstructions(connection,keeper,[await sdk.getCheckExitCohortInstructionAsync({...a,routeState,guard,sequence:1n,observation:1n,start:0})]);
  await assert.rejects(()=>runtime.queue.put('budget-exhaustion',Buffer.from(limit.transaction.serialize()).toString('base64'),null,'negative-cap'),/budget exhausted/);
  assert.equal(await runtime.queue.get('budget-exhaustion'),null);
  record('insufficient explicit operator budget rejects persistence/broadcast without deducting participant collateral');
  for(const child of children)await stop(child);indexing=false;await indexingPromise;await indexer.cycle();const reconciliation=await indexer.reconcile();
  const state=(await indexer.store.snapshot()).state;assert.equal(state.participants[participant].cash,'10000000');assert.equal(state.participants[participant].lots,'0');assert.equal(state.participants[participant].virtualScaled,'0');
  const events=(await indexer.store.pool.query('SELECT kind,payload,bytes FROM events WHERE run_id=$1 ORDER BY sequence',[runId])).rows;
  assert.equal(events.filter(e=>e.kind==='route').length,2);assert.equal(events.filter(e=>e.kind==='settlement').length,4);
  assert(indexer.metrics.notifications>0);
  const legacyInput={accounts:{exitGuard:(await read(guard)).toString('base64')},events:events.filter(e=>e.kind==='settlement').map(e=>e.bytes)};
  writeFileSync(`${dir}/settlement-conformance.json`,json(legacyInput));const legacy=JSON.parse(execFileSync(process.execPath,['tests/anchor-conformance/custody.cjs',`${dir}/settlement-conformance.json`],{encoding:'utf8'}));
  assert.equal(legacy.events.length,4);assert.equal(legacy.accounts.exitGuard.count,3);
  legacy.events.forEach((event:any,i:number)=>{const expected={...events.filter(e=>e.kind==='settlement')[i].payload};delete expected.discriminator;const actual=event.data;actual.domain=Buffer.from(actual.domain).toString('hex');assert.deepEqual(actual,expected);});
  record('finalized RPC and live WS projections reconcile every participant, vault, funding pool and fee; legacy Anchor decodes live settlement events and guard');
  writeFileSync(`${dir}/lifecycle.json`,json({revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()!=='',checks,reconciliation,metrics:indexer.metrics,budgets:budget.rows.map(({run_id,...r})=>r),intents:rows.map(({wire,...r})=>({...r,wireSha256:createHash('sha256').update(wire).digest('hex')})),state,transactions}));
}finally{
  for(const child of children)await stop(child);indexing=false;await indexingPromise;await indexer.close();await runtime.close();await new Promise<void>(resolve=>proxy.close(()=>resolve()));
}
