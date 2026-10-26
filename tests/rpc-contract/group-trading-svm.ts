import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getAddressEncoder, getTransactionDecoder, lamports, type Instruction } from '@solana/kit';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import * as sdk from '@rivalt/sdk';
import { addresses, payerKey, type Harness } from './custody-cases.js';
import { groupTradingCases, type GroupTradingHarness } from './group-trading-cases.js';
import { ORACLE_FIXTURE } from './oracle-fixture.js';

const artifact = '.local/successor-p18b';
const output = `.local/group-trading/${new Date().toISOString().replaceAll(/[-:.]/g,'')}-${process.pid}`;
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
    && Buffer.from(instruction.data??[]).subarray(0,8).equals(Buffer.from(sdk.SAMPLE_GROUP_ORACLE_V2_DISCRIMINATOR)));
  const declaredComputeUnits=sampling?1_200_000:400_000;
  const {transaction}=await sdk.signInstructions({async getLatestBlockhash(){return {blockhash:svm.latestBlockhash(),lastValidBlockHeight:1_000_000n};}},payer,
    [sampling?sdk.fundingComputeBudget():sdk.routeComputeBudget(),...instructions],signers);
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
  if(checks.length%20===0)console.log(`P18B signed scenarios: ${checks.length}`);
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
const result=await groupTradingCases(h);
const maker=result.makers[0][0];
const routeAccounts={...result.common,actor:result.operators[0].owner,market:result.markets[0],trader:result.operators[0].capital[0],
  firstCapital:maker.capital,firstRegistration:maker.registration,firstProgram:maker.pricingProgram,firstProgramData:maker.programData,firstConfig:maker.config};
const market=sdk.getGroupMarketV2Decoder().decode((await h.read(result.markets[0]))!);
const registration=sdk.getMakerRegistrationV2Decoder().decode((await h.read(maker.registration))!);
const intent:sdk.RouteIntentArgs={domain:result.finalGroup.domain,termsEpoch:market.termsEpoch,configEpoch:market.configEpoch,
  observationSequence:market.observationSequence,nonce:0n,startSlot:await h.slot(),expirySlot:(await h.slot())+100n,
  side:0,lots:1n,allInLimit:70_000n,maxFee:20n,reduceOnly:false,generation:null,
  legs:[{lots:1n,quoteEpoch:registration.quoteEpoch,authorityEpoch:registration.authorityEpoch}]};
// No activation instruction exists. Corruption is used only to prove the compile-time
// gate remains closed even if a group mode byte were changed. Restore the exact bytes.
const originalGroup=svm.getAccount(result.group);assert(originalGroup.exists);
for(const mode of [0,1]){
  if(mode===1)svm.setAccount({...originalGroup,data:sdk.getClearingGroupV2Encoder().encode({...result.finalGroup,mode})});
  for(const trader of [result.operators[0].capital[0],result.cross]){
    const before=await h.read(trader);
    await h.send('compiled gate rejects isolated and cross route',[sdk.getExecuteGroupRouteV2Instruction({...routeAccounts,trader,intent})],[result.operators[0].owner],6108);
    await h.send('compiled gate rejects stored authority',[sdk.getManageGroupOrderV2Instruction({...result.common,owner:result.operators[0].owner,
      market:result.markets[0],margin:trader,operation:{__kind:'Place',expectedId:1n,terms:{side:0,lots:1n,limit:60_000n,feeBudget:20n,
        startSlot:await h.slot(),expirySlot:(await h.slot())+100n,trigger:0,threshold:0n,reduceOnly:false,generation:0n}}})],[result.operators[0].owner],6108);
    assert.deepEqual(await h.read(trader),before);
  }
  svm.setAccount(originalGroup);
}
for(const maker of result.makers[0]){
  const name=maker.makerId===0?'maker_a':'maker_b';
  svm.addProgramFromFile(maker.pricingProgram,`${artifact}/${name}-default.so`);
  const state=sdk.getMakerRegistrationV2Decoder().decode((await h.read(maker.registration))!);
  await h.send('unapproved changed maker code rejects clearing quote',[sdk.getPreviewGroupMakerV2Instruction({...maker,
    args:{side:0,lots:1n,referencePrice:60_000n,quoteEpoch:state.quoteEpoch,authorityEpoch:state.authorityEpoch,
      termsEpoch:market.termsEpoch,configEpoch:market.configEpoch}})],[],6114);
  await h.send('default maker rejects successor quote',[maker.api.getQuoteGroupInstruction({config:maker.config,group:result.group,
    quote:{version:2,domain:result.finalGroup.domain,market:maker.market,capital:maker.capital,quoteEpoch:state.quoteEpoch,
      authorityEpoch:state.authorityEpoch,termsEpoch:market.termsEpoch,marketConfigEpoch:market.configEpoch,side:0,lots:1n,
      inventory:0n,cash:500_000_000n,inventoryLimit:100_000n,consumed:0n,referencePrice:60_000n,slot:await h.slot()}})],[],6001);
  svm.addProgramFromFile(maker.pricingProgram,`${artifact}/${name}.so`);
}
svm.addProgramFromFile(deployment.program,`${artifact}/clearing-default.so`);
await h.send('default clearing rejects successor source sampling',[sdk.getSampleGroupOracleV2Instruction(result.sampleAccounts(0))],[],6108);
const rawAccounts=Object.fromEntries(await Promise.all([result.group,result.registry,result.vault,...result.markets,...result.roots,
  ...result.feeds.map(source=>source.feed),...result.makers.flat().flatMap(maker=>[maker.registration,maker.config,maker.groupBinding])].map(async key=>[key,(await h.read(key))!.toString('base64')])));
const parityEntries = [
  {program:'clearing',name:'clearingGroupV2',key:result.group,decoded:sdk.getClearingGroupV2Decoder().decode((await h.read(result.group))!)},
  ...await Promise.all(result.markets.map(async key=>({program:'clearing',name:'groupMarketV2',key,decoded:sdk.getGroupMarketV2Decoder().decode((await h.read(key))!)}))),
  ...await Promise.all(result.roots.map(async key=>({program:'clearing',name:'marginAccountV2',key,decoded:sdk.getMarginAccountV2Decoder().decode((await h.read(key))!)}))),
  ...await Promise.all(result.makers.flat().flatMap(maker=>[
    (async()=>({program:'clearing',name:'makerRegistrationV2',key:maker.registration,decoded:sdk.getMakerRegistrationV2Decoder().decode((await h.read(maker.registration))!)}))(),
    (async()=>({program:'clearing',name:'capitalBindingV2',key:maker.groupBinding,decoded:sdk.getCapitalBindingV2Decoder().decode((await h.read(maker.groupBinding))!)}))(),
    (async()=>({program:maker.makerId===0?'maker_a':'maker_b',name:'makerGroupConfig',key:maker.config,decoded:maker.api.getMakerGroupConfigDecoder().decode((await h.read(maker.config))!)}))(),
  ])),
];
const legacyInput=`${output}/legacy-input.json`;
writeFileSync(legacyInput,json({accounts:parityEntries.map(entry=>({program:entry.program,name:entry.name,bytes:rawAccounts[entry.key]}))}));
const legacy=JSON.parse(execFileSync(process.execPath,['tests/anchor-conformance/group-trading.cjs',legacyInput],{encoding:'utf8'}));
function normalize(value:unknown):unknown {
  if(typeof value==='bigint')return value.toString();
  if(value instanceof Uint8Array)return [...value];
  if(Array.isArray(value))return value.map(normalize);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([name])=>name!=='discriminator').map(([name,item])=>[name,normalize(item)]));
  return value;
}
for(const [index,entry] of parityEntries.entries())assert.deepEqual(normalize(entry.decoded),normalize(legacy.accounts[index]),`${entry.program}:${entry.name}`);
writeFileSync(`${output}/legacy-account-parity.json`,json({count:parityEntries.length,keys:parityEntries.map(entry=>entry.key)}));
writeFileSync(`${output}/summary.json`,json({revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  trackedDirty:execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!=='',
  runtime:'LiteSVM 1.6.1',legacyAccountCount:parityEntries.length,signatureVerification:true,blockhashVerification:true,checks,
  binaries:Object.fromEntries(programs.map(([,name])=>[name,createHash('sha256').update(readFileSync(`${artifact}/${name}.so`)).digest('hex')])),
  rawAccounts,group:result.group,markets:result.markets,roots:result.roots,finalGroup:result.finalGroup,finalMarkets:result.finalMarkets,
  makerCapital:result.makers.flat().map(maker=>maker.capital),financialActivation:false}));
execFileSync('python3',['tests/financial/group-trading-reference.py',`${output}/summary.json`],{stdio:'inherit'});
console.log(`P18B: ${checks.length} signed scenarios, four separate funded makers, six signed sources, both trading gates rejected. Evidence: ${output}`);
