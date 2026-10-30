import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { Connection, Keypair } from '@solana/web3.js';
import { address, getBase58Encoder, type Instruction } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { payerKey, addresses } from './custody-cases.js';
import { makerCases, makerAddresses, makerIds, type MakerHarness } from './maker-cases.js';
import { eventually, WireRpc, WireSubscriptions } from './wire.js';
const url=process.env.RIVALT_RPC_URL!,dir=process.env.RIVALT_RUN_DIR!;
assert.equal(new URL(url).hostname,'127.0.0.1','public fixtures are local only');
const rpc=new WireRpc(url),connection=new Connection(url,'confirmed'),ws=new WireSubscriptions(process.env.RIVALT_WS_URL!);
const payer=await payerKey(),a=await addresses(),base58=getBase58Encoder();
const checks:any[]=[],events:any[]=[],eventBytes:string[]=[],returns:any[]=[],failed:any[]=[];
const serial=(v:unknown)=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x instanceof Uint8Array?Array.from(x):x?.type==='Buffer'?x.data:x,2)+'\n';
await ws.ready();const subscription=await ws.call('logsSubscribe',[{mentions:[a.program]},{commitment:'confirmed'}]);
async function send(label:string,instructions:Instruction[],signers:Keypair[]=[],expectedError?:number|'reject') {
  const {transaction}=await sdk.signInstructions(connection,payer,instructions,signers);
  const wire=Buffer.from(transaction.serialize()).toString('base64');
  const sim=await rpc.call('simulateTransaction',[wire,{encoding:'base64',sigVerify:true,commitment:'confirmed'}]);
  if(expectedError===undefined) assert.equal(sim.value.err,null,`${label}: ${sim.value.logs?.join('\n')}`);
  else if(expectedError!=='reject') assert.equal(sim.value.err?.InstructionError?.[1]?.Custom,expectedError,`${label}: ${sim.value.logs?.join('\n')}`);
  else assert(sim.value.err,label);
  const signature=await rpc.call('sendTransaction',[wire,{encoding:'base64',skipPreflight:true}]);
  const status=await eventually(()=>rpc.call('getSignatureStatuses',[[signature],{searchTransactionHistory:true}]),x=>x.value[0]?.confirmationStatus==='finalized',label);
  const history=await eventually(()=>rpc.call('getTransaction',[signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]),x=>Boolean(x),label);
  assert.deepEqual(history.meta.err,status.value[0].err);
  if(expectedError===undefined) assert.equal(history.meta.err,null,label);
  else {assert(history.meta.err,label);if(expectedError!=='reject') assert.equal(history.meta.err.InstructionError?.[1]?.Custom,expectedError,label);failed.push({label,history});}
  const keys=history.transaction.message.accountKeys;
  for(const inner of history.meta.innerInstructions.flatMap((x:any)=>x.instructions)) {
    const producer=keys[inner.programIdIndex];
    if(makerIds.includes(producer)) {assert.equal(inner.accounts.length,1,'pricing CPI exposed additional accounts');assert(!inner.accounts.some((i:number)=>[a.market,a.vault].includes(keys[i])));}
    if(producer!==a.program)continue;
    const data=Buffer.from(base58.encode(inner.data));
    const maker=data.subarray(8,16).equals(Buffer.from(sdk.MAKER_CHANGED_EVENT_DISCRIMINATOR));
    const custody=data.subarray(8,16).equals(Buffer.from(sdk.CUSTODY_CHANGED_EVENT_DISCRIMINATOR));
    if((maker||custody)&&expectedError===undefined) {
      events.push(maker?sdk.parseMakerChangedEvent(data.subarray(8)):sdk.parseCustodyChangedEvent(data.subarray(8)));
      if(maker)eventBytes.push(data.subarray(8).toString('base64'));
    }
  }
  checks.push({label,signature,status:expectedError===undefined?'pass':'rejected',error:history.meta.err,bytes:transaction.serialize().length,accounts:keys.length,computeUnits:sim.value.unitsConsumed});
  return history;
}
const h:MakerHarness={
  async rent(n){return BigInt(await rpc.call('getMinimumBalanceForRentExemption',[n]));},
  async read(key){const x=await rpc.call('getAccountInfo',[key,{encoding:'base64',commitment:'finalized'}]);return x.value?Buffer.from(x.value.data[0],'base64'):null;},
  async send(...args){await send(...args);},
  async quote(label,ix){const history=await send(label,[ix]);const r=history.meta.returnData;assert(r&&r.data[1]==='base64',label);returns.push({program:r.programId===a.program?'clearing':r.programId===makerIds[0]?'maker_a':'maker_b',data:r.data[0]});return{producer:address(r.programId),data:Buffer.from(r.data[0],'base64')};},
  async slot(){return BigInt(await rpc.call('getSlot',[{commitment:'confirmed'}]));},
  async waitUntil(slot){
    console.log(`Waiting over standard RPC for exclusive maker expiry at slot ${slot}.`);
    const deadline=Date.now()+420_000;
    while(await h.slot()<slot){assert(Date.now()<deadline,'maker expiry timeout');await delay(250);}
  },
};
try {
  const starting=sdk.getMarketStateDecoder().decode((await h.read(a.market))!).sequence;
  const result=await makerCases(h);
  // Real signed local program upgrade of identical bytes, changing loader metadata.
  const x=await makerAddresses(0),before=(await h.read(x.programData))!;
  execFileSync('solana-keygen',['new','--silent','--no-bip39-passphrase','--outfile',`${dir}/maker-upgrade-buffer.json`],{stdio:'ignore'});
  const deployment=JSON.parse(execFileSync('solana',['program','deploy','target/deploy/maker_a.so','--buffer',`${dir}/maker-upgrade-buffer.json`,'--program-id','.local/keys/maker-a.json','--keypair','.local/keys/payer.json','--url',url,'--use-rpc','--max-sign-attempts','20','--output','json'],{encoding:'utf8'}));
  const after=await eventually(()=>h.read(x.programData),v=>v!==null&&!v.equals(before),'actual maker upgrade');assert(after);
  const m=sdk.getMarketStateDecoder().decode((await h.read(a.market))!),r=sdk.getLegacyMakerRegistrationDecoder().decode((await h.read(x.registration))!);
  const input={...x,side:0,lots:10n,referencePrice:60_000n,quoteEpoch:r.quoteEpoch,authorityEpoch:r.authorityEpoch,termsEpoch:m.termsEpoch,configEpoch:m.configEpoch};
  await h.send('reject actual unapproved local program upgrade',[await sdk.getPreviewMakerInstructionAsync(input)],[],6114);
  await h.send('approve actual upgraded deployment jointly',[await sdk.getApproveMakerInstructionAsync({...x,authority:payer})],[x.owner]);
  await h.send('reject old authority after upgrade approval',[await sdk.getPreviewMakerInstructionAsync(input)],[],6112);
  await h.quote('quote after authorized actual upgrade approval',await sdk.getPreviewMakerInstructionAsync({...input,authorityEpoch:r.authorityEpoch+1n}));
  await ws.notification(subscription);
  events.forEach((e,i)=>{assert.equal(e.sequence,starting+BigInt(i+1));assert.equal(e.market,a.market);});
  const accounts:any[]=[];
  for(const id of [0,1]) {const x=await makerAddresses(id);accounts.push({program:'clearing',name:'legacyMakerRegistration',data:(await h.read(x.registration))!.toString('base64')},{program:id===0?'maker_a':'maker_b',name:'makerConfig',data:(await h.read(x.config))!.toString('base64')});}
  const live={accounts,returns,events:eventBytes};writeFileSync(`${dir}/maker-conformance.json`,serial(live));
  const legacy=JSON.parse(execFileSync(process.execPath,['tests/anchor-conformance/makers.cjs',`${dir}/maker-conformance.json`],{encoding:'utf8'}));
  const canonical=(x:unknown)=>{const v=JSON.parse(serial(x));delete v.discriminator;return v;};
  accounts.forEach((x,i)=>{const raw=Buffer.from(x.data,'base64');assert.deepEqual(legacy.accounts[i],canonical(x.program==='clearing'?sdk.getLegacyMakerRegistrationDecoder().decode(raw):sdk.makerA.getMakerConfigDecoder().decode(raw)));});
  returns.forEach((x,i)=>assert.deepEqual(legacy.returns[i],canonical(sdk.makerA.getQuoteResponseDecoder().decode(Buffer.from(x.data,'base64')))));
  eventBytes.forEach((x,i)=>assert.deepEqual(legacy.events[i].data,canonical(sdk.parseMakerChangedEvent(Buffer.from(x,'base64')))));
  const finalMarket=sdk.getMarketStateDecoder().decode((await h.read(a.market))!);
  assert.equal(finalMarket.sequence,starting+BigInt(events.length));
  const tokenBalance=await rpc.call('getTokenAccountBalance',[a.vault,{commitment:'finalized'}]);
  assert.equal(tokenBalance.value.amount,'1000010007');assert.equal(tokenBalance.value.decimals,6);
  assert.equal(finalMarket.allocatedVault,BigInt(tokenBalance.value.amount));
  const evidence={revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()!=='',
    runtime:await rpc.call('getVersion'),runId:dir,slotTimeMs:process.env.RIVALT_SLOT_TIME??'100',checks,events,result,finalMarket,tokenBalance,deployment,logsNotifications:ws.notifications.length,
    binaries:Object.fromEntries(['clearing','maker_a','maker_b'].map(n=>[n,createHash('sha256').update(readFileSync(`target/deploy/${n}.so`)).digest('hex')]))};
  writeFileSync(`${dir}/maker-rpc.json`,serial(evidence));writeFileSync(`${dir}/maker-failed-transactions.json`,serial(failed));
  console.log(`Maker Surfpool: ${checks.length} signed scenarios; ${events.length} committed clearing events; ${returns.length} independently decoded returns; actual upgrade rejection/reapproval passed.`);
}finally{ws.close();}
