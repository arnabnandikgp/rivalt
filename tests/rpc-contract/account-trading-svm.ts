import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getAddressEncoder, getTransactionDecoder, lamports, type Instruction } from '@solana/kit';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import * as sdk from '@rivalt/sdk';
import { addresses, payerKey, type Harness } from './custody-cases.js';
import { type AccountTradingHarness } from './account-trading-setup.js';
import { accountTradingCases } from './account-trading-cases.js';
import { ORACLE_FIXTURE } from './oracle-fixture.js';

const artifact = '.local/account-trading';
const output = `.local/account-trading-runs/${new Date().toISOString().replaceAll(/[-:.]/g,'')}-${process.pid}`;
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
const json=(value:unknown)=>JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item,2)+'\n';
async function send(label:string,instructions:Instruction[],signers:Parameters<Harness['send']>[2]=[],expectedError?:number) {
  svm.expireBlockhash();
  const sampling=instructions.some(instruction=>instruction.programAddress===deployment.program
    && Buffer.from(instruction.data??[]).subarray(0,8).equals(Buffer.from(sdk.SAMPLE_ACCOUNT_ORACLE_V3_DISCRIMINATOR)));
  const trading=instructions.some(instruction=>instruction.programAddress===deployment.program
    && [sdk.EXECUTE_ACCOUNT_ROUTE_V3_DISCRIMINATOR,sdk.EXECUTE_ACCOUNT_ORDER_V3_DISCRIMINATOR]
      .some(tag=>Buffer.from(instruction.data??[]).subarray(0,8).equals(Buffer.from(tag))));
  const declaredComputeUnits=sampling?1_200_000:trading?600_000:400_000;
  const {transaction}=await sdk.signInstructions({async getLatestBlockhash(){return {blockhash:svm.latestBlockhash(),lastValidBlockHeight:1_000_000n};}},payer,
    [sampling?sdk.fundingComputeBudget():trading?sdk.groupRouteComputeBudget():sdk.routeComputeBudget(),...instructions],signers);
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
  if(checks.length%20===0)console.log(`P24 signed scenarios: ${checks.length}`);
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
const result=await accountTradingCases(h);
// Change executable code only to prove admission and compile-time gates. No
// financial account bytes are fabricated for these rejection checks.
for(const maker of result.makers[0]) {
  const name=maker.makerId===0?'maker_a':'maker_b';
  svm.addProgramFromFile(maker.pricingProgram,`${artifact}/${name}-default.so`);
  const registration=sdk.getMakerRegistrationV3Decoder().decode((await h.read(maker.registration))!);
  const market=await result.marketState(0);
  await result.reject('unapproved maker code change rejects authenticated quote',[sdk.getPreviewAccountMakerV3Instruction({...maker,
    args:{side:0,lots:1n,referencePrice:market.referencePrice,quoteEpoch:registration.quoteEpoch,
      authorityEpoch:registration.authorityEpoch,termsEpoch:market.termsEpoch,configEpoch:market.configEpoch}})],[],6114);
  await result.reject('default maker rejects schema-3 quote',[maker.api.getQuoteAccountInstruction({config:maker.config,venue:result.venue,
    quote:{version:3,domain:result.domain,market:maker.market,capital:maker.capital,quoteEpoch:registration.quoteEpoch,
      authorityEpoch:registration.authorityEpoch,termsEpoch:market.termsEpoch,marketConfigEpoch:market.configEpoch,
      side:0,lots:1n,inventory:0n,cash:500_000_000n,inventoryLimit:100_000n,consumed:0n,
      referencePrice:market.referencePrice,slot:await h.slot()}})],[],6001);
  svm.addProgramFromFile(maker.pricingProgram,`${artifact}/${name}.so`);
}
svm.addProgramFromFile(deployment.program,`${artifact}/clearing-default.so`);
await result.reject('default clearing rejects schema-3 source sampling',[sdk.getSampleAccountOracleV3Instruction(result.sampleAccounts(0))],[],6108);
for(const trader of [result.cross,result.operators[0].capital[0]])
  await result.reject('default clearing rejects active isolated or cross trade',[await result.route(0,trader)],[result.owner],6108);
await result.reject('default clearing rejects candidate qualification',[sdk.getQualifyAccountTradingV3Instruction({
  ...result.common,authority:payer,btc:result.markets[0],eth:result.markets[1]})],[],6108);
writeFileSync(`${output}/summary.json`,json({revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  trackedDirty:execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!=='',
  runtime:'LiteSVM 1.6.1',signatureVerification:true,blockhashVerification:true,checks,
  binaries:Object.fromEntries(programs.map(([,name])=>[name,createHash('sha256').update(readFileSync(`${artifact}/${name}.so`)).digest('hex')])),
  venue:result.venue,markets:result.markets,roots:result.roots,ledgers:result.ledgers,custody:result.custody,vault:result.vault,financialSteps:result.financialSteps,rawAccounts:result.rawAccounts}));
console.log(`P24 trading: ${checks.length} signed outcomes. Evidence: ${output}`);
