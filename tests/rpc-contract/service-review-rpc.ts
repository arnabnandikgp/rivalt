// Focused review regressions: actual Surfpool RPC/WS + durable PostgreSQL intents.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Connection, type Keypair } from '@solana/web3.js';
import { type Instruction } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import * as sdk from '@rivalt/sdk';
import { Indexer } from '../../packages/indexer/src/index.js';
import { Runtime } from '../../packages/services/src/runtime.js';
import { RESERVATION } from '../../packages/services/src/queue.js';
import { json } from '../../packages/indexer/src/events.js';
import { addresses, payerKey, fixtureKey } from './custody-cases.js';
import { oracleSetup, type OracleHarness } from './oracle-cases.js';
import { WireRpc } from './wire.js';
const dir=process.env.RIVALT_RUN_DIR!,url=process.env.RIVALT_RPC_URL!,database=process.env.RIVALT_DATABASE_URL!,runId=dir.split('/').at(-1)!;
const rpc=new WireRpc(url),connection=new Connection(url,'confirmed'),payer=await payerKey(),a=await addresses();
const transactions:any[]=[],checks:string[]=[];
async function wait<T>(read:()=>Promise<T>,accept:(x:T)=>boolean,label:string,timeout=60000){
  const end=Date.now()+timeout;let last:any;
  while(Date.now()<end){last=await read();if(accept(last))return last;await delay(100);}
  throw new Error(`${label}: ${json(last)}`);
}
const read=async(key:string)=>{const r=await rpc.call('getAccountInfo',[key,{encoding:'base64',commitment:'finalized'}]);return r.value?Buffer.from(r.value.data[0],'base64'):null;};
async function fetched(signature:string){
  await wait(()=>rpc.call('getSignatureStatuses',[[signature],{searchTransactionHistory:true}]),r=>r.value[0]?.confirmationStatus==='finalized','finalized');
  const tx=await wait(()=>rpc.call('getTransaction',[signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]),Boolean,'fetch');
  transactions.push({signature,tx});return tx;
}
async function send(label:string,ixs:Instruction[],signers:Keypair[]=[],error?:number|'reject'){
  const {transaction}=await sdk.signInstructions(connection,payer,ixs,signers);
  const signature=await rpc.call('sendTransaction',[Buffer.from(transaction.serialize()).toString('base64'),{encoding:'base64',skipPreflight:true}]);
  const tx=await fetched(signature);
  if(error===undefined)assert.equal(tx.meta.err,null,`${label}: ${tx.meta.logMessages}`);
  else{assert(tx.meta.err);if(error!=='reject')assert(tx.meta.logMessages.some((l:string)=>l.includes(`Error Number: ${error}.`)));}
}
const h:OracleHarness={read,send,rent:async n=>BigInt(await rpc.call('getMinimumBalanceForRentExemption',[n])),
  slot:async()=>BigInt(await rpc.call('getSlot',[{commitment:'finalized'}])),
  now:async()=>(await read('SysvarC1ock11111111111111111111111111111111'))!.readBigInt64LE(32),
  waitUntil:async n=>{await wait(h.slot,x=>x>=n,'slot');},waitTime:async n=>{await wait(h.now,x=>x>=n,'clock');},
  quote:async()=>{throw new Error('Unused');}};
const setup=await oracleSetup(h,512n),funding=await fixtureKey('review-funding');
await send('fund separate operator budget',[getTransferSolInstruction({source:payer,destination:funding.address,amount:10_000_000n})]);
const anchor=JSON.parse(readFileSync(`${dir}/custody.json`,'utf8')).checks.find((x:any)=>x.label==='initialize custody market').signature;
const indexer=new Indexer({rpcUrl:url,wsUrl:process.env.RIVALT_WS_URL!,databaseUrl:database,runId,market:a.market,anchor});
let runtime=new Runtime(database,runId,url);
const budgets=async()=>Object.fromEntries((await runtime.store.pool.query('SELECT * FROM service_budgets WHERE run_id=$1',[runId])).rows.map(r=>[r.name,r]));
async function finish(id:string,status:string){
  const row=await wait(async()=>{await runtime.queue.step(id);return runtime.queue.get(id);},r=>r?.status===status,id);
  if(status!=='expired-unexecuted')await fetched(row.signature);return row;
}
try{
  await indexer.open();await indexer.cycle();await runtime.open();
  const before=await runtime.snapshot(),[x,y]=setup.makers,o=before.risk.oracle;
  await runtime.queue.budget('funding',funding.address,runtime.budgets.operator);
  const bad=await sdk.getSampleOracleInstructionAsync({...setup,primaryBtc:o.sources[1],primaryCollateral:o.sources[1],guardBtc:o.sources[2],guardCollateral:o.sources[3],
    firstCapital:x.capital,firstRegistration:x.registration,firstProgram:x.pricingProgram,firstProgramData:x.programData,firstConfig:x.config,
    secondCapital:y.capital,secondRegistration:y.registration,secondProgram:y.pricingProgram,secondProgramData:y.programData,secondConfig:y.config});
  const id=`funding:${before.risk.observationSequence}`;
  await runtime.enqueue(id,[sdk.fundingComputeBudget(),bad],funding,'funding',{kind:'sequence',account:a.market,value:before.m.sequence.toString()});
  const failed=await finish(id,'failed');
  assert.equal((await runtime.snapshot()).risk.observationSequence,before.risk.observationSequence);
  assert.equal((await budgets()).funding.committed,'0');
  await runtime.close();runtime=new Runtime(database,runId,url);await runtime.open();
  await runtime.funding(funding);
  const retried=await finish(`${id}:retry:1`,'finalized');
  assert.notEqual(retried.signature,failed.signature);assert.deepEqual(await runtime.queue.get(id),failed);
  assert.equal((await runtime.snapshot()).risk.observationSequence,before.risk.observationSequence+1n);
  assert.equal(BigInt((await budgets()).funding.spent),BigInt(failed.result.fee)+BigInt(retried.result.fee));
  checks.push('failed funding attempt survives restart and retries once under a new immutable ID with exact fees');
  await indexer.cycle();
  // A signed maker publication is deliberately never broadcast. Real expiry and
  // the unchanged finalized registration epoch prove absence of its effect.
  const registration=sdk.getLegacyMakerRegistrationDecoder().decode((await read(x.registration))!);
  const makerId=`maker:0:${registration.quoteEpoch}`;
  await runtime.queue.budget('maker-0',x.owner.address,runtime.budgets.maker);
  const ixs=[sdk.makerA.getPublishEpochInstruction({owner:x.owner,config:x.config,duration:3600n}),await sdk.getSyncMakerEpochInstructionAsync(x)];
  await runtime.enqueue(makerId,ixs,x.owner,'maker-0',{kind:'quoteEpoch',account:x.registration,value:registration.quoteEpoch.toString()});
  const original=(await runtime.store.pool.query('SELECT * FROM service_intents WHERE run_id=$1 AND request_id=$2',[runId,makerId])).rows[0];
  await wait(()=>rpc.call('isBlockhashValid',[original.blockhash,{commitment:'finalized'}]),r=>r.value===false,'real blockhash expiry');
  await finish(makerId,'expired-unexecuted');
  assert.equal(BigInt((await budgets())['maker-0'].committed),RESERVATION);
  assert.equal((await rpc.call('getSignatureStatuses',[[original.signature],{searchTransactionHistory:true}])).value[0],null);
  await h.waitUntil(registration.expirySlot);
  await runtime.close();runtime=new Runtime(database,runId,url);await runtime.open();
  await runtime.maker(0,x.owner);
  const published=await finish(`${makerId}:retry:1`,'finalized');
  const after=sdk.getLegacyMakerRegistrationDecoder().decode((await read(x.registration))!);
  assert.equal(after.quoteEpoch,registration.quoteEpoch+1n);
  assert.equal(sdk.makerA.getMakerConfigDecoder().decode((await read(x.config))!).state.quoteEpoch,after.quoteEpoch);
  const retained=(await runtime.store.pool.query('SELECT * FROM service_intents WHERE run_id=$1 AND request_id=$2',[runId,makerId])).rows[0];
  assert.equal(retained.wire,original.wire);assert.equal(retained.signature,original.signature);
  assert.equal(BigInt((await budgets())['maker-0'].committed),RESERVATION);
  assert.equal(BigInt((await budgets())['maker-0'].spent),BigInt(published.result.fee));
  checks.push('unbroadcast maker expiry recovers across restart with exactly one epoch advance and unknown fee retained');
  await indexer.cycle();
  const final=await runtime.snapshot();
  assert.equal(final.actual,final.m.totalCash+final.m.insurance+final.m.settlement+final.m.fees);
  assert.equal(final.actual,before.actual);assert.equal(final.m.totalCash,before.m.totalCash);
  assert.equal(final.m.fees,before.m.fees);assert.equal(final.m.fundingIndexScaled,0n);
  assert.equal((await indexer.store.snapshot()).error,null);
  const rows=(await runtime.store.pool.query('SELECT request_id,signature,status,authority,result FROM service_intents WHERE run_id=$1 ORDER BY request_id',[runId])).rows;
  writeFileSync(`${dir}/review-services.json`,json({revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()!=='',checks,transactions,intents:rows,budgets:await budgets(),indexer:indexer.metrics,final:{cash:final.m.totalCash,vault:final.actual,fees:final.m.fees}})+'\n');
  console.log(`Review service RPC: ${checks.length} restart/retry cases passed with actual PostgreSQL and RPC/WS.`);
}finally{await runtime.close();await indexer.close();}
