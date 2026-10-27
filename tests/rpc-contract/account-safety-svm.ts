import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getAddressEncoder, getTransactionDecoder, lamports, type Instruction } from '@solana/kit';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import * as sdk from '@rivalt/sdk';
import { addresses, payerKey, type Harness } from './custody-cases.js';
import { type AccountTradingHarness } from './account-trading-setup.js';
import { accountSafetyCases } from './account-safety-cases.js';
import { ORACLE_FIXTURE } from './oracle-fixture.js';

const artifact = '.local/account-safety';
const output = `.local/account-safety-runs/${new Date().toISOString().replaceAll(/[-:.]/g,'')}-${process.pid}`;
mkdirSync(output,{recursive:true});
const svm = new LiteSVM().withSigverify(true).withBlockhashCheck(true);
const programs = [[sdk.CLEARING_PROGRAM_ADDRESS,'clearing'],[sdk.makerA.MAKER_A_PROGRAM_ADDRESS,'maker_a'],
  [sdk.makerB.MAKER_B_PROGRAM_ADDRESS,'maker_b'],[ORACLE_FIXTURE,'oracle_fixture']] as const;
for(const [program,name] of programs)svm.addProgramFromFile(program,`${name==='clearing'?artifact:'.local/account-cash'}/${name}.so`);
const payer=await payerKey(), deployment=await addresses();
svm.airdrop(payer.address,lamports(100_000_000_000n));
const programData=svm.getAccount(deployment.programData);assert(programData.exists);
const metadata=Uint8Array.from(programData.data);metadata[12]=1;metadata.set(getAddressEncoder().encode(payer.address),13);
svm.setAccount({...programData,data:metadata}); // Loader upgrade authority only; financial state is never provisioned by byte injection.
const initial=svm.getClock();initial.unixTimestamp=1_800_000_000n;initial.slot=100n;svm.setClock(initial);
const checks: {label:string;status:string;bytes:number;accounts:number;computeUnits:string;declaredComputeUnits:number;signatureHex:string}[]=[];
const json=(value:unknown)=>JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item,2)+'\n';
const safetyTags=[sdk.INITIALIZE_ACCOUNT_RESOLUTION_V3_DISCRIMINATOR,sdk.INITIALIZE_ACCOUNT_RESOLUTION_PAGE_V3_DISCRIMINATOR,
  sdk.FREEZE_ACCOUNTS_V3_DISCRIMINATOR,sdk.VALUE_ACCOUNT_RESOLUTION_V3_DISCRIMINATOR,
  sdk.ADVANCE_ACCOUNT_RESOLUTION_V3_DISCRIMINATOR,sdk.PROPOSE_ACCOUNT_RESOLUTION_V3_DISCRIMINATOR,
  sdk.ORDER_ACCOUNT_RESOLUTION_V3_DISCRIMINATOR,sdk.CHECK_ACCOUNT_RESOLUTION_ORDER_V3_DISCRIMINATOR,sdk.ROUND_ACCOUNT_RESOLUTION_V3_DISCRIMINATOR,
  sdk.RECOVER_ACCOUNTS_V3_DISCRIMINATOR,sdk.REACTIVATE_ACCOUNTS_V3_DISCRIMINATOR,
  sdk.CHECK_ACCOUNT_RETIREMENT_V3_DISCRIMINATOR,sdk.RETIRE_ACCOUNTS_V3_DISCRIMINATOR];
async function send(label:string,instructions:Instruction[],signers:Parameters<Harness['send']>[2]=[],expectedError?:number) {
  svm.expireBlockhash();
  const sampling=instructions.some(instruction=>instruction.programAddress===deployment.program
    && Buffer.from(instruction.data??[]).subarray(0,8).equals(Buffer.from(sdk.SAMPLE_ACCOUNT_ORACLE_V3_DISCRIMINATOR)));
  const trading=instructions.some(instruction=>instruction.programAddress===deployment.program
    && [sdk.EXECUTE_ACCOUNT_ROUTE_V3_DISCRIMINATOR,sdk.EXECUTE_ACCOUNT_ORDER_V3_DISCRIMINATOR]
      .some(tag=>Buffer.from(instruction.data??[]).subarray(0,8).equals(Buffer.from(tag))));
  const resolution=safetyTags.some(tag=>instructions.some(instruction=>instruction.programAddress===deployment.program
    && Buffer.from(instruction.data??[]).subarray(0,8).equals(Buffer.from(tag))));
  const declaredComputeUnits=sampling||resolution?1_200_000:trading?600_000:400_000;
  const {transaction}=await sdk.signInstructions({async getLatestBlockhash(){return {blockhash:svm.latestBlockhash(),lastValidBlockHeight:1_000_000n};}},payer,
    [(sampling||resolution)?sdk.fundingComputeBudget():trading?sdk.groupRouteComputeBudget():sdk.routeComputeBudget(),...instructions],signers);
  const wire=transaction.serialize();assert(wire.length<=1232,`${label}: packet ${wire.length}`);
  const result=svm.sendTransaction(getTransactionDecoder().decode(wire));
  const meta=result instanceof FailedTransactionMetadata?result.meta():result;
  writeFileSync(`${output}/transaction-${checks.length}.json`,json({label,wire:Buffer.from(wire).toString('base64'),logs:meta.logs()}));
  if(expectedError===undefined){
    assert(!(result instanceof FailedTransactionMetadata),`${label}: ${meta.logs().join('\n')}`);
    assert(meta.computeUnitsConsumed()<=BigInt(declaredComputeUnits*0.8),`${label}: insufficient CU headroom: ${meta.computeUnitsConsumed()}`);
  }else{
    assert(result instanceof FailedTransactionMetadata,`${label}: unexpectedly accepted`);
    assert(meta.logs().some(line=>expectedError===0?line.includes('already in use'):line.includes(`Error Number: ${expectedError}.`)),`${label}: expected ${expectedError}\n${meta.logs().join('\n')}`);
  }
  checks.push({label,status:expectedError===undefined?'pass':'rejected',bytes:wire.length,accounts:transaction.message.staticAccountKeys.length,
    computeUnits:meta.computeUnitsConsumed().toString(),declaredComputeUnits,signatureHex:Buffer.from(transaction.signatures[0]).toString('hex')});
  writeFileSync(`${output}/checks.json`,json(checks));
  if(checks.length%20===0)console.log(`P26 signed scenarios: ${checks.length}`);
  return meta;
}
const h:AccountTradingHarness={
  async rent(size){return svm.minimumBalanceForRentExemption(BigInt(size));},
  async read(key){const account=svm.getAccount(key);return account.exists?Buffer.from(account.data):null;},
  async send(...args){await send(...args);},
  async now(){return svm.getClock().unixTimestamp;},
  async slot(){return svm.getClock().slot;},
  async advance(seconds,slots=seconds*20n){const clock=svm.getClock();clock.unixTimestamp+=seconds;clock.slot+=slots;svm.setClock(clock);},
  async quote(label,instruction){return (await send(label,[instruction])).returnData().data();},
};
const result=await accountSafetyCases(h,{maximumCohort:process.env.RIVALT_SAFETY_MAXIMUM_COHORT==='1',
  retireResolved:process.env.RIVALT_SAFETY_RETIRE_RESOLVED==='1'});
writeFileSync(`${output}/summary.json`,json({revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  trackedDirty:execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!=='',
  runtime:'LiteSVM 1.6.1',signatureVerification:true,blockhashVerification:true,checks,
  binaries:Object.fromEntries(programs.map(([,name])=>[name,createHash('sha256').update(readFileSync(`${name==='clearing'?artifact:'.local/account-cash'}/${name}.so`)).digest('hex')])),
  scope:"preliminary default/recovery/retirement runtime; maximum-width arithmetic/full acceptance unfinished",...result}));
console.log(`P26 trading: ${checks.length} signed outcomes. Evidence: ${output}`);
