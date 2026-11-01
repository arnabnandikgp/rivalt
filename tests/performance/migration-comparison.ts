/** Reconstruct complete economic states from authenticated original events.
 * Slot/digest differences stay explicit; this is not a pure runtime microbenchmark. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,symlinkSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {getProgramDerivedAddress} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {receiptMetrics} from './receipt-metrics.js';
import {candidateArtifacts,profileContracts,FROZEN_B_SOURCE,C0_SOURCE,sha256} from './profile-contracts.js';
import {financialEquivalence} from './financial-equivalence.js';
const [beforeDirectory,afterDirectory]=process.argv.slice(2).filter(value=>!value.startsWith('--'));
assert(beforeDirectory&&afterDirectory,'Usage: migration-comparison.ts <B focused run> <C0 focused run> [--write]');
assert(process.env.RIVALT_ARTIFACT_DIR,'Explicit C0 artifacts required');
const candidate=candidateArtifacts(process.env.RIVALT_ARTIFACT_DIR);
const summaries=[beforeDirectory,afterDirectory].map(directory=>JSON.parse(readFileSync(`${directory}/performance.json`,'utf8')));
const [before,after]=summaries;
assert.equal(before.build.revision,FROZEN_B_SOURCE);assert.equal(after.build.revision,C0_SOURCE);
assert.deepEqual(after.build.binaries,candidate.build.binaries);
for(const summary of summaries){assert.equal(summary.trackedDirty,false);assert.equal(summary.build.trackedDirty,false);assert.equal(summary.build.instrumented,undefined);}
assert.equal(before.instrumented,false);
// a01da5d accidentally labelled checkpoint p47-c0 as instrumented in the wrapper.
// Its immutable binary manifest/bytes identify the same uninstrumented C0 build.
const flagCorrection=after.instrumented===true;
if(flagCorrection)assert.equal(after.revision,'a01da5d5c62cd19509e8e087bcf4cfc3bace2d06','No blanket instrumentation exception');
else assert.equal(after.instrumented,false);
assert.deepEqual(after.runtime,before.runtime);
assert.deepEqual({...before.workload,schema:8},after.workload);
assert.deepEqual(before.independentFinancialCheck,after.independentFinancialCheck);
assert.equal(before.checks.length,after.checks.length);
const contracts=[profileContracts(FROZEN_B_SOURCE),profileContracts(C0_SOURCE)];
for(const [side,summary] of summaries.entries())assert.deepEqual(summary.idlHashes,contracts[side].idls);
const receipts=[beforeDirectory,afterDirectory].map(directory=>summaries[0].checks.map((_:unknown,index:number)=>
  JSON.parse(readFileSync(`${directory}/transaction-${index}.json`,'utf8'))));
const metrics=[beforeDirectory,afterDirectory].map((directory,side)=>receipts[side].map((receipt:any,index:number)=>{
  const saved=JSON.parse(readFileSync(`${directory}/wire-${index}.json`,'utf8')),check=summaries[side].checks[index];
  const measured=receiptMetrics(receipt,Buffer.from(saved.wireBase64,'base64'),contracts[side].contracts);
  assert.equal(measured.signature,check.signature);assert.equal(saved.label,check.label);assert.equal(check.ws,true);
  assert.equal(measured.computeUnits,check.computeUnits);return measured;
}));
const roles=new Map<string,string>(),reverse=new Map<string,string>();
function bind(left:string,right:string){assert(!roles.has(left)||roles.get(left)===right,'Role identity changed');
  assert(!reverse.has(right)||reverse.get(right)===left,'Alias changed');roles.set(left,right);reverse.set(right,left);}
for(let index=0;index<before.checks.length;index++){
  assert.equal(before.checks[index].label,after.checks[index].label);
  const old=receipts[0][index].transaction.message,current=receipts[1][index].transaction.message;
  assert.equal(old.instructions.length,current.instructions.length);
  for(const [instructionIndex,left] of old.instructions.entries()){
    const right=current.instructions[instructionIndex];
    assert.equal(old.accountKeys[left.programIdIndex],current.accountKeys[right.programIdIndex]);
    assert.equal(left.accounts.length,right.accounts.length);
    left.accounts.forEach((keyIndex:number,position:number)=>bind(old.accountKeys[keyIndex],current.accountKeys[right.accounts[position]]));
  }
  bind(old.accountKeys[0],current.accountKeys[0]);
}
// Immutable predecessor reader, isolated from the current schema-8 parser.
const oldRoot=resolve('.local/anchor-rc2/p47-b-reader');
for(const name of ['account-events','events','scoped-events','scoped-history','scoped-projection','account-projection','liquidity-projection','canonical','rpc']){
  const relative=`packages/indexer/src/${name}.ts`,target=`${oldRoot}/${relative}`;mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target,execFileSync('git',['show',`${FROZEN_B_SOURCE}:${relative}`]));
}
const idlPath=`${oldRoot}/packages/sdk/idl/clearing.json`;mkdirSync(dirname(idlPath),{recursive:true});
writeFileSync(idlPath,execFileSync('git',['show',`${FROZEN_B_SOURCE}:packages/sdk/idl/clearing.json`]));
const modules=`${oldRoot}/packages/indexer/node_modules`;if(!existsSync(modules))symlinkSync(resolve('packages/indexer/node_modules'),modules,'dir');
const [eventAuthority]=await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,seeds:[Buffer.from('__event_authority')]});
const states:{binding:any;samples:{label:string;before:any;after:any}[]}[]=[];
for(const [side,prefix] of [oldRoot+'/packages/indexer/src',resolve('packages/indexer/src')].entries()){
  const load=(name:string)=>import(pathToFileURL(`${prefix}/${name}.ts`).href);
  const {eventPayloads}=await load('events'),{decodeAccountInvocations,eventDomain}=await load('account-events');
  const {emptyLiquidity}=await load('liquidity-projection'),{projectScopedBatch}=await load('scoped-projection');
  let state=emptyLiquidity(),binding:any;const samples=[];
  for(const [index,receipt] of receipts[side].entries()){
    const check=summaries[side].checks[index];if(receipt.meta.err)continue;
    if(!binding){
      const event=eventPayloads(check.signature,receipt,eventAuthority).find(({payload}:any)=>
        payload.subarray(0,8).equals(Buffer.from(sdk.ACCOUNT_CUSTODY_CHANGED_EVENT_DISCRIMINATOR)));
      if(!event)continue;
      const decoded=sdk.getAccountCustodyChangedEventDecoder().decode(event.payload);
      binding={program:sdk.CLEARING_PROGRAM_ADDRESS,eventAuthority,venue:decoded.venue,
        domain:eventDomain(check.signature,receipt,eventAuthority,decoded.venue)};
    }
    const invocations=decodeAccountInvocations(check.signature,receipt,index,binding),previous=structuredClone(state);
    state=projectScopedBatch(state,invocations,binding).state;
    if(check.label.startsWith('CU '))samples.push({label:check.label,before:previous,after:structuredClone(state)});
  }
  states.push({binding,samples});
}
bind(states[0].binding.domain,states[1].binding.domain);
const origins=states.map(value=>BigInt((Object.values(value.samples[0].before.markets)[0] as any).oracle.validSince));
const comparisons=states[0].samples.map((left,index)=>{
  const right=states[1].samples[index];assert.equal(left.label,right.label);
  return {label:left.label,before:financialEquivalence(left.before,right.before,roles,origins[1]-origins[0]),
    after:financialEquivalence(left.after,right.after,roles,origins[1]-origins[0])};
});
const mapped=(keys:string[])=>keys.map(key=>roles.get(key)??key).sort();
const cases=before.checks.flatMap((check:any,index:number)=>{
  if(!check.label.startsWith('CU '))return [];
  const left=metrics[0][index],right=metrics[1][index];
  for(const field of ['version','wireBytes','signatures','loadedAccounts','requestedCu','feeLamports','priorityLamports','outcome'] as const)
    assert.equal(left[field],right[field],`${check.label}: ${field}`);
  for(const access of ['read','write'] as const)assert.deepEqual(mapped(left.locks[access]),[...right.locks[access]].sort(),'Signed access changed');
  return [{label:check.label,receipt:`transaction-${index}.json`,outcome:right.outcome,
    beforeCu:left.computeUnits,afterCu:right.computeUnits,savedCu:left.computeUnits-right.computeUnits,
    requestedCu:right.requestedCu,feeLamports:right.feeLamports,priorityLamports:right.priorityLamports,
    wireBytes:right.wireBytes,version:right.version,signatures:right.signatures,keys:right.loadedAccounts,writes:right.locks.write.length}];
});
const witnesses=comparisons.flatMap(sample=>[...sample.before.witnesses,...sample.after.witnesses]);
const result={schema:1,scope:'paired workload observations; disclosed slot/digest differences prevent exact input or pure-framework attribution',
  sbfSources:[FROZEN_B_SOURCE,C0_SOURCE],verifiers:summaries.map(value=>value.revision),runtime:after.runtime,
  sourceSummaries:[beforeDirectory,afterDirectory].map(directory=>({directory,sha256:sha256(readFileSync(`${directory}/performance.json`))})),
  harnessInstrumentationFlagCorrection:flagCorrection,roleBijectionSize:roles.size,unixOriginOffset:(origins[1]-origins[0]).toString(),
  stateComparison:{successfulCases:comparisons.length,comparedStates:comparisons.length*2,
    exactFinancialAndRelativeUnixFields:true,fullInputMatch:witnesses.length===0,
    comparedLeaves:comparisons.reduce((total,value)=>total+value.before.comparedLeaves+value.after.comparedLeaves,0),
    slotWitnesses:witnesses.filter(value=>value.kind==='slot').length,digestWitnesses:witnesses.filter(value=>value.kind==='digest').length},
  cases,limitations:['One observation per named state; no statistical gain or worst-case guarantee',
    'Absolute Unix origin is translated uniformly; nonidentical slot inputs and deployment-dependent digests are retained in local witnesses',
    'All reconstructed roots, market/ledger balances, funding checkpoints, unpaid claims, orders, carries and revisions match',
    'Binary/ABI/serialization/CPI adaptation are combined; code-hash savings are included, no C1 zero-copy conversion',
    'Requested resources, zero priority bids and actual fees are unchanged; smaller consumed CU does not itself lower paid fees']};
writeFileSync('.local/anchor-rc2/migration-comparison-details.json',JSON.stringify({roles:[...roles],states,comparisons},null,2)+'\n');
const output=JSON.stringify(result,null,1)+'\n',target='tests/performance/baselines/p47-comparison.json';assert(Buffer.byteLength(output)<64*1024);
if(process.argv.includes('--write'))writeFileSync(target,output);
else assert.equal(readFileSync(target,'utf8'),output,'Recorded paired comparison must reproduce');
console.log(JSON.stringify({cases:cases.length,...result.stateComparison}));
