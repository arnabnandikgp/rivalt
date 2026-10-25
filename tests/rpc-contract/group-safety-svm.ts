import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getAddressEncoder, getTransactionDecoder, lamports, type Instruction } from '@solana/kit';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import * as sdk from '@rivalt/sdk';
import { addresses, payerKey, type Harness } from './custody-cases.js';
import type { GroupTradingHarness } from './group-trading-cases.js';
import { groupSafetyCases } from './group-safety-cases.js';
import { groupDefaultCases } from './group-default-cases.js';
import { groupOrderCases } from './group-order-cases.js';
import { groupEmergencyCases } from './group-emergency-cases.js';
import { decodeGroupEvent,groupLiveParity } from './group-live-parity.js';
import { groupRouteNegatives } from './group-route-negatives.js';
import { ORACLE_FIXTURE } from './oracle-fixture.js';

const artifact = '.local/successor-p18c';
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const startedDirty=execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!=='';
const output = `.local/group-safety/${new Date().toISOString().replaceAll(/[-:.]/g,'')}-${process.pid}`;
mkdirSync(output,{recursive:true});
const svm = new LiteSVM().withSigverify(true).withBlockhashCheck(true);
const programs = [[sdk.CLEARING_PROGRAM_ADDRESS,'clearing'],[sdk.makerA.MAKER_A_PROGRAM_ADDRESS,'maker_a'],
  [sdk.makerB.MAKER_B_PROGRAM_ADDRESS,'maker_b'],[ORACLE_FIXTURE,'oracle_fixture']] as const;
for(const [program,name] of programs)svm.addProgramFromFile(program,`${artifact}/${name}.so`);
const payer=await payerKey(), deployment=await addresses();
svm.airdrop(payer.address,lamports(100_000_000_000n));
const programData=svm.getAccount(deployment.programData);assert(programData.exists);
const metadata=Uint8Array.from(programData.data);metadata[12]=1;metadata.set(getAddressEncoder().encode(payer.address),13);
svm.setAccount({...programData,data:metadata}); // Loader upgrade authority only; financial state is never provisioned by byte injection.
const initial=svm.getClock();initial.unixTimestamp=1_800_000_000n;initial.slot=100n;svm.setClock(initial);
const checks: {label:string;status:string;bytes:number;accounts:number;computeUnits:string;declaredComputeUnits:number;signatureHex:string}[]=[];
const eventBytes:string[]=[];
const json=(value:unknown)=>JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item,2)+'\n';
async function send(label:string,instructions:Instruction[],signers:Parameters<Harness['send']>[2]=[],expectedError?:number) {
  svm.expireBlockhash();
  const sampling=instructions.some(instruction=>instruction.programAddress===deployment.program
    && Buffer.from(instruction.data??[]).subarray(0,8).equals(Buffer.from(sdk.SAMPLE_GROUP_ORACLE_V2_DISCRIMINATOR)));
  const routing=instructions.some(instruction=>[sdk.EXECUTE_GROUP_ROUTE_V2_DISCRIMINATOR,sdk.EXECUTE_GROUP_ORDER_V2_DISCRIMINATOR]
    .some(discriminator=>Buffer.from(instruction.data??[]).subarray(0,8).equals(Buffer.from(discriminator))));
  const resolving=instructions.some(instruction=>Buffer.from(instruction.data??[]).subarray(0,8).equals(Buffer.from(sdk.ADVANCE_GROUP_RESOLUTION_V2_DISCRIMINATOR)));
  const declaredComputeUnits=sampling||resolving?1_200_000:routing?sdk.GROUP_ROUTE_COMPUTE_UNITS:400_000;
  const {transaction}=await sdk.signInstructions({async getLatestBlockhash(){return {blockhash:svm.latestBlockhash(),lastValidBlockHeight:1_000_000n};}},payer,
    [sampling||resolving?sdk.fundingComputeBudget():routing?sdk.groupRouteComputeBudget():sdk.routeComputeBudget(),...instructions],signers);
  const wire=transaction.serialize();assert(wire.length<=1232,`${label}: packet ${wire.length}`);
  const result=svm.sendTransaction(getTransactionDecoder().decode(wire));
  const meta=result instanceof FailedTransactionMetadata?result.meta():result;
  writeFileSync(`${output}/transaction-${checks.length}.json`,json({label,wire:Buffer.from(wire).toString('base64'),logs:meta.logs()}));
  if(expectedError===undefined){
    assert(!(result instanceof FailedTransactionMetadata),`${label}: ${meta.logs().join('\n')}`);
    assert(meta.computeUnitsConsumed()<=BigInt(declaredComputeUnits*0.8),`${label}: insufficient CU headroom: ${meta.computeUnitsConsumed()}`);
    for(const inner of meta.innerInstructions().flat()) {
      const instruction=inner.instruction();
      if(transaction.message.staticAccountKeys[instruction.programIdIndex()].toBase58()!==deployment.program)continue;
      const bytes=Buffer.from(instruction.data()).subarray(8);
      if(decodeGroupEvent(bytes))eventBytes.push(bytes.toString('base64'));
    }
  }else{
    assert(result instanceof FailedTransactionMetadata,`${label}: unexpectedly accepted`);
    assert(meta.logs().some(line=>expectedError===0?line.includes('already in use'):line.includes(`Error Number: ${expectedError}.`)),`${label}: expected ${expectedError}\n${meta.logs().join('\n')}`);
  }
  checks.push({label,status:expectedError===undefined?'pass':'rejected',bytes:wire.length,accounts:transaction.message.staticAccountKeys.length,
    computeUnits:meta.computeUnitsConsumed().toString(),declaredComputeUnits,signatureHex:Buffer.from(transaction.signatures[0]).toString('hex')});
  writeFileSync(`${output}/checks.json`,json(checks));
  if(checks.length%20===0)console.log(`P18C signed scenarios: ${checks.length}`);
  return meta;
}
const h:GroupTradingHarness={
  async rent(size){return svm.minimumBalanceForRentExemption(BigInt(size));},
  async read(key){const account=svm.getAccount(key);return account.exists?Buffer.from(account.data):null;},
  async send(...args){await send(...args);},
  async now(){return svm.getClock().unixTimestamp;},
  async slot(){return svm.getClock().slot;},
  async advance(seconds,slots=seconds*20n){const clock=svm.getClock();clock.unixTimestamp+=seconds;clock.slot+=slots;svm.setClock(clock);},
  async quote(label,instruction){return (await send(label,[instruction])).returnData().data();},
};
const captures:Record<string,Record<string,string|null>>={};
async function capture(label:string,keys:import('@solana/kit').Address[]) {
  captures[label]=Object.fromEntries(await Promise.all(keys.map(async key=>[key,(await h.read(key))?.toString('base64')??null])));
  writeFileSync(`${output}/captures.json`,json(captures));
}
const result=await groupSafetyCases(h,capture);
await groupRouteNegatives(h,result);
await groupOrderCases(h,result,capture);
const defaults=await groupDefaultCases(h,result,capture);
await groupEmergencyCases(h,result,defaults,capture);
const fixture=result.fixture;
const defaultInstruction=await result.cashInstruction(fixture.cross,1n,false);
svm.addProgramFromFile(sdk.CLEARING_PROGRAM_ADDRESS,`${artifact}/clearing-default.so`);
await result.reject('default build rejects activated successor cash',[defaultInstruction],[fixture.owner],sdk.CLEARING_ERROR__PROFILE);
svm.addProgramFromFile(sdk.CLEARING_PROGRAM_ADDRESS,`${artifact}/clearing.so`);
const parity=groupLiveParity(output,await Promise.all([
  ['groupExitGuardV2',fixture.guard],['groupResolutionV2',fixture.resolution],['marginAccountV2',fixture.roots[0]],
].map(async([name,key])=>({name,bytes:(await h.read(key as import('@solana/kit').Address))!.toString('base64')}))),eventBytes);
const finishedRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
writeFileSync(`${output}/summary.json`,json({revision,finishedRevision,
  trackedDirty:startedDirty||finishedRevision!==revision||execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!=='',checks,parity,
  hashes:Object.fromEntries(programs.map(([,name])=>[name,createHash('sha256').update(readFileSync(`${artifact}/${name}.so`)).digest('hex')])),
  defaultClearingSha256:createHash('sha256').update(readFileSync(`${artifact}/clearing-default.so`)).digest('hex'),
  keys:{group:fixture.group,registry:fixture.registry,vault:fixture.vault,markets:fixture.markets,roots:fixture.roots,
    guard:fixture.guard,resolution:fixture.resolution,tokens:fixture.operators.map(operator=>operator.token.address)},captures:Object.keys(captures)}));
console.log(`P18C development: ${checks.length} signed scenarios recorded in ${output}`);
const audit=execFileSync('python3',['tests/financial/group-safety-reference.py',output],{encoding:'utf8'});
writeFileSync(`${output}/independent-audit.json`,audit);console.log(audit.trim());
