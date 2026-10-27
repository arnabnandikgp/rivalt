import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {AccountRole,getAddressEncoder,type Address,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {accountPda} from './account-custody-cases.js';
import {accountTradingSetup,type AccountTradingHarness} from './account-trading-setup.js';

// Incremental P26 runtime gate. All financial state comes from signed deposits,
// trades and authenticated price updates. Full terminal acceptance extends this.
export async function accountSafetyCases(h:AccountTradingHarness) {
  const setup=await accountTradingSetup(h,{qualifyPrimitives:false,domainLabel:'rivalt/p26/account-safety'});
  const {payer,owner,markets,ledgers,cross,makers,feeds,roots}=setup;
  const common={...setup.common,btc:markets[0],eth:markets[1]};
  const encoded=getAddressEncoder().encode(common.venue);
  const resolution=await accountPda('resolution-v3',encoded),work=await accountPda('resolution-work-v3',encoded);
  const pages=await Promise.all(Array.from({length:32},(_,index)=>{
    const bytes=Buffer.alloc(2);bytes.writeUInt16LE(index);return accountPda('resolution-page-v3',encoded,bytes);
  }));
  const accounts={...common,resolution,work};
  const header=async()=>sdk.getResolutionV3Decoder().decode((await h.read(resolution))!);
  const root=async(key:Address)=>sdk.getMarginAccountV3Decoder().decode((await h.read(key))!);
  const safety=async()=>sdk.getSafetyV3Decoder().decode((await h.read(common.safety))!);
  const guard=async(key:Address)=>{const value=await root(key);return {safetyEpoch:(await safety()).epoch,
    venueTermsEpoch:1n,nonce:value.nonce,stateVersion:value.stateVersion};};
  const raw=async()=>Object.fromEntries(await Promise.all([common.venue,common.custody,common.safety,common.vault,
    common.registry,...roots,...markets,...ledgers,resolution,work,...pages].map(async key=>[key,(await h.read(key))?.toString('base64')??null])));
  async function reject(label:string,instruction:Instruction,error=6130,signers:typeof owner[]=[]) {
    const before=await raw();await h.send(label,[instruction],signers,error);assert.deepEqual(await raw(),before,`${label}: rollback`);
  }
  await h.send('precreate bounded header and continuation work',[sdk.getInitializeAccountResolutionV3Instruction({...accounts,payer})]);
  assert.equal((await h.read(resolution))!.length,3644);assert.equal((await h.read(work))!.length,7918);
  await reject('cannot skip a precreated page',sdk.getInitializeAccountResolutionPageV3Instruction({...accounts,payer,page:pages[1],pageIndex:1}));
  for(let pageIndex=0;pageIndex<32;pageIndex++) {
    await h.send('precreate canonical two-row page',[sdk.getInitializeAccountResolutionPageV3Instruction({...accounts,payer,page:pages[pageIndex],pageIndex})]);
    assert.equal((await h.read(pages[pageIndex]))!.length,3400);
  }
  const sources={primaryBtc:feeds[0].feed,primaryCollateral:feeds[1].feed,guardBtc:feeds[2].feed,
    guardCollateral:feeds[3].feed,primaryEth:feeds[4].feed,guardEth:feeds[5].feed};
  const freeze=async()=>sdk.getFreezeAccountsV3Instruction({...accounts,...sources,caller:payer,target:cross,
    safetyEpoch:(await safety()).epoch,resolutionEpoch:(await header()).epoch,emergency:false});
  await h.send('activate explicit P26 candidate profile',[sdk.getQualifyAccountTradingV3Instruction({...common,authority:payer})]);
  await reject('healthy funded account cannot trigger default',await freeze());
  await h.send('fund actual future debtor',[sdk.getDepositAccountV3Instruction({...common,owner,margin:cross,
    quoteMint:setup.mint.address,userToken:setup.operators[0].token.address,amount:400_000n})],[owner]);
  for(let round=0;round<4;round++) {
    await h.advance(2n);
    for(let index=0;index<6;index++)await setup.publish(index);
    for(const index of [0,1])await h.send('post-activation source recovery',[sdk.getSampleAccountOracleV3Instruction(setup.sampleAccounts(index))]);
  }
  const maker=makers[0][0],second=makers[0][1],market=await setup.marketState(0);
  const secondRegistration=sdk.getMakerRegistrationV3Decoder().decode((await h.read(second.registration))!);
  const registration=sdk.getMakerRegistrationV3Decoder().decode((await h.read(maker.registration))!);
  const slot=await h.slot();
  await h.send('open actual pre-default BTC exposure',[sdk.getExecuteAccountRouteV3Instruction({...common,
    actor:owner,market:markets[0],otherMarket:markets[1],ledger:ledgers[0],otherLedger:ledgers[1],trader:cross,
    firstCapital:maker.capital,firstRegistration:maker.registration,firstProgram:maker.pricingProgram,
    firstProgramData:maker.programData,firstConfig:maker.config,secondCapital:second.capital,secondRegistration:second.registration,
    secondProgram:second.pricingProgram,secondProgramData:second.programData,secondConfig:second.config,
    guard:await guard(cross),domain:setup.domain,termsEpoch:market.termsEpoch,configEpoch:market.configEpoch,
    startSlot:slot,expirySlot:slot+100n,side:0,lots:50n,allInLimit:3_300_000n,maxFee:1000n,
    reduceOnly:false,generation:null,legs:[{lots:25n,quoteEpoch:registration.quoteEpoch,
      authorityEpoch:registration.authorityEpoch,expectedConsumed:registration.buyConsumed},
      {lots:25n,quoteEpoch:secondRegistration.quoteEpoch,authorityEpoch:secondRegistration.authorityEpoch,expectedConsumed:secondRegistration.buyConsumed}]})],[owner]);
  await h.advance(2n);
  for(let index=0;index<6;index++)await setup.publish(index,{price:index===0||index===2?40_000_000_000n:
    index===1||index===3?1_000_000n:3_000_000_000n});
  // Freeze authenticates current oracle accounts directly; it does not wait for
  // a discretionary maker/funding sample to acknowledge actual insolvency.
  await h.send('freeze actual bankrupt account and complete registry',[await freeze()]);
  const initial=await header();assert.equal(initial.stage,2);assert.equal(initial.count,roots.length);
  assert.equal((await safety()).mode,2);assert.equal(initial.prices[0],40_000n);
  await reject('freeze cannot replay a committed epoch',await freeze());
  await reject('frozen venue rejects cash mutation',sdk.getDepositAccountV3Instruction({...common,owner,margin:cross,
    quoteMint:setup.mint.address,userToken:setup.operators[0].token.address,amount:1n}),6108,[owner]);
  const snapshots=await raw();
  const rowInputs:{cash:bigint;claims:bigint[];key:Address}[]=[];
  for(const key of roots) {
    const value=await root(key);
    const claims=value.positions.map((position,index)=>position.lots*initial.prices[index]*1_000_000_000n+
      position.virtualScaled-position.lots*(initial.funding[index]-position.fundingCheckpointScaled));
    rowInputs.push({cash:value.cash,claims,key});
  }
  const advance=(stage:number,start:number,length:number,members:Address[]=[])=>{
    const instruction=sdk.getAdvanceAccountResolutionV3Instruction({...accounts,page:pages[Math.floor(start/2)],
      epoch:initial.epoch,stage,start,length});
    return {...instruction,accounts:[...instruction.accounts!,...members.map(address=>({address,role:AccountRole.READONLY}))]};
  };
  await reject('no omitted first valuation row',advance(2,1,1,[roots[1]]));
  await reject('reordered valuation roots reject',advance(2,0,2,[roots[1],roots[0]]));
  for(let start=0;start<roots.length;) {
    const length=start===0||start%2===1?1:Math.min(2,roots.length-start);
    await h.send('canonical frozen valuation',[advance(2,start,length,roots.slice(start,start+length))]);
    start+=length;
  }
  assert.equal((await header()).stage,3);
  for(let start=0;start<roots.length;start+=2)await h.send('complete exact denominator pass',[
    advance(3,start,Math.min(2,roots.length-start))]);
  assert.equal((await header()).stage,4);
  // This signed case has one single-market debtor, so L=1. Compute the known
  // fraction directly from fetched claims/cash, independently of Rust helpers.
  const positives=[0n,0n],collections=[0n,0n];
  for(const row of rowInputs)for(let index=0;index<2;index++) {
    if(row.claims[index]>0n)positives[index]+=row.claims[index];
    if(row.claims[index]<0n)collections[index]+=row.cash<(-row.claims[index]/1_000_000_000n)?
      row.cash:-row.claims[index]/1_000_000_000n;
  }
  assert(positives[0]>0n);assert.equal(positives[1],0n);
  const factor=positives[0];
  const numerators=[(initial.poolsBefore[0]+initial.insuranceBefore[0]+collections[0])*1_000_000_000n,factor];
  assert(numerators[0]<factor);
  const proposal=Buffer.alloc(1560);
  function encode(value:bigint,offset:number,length:number) {
    for(let index=0;index<length;index++){proposal[offset+index]=Number(value&255n);value>>=8n;}
    assert.equal(value,0n);
  }
  numerators.forEach((value,index)=>encode(value,index*768,768));encode(factor,1536,24);
  const proposalHash=createHash('sha256').update(proposal).digest();
  for(let offset=0;offset<proposal.length;offset+=512)await h.send('upload untrusted bounded rate proof',[
    sdk.getProposeAccountResolutionV3Instruction({...accounts,epoch:initial.epoch,evaluation:0,proposalHash,offset,
      bytes:proposal.subarray(offset,Math.min(proposal.length,offset+512))})]);
  assert.equal((await header()).stage,5);
  for(let start=0;start<roots.length;start+=2)await h.send('verify every exact frozen flow and slope',[
    advance(5,start,Math.min(2,roots.length-start))]);
  const verified=await header();assert.equal(verified.stage,6);
  assert.deepEqual(verified.insuranceSpent,[initial.insuranceBefore[0],0n]);
  for(const key of [common.custody,common.vault,...roots,...ledgers]) {
    if(key===common.custody)continue; // Event sequence advances, balances stay pinned below.
    assert.equal((await h.read(key))!.toString('base64'),snapshots[key],`${key}: pre-plan financial mutation`);
  }
  assert.equal(sdk.getCustodyV3Decoder().decode((await h.read(common.custody))!).totalCash,initial.cashBefore);
  for(let start=0;start<roots.length;start+=2)await h.send('complete atom floors before application',[
    advance(6,start,Math.min(2,roots.length-start))]);
  assert.equal((await header()).stage,7);
  const frozenRows:sdk.ResolutionRowV3[]=[];
  for(let index=0;index<Math.ceil(roots.length/2);index++) {
    const page=sdk.getResolutionPageV3Decoder().decode((await h.read(pages[index]))!);
    frozenRows.push(...page.rows.slice(0,page.rowCount));
  }
  const wide=(limbs:readonly bigint[])=>limbs.reduceRight((total,limb)=>(total<<64n)+limb,0n);
  const denominator=wide(verified.flowDenominator.limbs);
  const orders=[0,1].map(market=>roots.map((_,id)=>id).sort((left,right)=>{
    const remainder=(id:number)=>frozenRows[id].claimsScaled[market]>0n?
      wide(frozenRows[id].exactFlowNumerators[market].limbs)-frozenRows[id].roundedFlows[market]*denominator:0n;
    const first=remainder(left),second=remainder(right);
    return first===second?left-right:first>second?-1:1;
  })) as [number[],number[]];
  await reject('duplicate remainder permutation rejects',sdk.getOrderAccountResolutionV3Instruction({
    ...accounts,epoch:initial.epoch,orders:[Array(roots.length).fill(0),orders[1]]}));
  const badOrder=[...orders[0]].sort((left,right)=>right-left);
  await h.send('commit wrong untrusted remainder order',[sdk.getOrderAccountResolutionV3Instruction({
    ...accounts,epoch:initial.epoch,orders:[badOrder,orders[1]]})]);
  await h.send('begin immutable order verification',[sdk.getCheckAccountResolutionOrderV3Instruction({
    ...accounts,page:pages[Math.floor(badOrder[0]/2)],epoch:initial.epoch,start:0})]);
  await reject('cannot replace ordering after verification begins',sdk.getOrderAccountResolutionV3Instruction({
    ...accounts,epoch:initial.epoch,orders}));
  for(let start=1;(await header()).cursor!==0;start++) {
    assert(start<roots.length);
    await h.send('wrong committed order resets deterministically',[sdk.getCheckAccountResolutionOrderV3Instruction({
      ...accounts,page:pages[Math.floor(badOrder[start]/2)],epoch:initial.epoch,start})]);
  }
  assert.equal((await header()).stage,7);
  assert.equal(sdk.getResolutionWorkV3Decoder().decode((await h.read(work))!).limbCursor,0);
  await h.send('propose complete remainder permutations',[sdk.getOrderAccountResolutionV3Instruction({
    ...accounts,epoch:initial.epoch,orders})]);
  for(let start=0;start<roots.length*2;start++) {
    const id=orders[Math.floor(start/roots.length)][start%roots.length];
    await h.send('verify exact remainder order and stable ties',[sdk.getCheckAccountResolutionOrderV3Instruction({
      ...accounts,page:pages[Math.floor(id/2)],epoch:initial.epoch,start})]);
  }
  assert.equal((await header()).stage,8);
  for(let steps=0;(await header()).stage===8;steps++) {
    assert(steps<2000);
    const start=(await header()).cursor;
    await h.send('bounded deterministic conserving DFS',[sdk.getRoundAccountResolutionV3Instruction({
      ...accounts,epoch:initial.epoch,start})]);
  }
  const rounded=await header();assert.equal(rounded.stage,9);
  const graph=sdk.getResolutionWorkV3Decoder().decode((await h.read(work))!);
  assert(graph.augmentations>0,'signed two-maker creditors must exercise actual fractional allocation');
  for(let market=0;market<2;market++) {
    let movements=0n;
    for(let id=0;id<roots.length;id++) {
      const sign=frozenRows[id].claimsScaled[market]<0n?-1n:frozenRows[id].claimsScaled[market]>0n?1n:0n;
      movements+=sign*(frozenRows[id].roundedFlows[market]+BigInt(graph.residualCapacity[2*(market*roots.length+id)+1]));
    }
    assert.equal(movements,initial.poolsBefore[market]+verified.insuranceSpent[market]);
  }
  for(let id=0;id<roots.length;id++) {
    const row=frozenRows[id],actual=row.cashAfter+BigInt(graph.residualCapacity[2*(2*roots.length+id)+1]);
    const exact=row.cashBefore*denominator+row.claimsScaled.reduce((sum,claim,market)=>sum+
      (claim<0n?-1n:claim>0n?1n:0n)*wide(row.exactFlowNumerators[market].limbs),0n);
    assert(actual*denominator-exact<denominator && exact-actual*denominator<denominator);
    assert(actual>=row.cashBefore-row.collected);
    assert.equal((await h.read(roots[id]))!.toString('base64'),snapshots[roots[id]]);
  }
  return {venue:common.venue,resolution,work,pages,roots,markets,ledgers,frozenInputs:rowInputs,initial,verified,rounded,rawAccounts:await raw()};
}
