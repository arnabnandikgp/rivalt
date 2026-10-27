import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {AccountRole,getAddressEncoder,type Address,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {getTokenDecoder,findAssociatedTokenPda,getCreateAssociatedTokenInstruction,TOKEN_PROGRAM_ADDRESS} from '@solana-program/token';
import {accountPda} from './account-custody-cases.js';
import {accountTradingSetup,type AccountTradingHarness} from './account-trading-setup.js';

// Incremental P26 runtime gate. All financial state comes from signed deposits,
// trades and authenticated price updates. Full terminal acceptance extends this.
export type SafetyResourceProbe = {
  resolution:Address;work:Address;custody:Address;pages:Address[];immutable:Address[];
  advance:(stage:number,start:number,length:number)=>Instruction;finalize:()=>Instruction;
  propose:(bytes:Uint8Array,offset:number,proposalHash:Uint8Array)=>Instruction;
  order:(orders:[number[],number[]])=>Instruction;
  checkOrder:(start:number,id:number)=>Instruction;round:(start:number)=>Instruction;
};
export async function accountSafetyCases(h:AccountTradingHarness,options:{maximumCohort?:boolean;retireResolved?:boolean;liquidation?:boolean;twoMarket?:boolean;emergency?:boolean;fullBooks?:boolean;
  resourceProbe?:(input:SafetyResourceProbe)=>Promise<void>;
  defaultProbe?:(label:string,instruction:Instruction,signers?:Parameters<AccountTradingHarness['send']>[2])=>Promise<void>}={}) {
  assert(!(options.liquidation && options.twoMarket),'separate liquidation and two-market default scenarios');
  const setup=await accountTradingSetup(h,{qualifyPrimitives:false,domainLabel:'rivalt/p26/account-safety'});
  const {payer,owner,markets,ledgers,cross,makers,feeds,roots}=setup;
  const common={...setup.common,btc:markets[0],eth:markets[1]};
  const encoded=getAddressEncoder().encode(common.venue);
  const resolution=await accountPda('resolution-v3',encoded),work=await accountPda('resolution-work-v3',encoded);
  const pages=await Promise.all(Array.from({length:32},(_,index)=>{
    const bytes=Buffer.alloc(2);bytes.writeUInt16LE(index);return accountPda('resolution-page-v3',encoded,bytes);
  }));
  const accounts={...common,resolution,work};
  const liquidationSteps:{target:Address;receiver:Address;lots:bigint;price:bigint;before:Record<string,string|null>;after:Record<string,string|null>}[]=[];
  const certificate=await accountPda('retirement-v3',encoded);
  const [reserveDestination]=await findAssociatedTokenPda({owner:payer.address,mint:setup.mint.address,tokenProgram:TOKEN_PROGRAM_ADDRESS});
  const header=async()=>sdk.getResolutionV3Decoder().decode((await h.read(resolution))!);
  const root=async(key:Address)=>sdk.getMarginAccountV3Decoder().decode((await h.read(key))!);
  const safety=async()=>sdk.getSafetyV3Decoder().decode((await h.read(common.safety))!);
  const guard=async(key:Address)=>{const value=await root(key);return {safetyEpoch:(await safety()).epoch,
    venueTermsEpoch:sdk.getVenueV3Decoder().decode((await h.read(common.venue))!).termsEpoch,nonce:value.nonce,stateVersion:value.stateVersion};};
  const raw=async()=>Object.fromEntries(await Promise.all([common.venue,common.custody,common.safety,common.vault,
    common.registry,setup.mint.address,reserveDestination,certificate,...setup.operators.map(operator=>operator.token.address),...roots,...markets,...ledgers,resolution,work,...pages].map(async key=>[key,(await h.read(key))?.toString('base64')??null])));
  async function reject(label:string,instruction:Instruction,error=6130,signers:typeof owner[]=[]) {
    const before=await raw();await h.send(label,[instruction],signers,error);assert.deepEqual(await raw(),before,`${label}: rollback`);
  }
  const sources={primaryBtc:feeds[0].feed,primaryCollateral:feeds[1].feed,guardBtc:feeds[2].feed,
    guardCollateral:feeds[3].feed,primaryEth:feeds[4].feed,guardEth:feeds[5].feed};
  const withdrawal=async(amount:bigint)=>sdk.getWithdrawFundedAccountV3Instruction({...common,owner,
    margin:roots[0],quoteMint:setup.mint.address,userToken:setup.operators[0].token.address,
    guard:await guard(roots[0]),amount});
  const freeze=async(emergency=false,caller=payer)=>sdk.getFreezeAccountsV3Instruction({...accounts,...sources,caller,target:cross,
    safetyEpoch:(await safety()).epoch,resolutionEpoch:(await header()).epoch,emergency});
  await h.send('create immutable reserve destination ATA',[getCreateAssociatedTokenInstruction({payer,ata:reserveDestination,
    owner:payer.address,mint:setup.mint.address})]);
  await h.send('donate actual tokens to unrelated ETH insurance',[sdk.getSeedMarketInsuranceV3Instruction({...common,
    reserveAuthority:payer,donor:owner,donorToken:setup.operators[0].token.address,quoteMint:setup.mint.address,
    marketIndex:1,amount:10n})],[owner]);
  const reserveWithdraw=()=>sdk.getWithdrawRetiredReserveV3Instruction({...common,reserveAuthority:payer,
    destination:reserveDestination,quoteMint:setup.mint.address,marketIndex:1,amount:10n});
  await reject('custody insurance is not redeemable',reserveWithdraw(),6108);
  await options.defaultProbe?.('default build rejects schema-3 activation',sdk.getQualifyAccountTradingV3Instruction({...common,authority:payer}));
  await h.send('activate explicit P26 candidate profile',[sdk.getQualifyAccountTradingV3Instruction({...common,authority:payer})]);
  if(options.maximumCohort) {
    const u16=(value:number)=>{const bytes=Buffer.alloc(2);bytes.writeUInt16LE(value);return bytes;};
    for(const operator of setup.operators)for(let portfolioIndex=0;portfolioIndex<4 && roots.length<64;portfolioIndex++) {
      const portfolio=await accountPda('portfolio-v3',encoded,getAddressEncoder().encode(operator.owner.address),u16(portfolioIndex));
      if(portfolioIndex>0)await h.send('maximum cohort distinct portfolio',[sdk.getCreatePortfolioV3Instruction({
        ...common,owner:operator.owner,portfolio,index:portfolioIndex})],[operator.owner]);
      for(let child=0;child<=8 && roots.length<64;child++) {
        const margin=await accountPda('margin-v3',getAddressEncoder().encode(portfolio),u16(child));
        if(roots.includes(margin))continue;
        await h.send('maximum cohort canonical member',[sdk.getRegisterMarginV3Instruction({...common,owner:operator.owner,
          portfolio,margin,subaccountIndex:child,mode:child===0?0:1,isolatedMarketIndex:child===0?255:child%2,role:0})],[operator.owner]);
        roots.push(margin);
      }
    }
    assert.equal(roots.length,64);
  }
  await h.send('precreate bounded header and continuation work',[sdk.getInitializeAccountResolutionV3Instruction({...accounts,payer})]);
  assert.equal((await h.read(resolution))!.length,3644);assert.equal((await h.read(work))!.length,7918);
  await reject('cannot skip a precreated page',sdk.getInitializeAccountResolutionPageV3Instruction({...accounts,payer,page:pages[1],pageIndex:1}));
  for(let pageIndex=0;pageIndex<32;pageIndex++) {
    await h.send('precreate canonical two-row page',[sdk.getInitializeAccountResolutionPageV3Instruction({...accounts,payer,page:pages[pageIndex],pageIndex})]);
    assert.equal((await h.read(pages[pageIndex]))!.length,3400);
  }
  await reject('healthy funded account cannot trigger default',await freeze());
  await h.send('fund actual future debtor',[sdk.getDepositAccountV3Instruction({...common,owner,margin:cross,
    quoteMint:setup.mint.address,userToken:setup.operators[0].token.address,amount:options.twoMarket?600_000n:400_000n})],[owner]);
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
  if(options.twoMarket) {
    const [first,second]=makers[1];
    const state=await setup.marketState(1),slot=await h.slot();
    const registrations=await Promise.all([first,second].map(async maker=>sdk.getMakerRegistrationV3Decoder().decode((await h.read(maker.registration))!)));
    await h.send('open actual second-market cross exposure',[sdk.getExecuteAccountRouteV3Instruction({...common,
      actor:owner,market:markets[1],otherMarket:markets[0],ledger:ledgers[1],otherLedger:ledgers[0],trader:cross,
      firstCapital:first.capital,firstRegistration:first.registration,firstProgram:first.pricingProgram,
      firstProgramData:first.programData,firstConfig:first.config,secondCapital:second.capital,secondRegistration:second.registration,
      secondProgram:second.pricingProgram,secondProgramData:second.programData,secondConfig:second.config,
      guard:await guard(cross),domain:setup.domain,termsEpoch:state.termsEpoch,configEpoch:state.configEpoch,
      startSlot:slot,expirySlot:slot+100n,side:0,lots:50n,allInLimit:1_700_000n,maxFee:1000n,
      reduceOnly:false,generation:null,legs:registrations.map(value=>({lots:25n,quoteEpoch:value.quoteEpoch,
        authorityEpoch:value.authorityEpoch,expectedConsumed:value.buyConsumed})) as [{lots:bigint;quoteEpoch:bigint;authorityEpoch:bigint;expectedConsumed:bigint},{lots:bigint;quoteEpoch:bigint;authorityEpoch:bigint;expectedConsumed:bigint}]})],[owner]);
  }
  if(options.liquidation) {
    if(options.fullBooks)for(const margin of [cross,roots[0]])for(let index=0;index<4;index++) {
      const value=await root(margin),slot=await h.slot();
      await h.send('fill target and receiver liquidation books',[sdk.getManageAccountOrderV3Instruction({
        ...common,actor:owner,margin,guard:await guard(margin),marketIndex:0,
        operation:{__kind:'Place',expectedId:value.book.lastOrderId+1n,terms:{side:0,lots:1n,limit:66_000n,
          feeBudget:1000n,startSlot:slot,expirySlot:slot+2000n,trigger:0,threshold:0n,reduceOnly:false,generation:0n}}})],[owner]);
    }
    for(let round=0;round<4;round++) {
      await h.advance(2n);
      for(let index=0;index<6;index++)await setup.publish(index,{price:index===0||index===2?54_000_000_000n:
        index===1||index===3?1_000_000n:3_000_000_000n});
      for(const index of [0,1])await h.send('credible pre-bankruptcy liquidation valuation',[
        sdk.getSampleAccountOracleV3Instruction(setup.sampleAccounts(index))]);
    }
    const liquidate=async(price=54_000n,lots=10n,receiver=roots[0],receiverOwner=owner)=>sdk.getLiquidateAccountV3Instruction({
      ...common,target:cross,receiver,receiverOwner,targetGuard:await guard(cross),receiverGuard:await guard(receiver),marketIndex:0,lots,price});
    await reject('liquidation cannot worsen deficit after fees',await liquidate(48_600n),6100,[owner]);
    await reject('liquidation cannot flip target',await liquidate(54_000n,51n),6100,[owner]);
    await reject('receiver consent cannot be substituted',await liquidate(54_000n,10n,roots[0],maker.owner),6102,[maker.owner]);
    await reject('maker capital cannot receive liquidation',await liquidate(54_000n,10n,maker.capital,maker.owner),6129,[maker.owner]);
    const instruction=await liquidate();const before=await raw();
    await options.defaultProbe?.('default build rejects liquidation',instruction,[owner]);
    await h.send('consenting receiver liquidation strictly improves post-fee deficit',[instruction],[owner]);
    const after=await raw();
    liquidationSteps.push({target:cross,receiver:roots[0],lots:10n,price:54_000n,before,after});
    assert.equal((await root(cross)).positions[0].lots,40n);assert.equal((await root(roots[0])).positions[0].lots,10n);
    if(options.fullBooks) {
      assert.equal((await root(cross)).reserved,0n);
      assert((await root(cross)).book.orders.every(entry=>entry.order.reserve===0n));
      assert((await root(roots[0])).reserved>0n,'receiver live reservations survive and are rechecked');
    }
    await reject('liquidation old target and receiver guards cannot replay',instruction,6122,[owner]);
  }
  await h.advance(2n);
  for(let index=0;index<6;index++)await setup.publish(index,{price:index===0||index===2?40_000_000_000n:
    index===1||index===3?1_000_000n:options.twoMarket?2_000_000_000n:3_000_000_000n});
  // Freeze authenticates current oracle accounts directly; it does not wait for
  // a discretionary maker/funding sample to acknowledge actual insolvency.
  await h.send('active funded exit retains its existing financial checks',[await withdrawal(1n)],[owner]);
  const staleWithdrawal=await withdrawal(100n);
  if(options.emergency) {
    await reject('source emergency cannot bypass its grace',await freeze(true));
    await h.advance(60n);
    await reject('unpriced exposure cannot use permissionless bankruptcy',await freeze());
    await reject('source emergency requires venue authority',await freeze(true,owner),6130,[owner]);
    await h.send('authority freezes after full source-emergency grace',[await freeze(true)]);
    const frozen=await header();assert.equal(frozen.stage,1);assert.deepEqual(frozen.prices,[0n,0n]);
    const value=()=>sdk.getValueAccountResolutionV3Instruction({...accounts,...sources,epoch:frozen.epoch});
    await reject('missing required closeout sources cannot start valuation',value());
    await h.advance(2n);
    for(let index=0;index<6;index++)await setup.publish(index,{price:index===0||index===2?40_000_000_000n:
      index===1||index===3?1_000_000n:options.twoMarket?2_000_000_000n:3_000_000_000n});
    await h.send('credible fresh closeout prices leave frozen funding unchanged',[value()]);
    assert.deepEqual((await header()).funding,frozen.funding);
    await reject('closeout source valuation cannot replay',value());
  } else {
    await options.defaultProbe?.('default build rejects default freeze',await freeze());
    await h.send('freeze actual bankrupt account and complete registry',[await freeze()]);
  }
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
    return {...instruction,accounts:[...instruction.accounts!,...members.map(address=>({address,role:stage===9?AccountRole.WRITABLE:AccountRole.READONLY}))]};
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
  // Independent Fraction reference proposes rates only. Every equation, row,
  // insurance budget and whole payout still comes from signed program execution.
  const finalizeRates=()=>sdk.getFinalizeAccountResolutionRatesV3Instruction({...accounts,epoch:initial.epoch});
  let expectedInsurance:bigint[]=[];
  for(let evaluation=0;(await header()).stage===4;evaluation++) {
    assert(evaluation<3);
    const current=await header();assert.equal(current.evaluation,evaluation);
    const proof=JSON.parse(execFileSync('python3',['tests/financial/clearing-rate-proposal.py'],{
      input:JSON.stringify({rows:rowInputs,pools:initial.poolsBefore,budgets:current.budgets},(_,value)=>typeof value==='bigint'?value.toString():value),
      encoding:'utf8'})) as {common:string;factor:string;rates:string[];spent:string[];fractional:boolean[]};
    assert.equal(current.common.limbs.reduceRight((total,limb)=>(total<<64n)+limb,0n),BigInt(proof.common));
    const proposal=Buffer.alloc(1560);
    function encode(value:bigint,offset:number,length:number) {
      for(let index=0;index<length;index++){proposal[offset+index]=Number(value&255n);value>>=8n;}
      assert.equal(value,0n);
    }
    proof.rates.forEach((value,index)=>encode(BigInt(value),index*768,768));encode(BigInt(proof.factor),1536,24);
    const upload=async(bytes:Buffer,label:string)=>{
      const proposalHash=createHash('sha256').update(bytes).digest();
      for(let offset=0;offset<bytes.length;offset+=512)await h.send(label,[
        sdk.getProposeAccountResolutionV3Instruction({...accounts,epoch:initial.epoch,evaluation,proposalHash,offset,
          bytes:bytes.subarray(offset,Math.min(bytes.length,offset+512))})]);
    };
    if(evaluation===0) {
      const invalid=Buffer.from(proposal);invalid.fill(0,1536);
      await upload(invalid,'invalid complete rate encoding resets without financial mutation');
      assert.equal((await header()).stage,4);assert.equal((await header()).evaluation,0);
      assert.deepEqual((await header()).insuranceSpent,[0n,0n]);
    }
    await upload(proposal,'upload untrusted bounded rate proof');
    assert.equal((await header()).stage,5);
    if(evaluation===0 && options.resourceProbe)await options.resourceProbe({resolution,work,custody:common.custody,pages,
      immutable:[common.venue,common.safety,common.registry,common.vault,setup.mint.address,...roots,...markets,...ledgers,
        ...setup.operators.map(operator=>operator.token.address)],advance,finalize:finalizeRates,
      propose:(bytes,offset,proposalHash)=>sdk.getProposeAccountResolutionV3Instruction({...accounts,epoch:initial.epoch,
        evaluation,proposalHash,offset,bytes}),
      order:orders=>sdk.getOrderAccountResolutionV3Instruction({...accounts,epoch:initial.epoch,orders}),
      checkOrder:(start,id)=>sdk.getCheckAccountResolutionOrderV3Instruction({...accounts,page:pages[Math.floor(id/2)],epoch:initial.epoch,start}),
      round:start=>sdk.getRoundAccountResolutionV3Instruction({...accounts,epoch:initial.epoch,start})});
    await reject('cannot finalize rates before the complete cohort',finalizeRates());
    await reject('expensive verification is bounded to one row',advance(5,0,2));
    for(let start=0;start<roots.length;start++)await h.send('verify every exact frozen flow and slope',[advance(5,start,1)]);
    assert.equal((await header()).stage,5);assert.equal((await header()).cursor,roots.length);
    await options.defaultProbe?.('default build rejects rate finalization',finalizeRates());
    await h.send('separate complete rate equations and insurance floors',[finalizeRates()]);
    if(proof.fractional.some(Boolean)) {
      assert.equal((await header()).stage,4);
      assert.deepEqual((await header()).budgets,current.budgets.map((budget,index)=>proof.fractional[index]?BigInt(proof.spent[index]):budget));
    } else { expectedInsurance=proof.spent.map(BigInt);assert.equal((await header()).stage,6); }
  }
  await reject('complete rate check cannot replay',finalizeRates());
  const verified=await header();assert.equal(verified.stage,6);
  assert.deepEqual(verified.insuranceSpent,expectedInsurance);
  for(const key of [common.custody,common.vault,...roots,...ledgers]) {
    if(key===common.custody)continue; // Event sequence advances, balances stay pinned below.
    assert.equal((await h.read(key))!.toString('base64'),snapshots[key],`${key}: pre-plan financial mutation`);
  }
  assert.equal(sdk.getCustodyV3Decoder().decode((await h.read(common.custody))!).totalCash,initial.cashBefore);
  await reject('expensive atom planning is bounded to one row',advance(6,0,2));
  for(let start=0;start<roots.length;start++)await h.send('complete atom floors before application',[advance(6,start,1)]);
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
  const plannedCash=frozenRows.map((row,id)=>row.cashAfter+BigInt(graph.residualCapacity[2*(2*roots.length+id)+1]));
  await reject('reconciliation cannot precede application',advance(10,0,1,[roots[0]]));
  await h.send('apply first exact row',[advance(9,0,1,[roots[0]])]);
  await reject('applied page cannot replay',advance(9,0,1,[roots[0]]));
  await reject('mixed applied/frozen cash is not withdrawable',await withdrawal(100n),6108,[owner]);
  for(let start=1;start<roots.length;) {
    const length=start%2===1?1:Math.min(2,roots.length-start);
    await h.send('apply canonical final funded cash',[advance(9,start,length,roots.slice(start,start+length))]);
    start+=length;
  }
  assert.equal((await header()).stage,10);assert.equal((await safety()).mode,2);
  const expectedCash=initial.cashBefore+initial.poolsBefore.reduce((a,b)=>a+b,0n)+verified.insuranceSpent.reduce((a,b)=>a+b,0n);
  assert.equal(sdk.getCustodyV3Decoder().decode((await h.read(common.custody))!).totalCash,expectedCash);
  for(let id=0;id<roots.length;id++) {
    const value=await root(roots[id]);assert.equal(value.cash,plannedCash[id]);
    assert(value.positions.every(position=>position.lots===0n && position.virtualScaled===0n));
    assert(value.book.orders.every(entry=>entry.order.state===0));
    assert.equal(value.reserved,0n);assert.equal(value.delegateExpirySlot,0n);
  }
  for(let market=0;market<2;market++) {
    const ledger=sdk.getMarketLedgerV3Decoder().decode((await h.read(ledgers[market]))!);
    assert.equal(ledger.settlement,0n);assert.equal(ledger.insurance,initial.insuranceBefore[market]-verified.insuranceSpent[market]);
    assert.equal(ledger.fees,initial.feesBefore[market]);
  }
  for(let start=0;start<roots.length;start+=2)await h.send('complete actual terminal reconciliation',[
    advance(10,start,Math.min(2,roots.length-start),roots.slice(start,start+2))]);
  assert.equal((await header()).stage,11);assert.equal((await safety()).mode,3);
  const completedAccounts=await raw();
  await reject('old signed exit cannot revive after default',staleWithdrawal,6122,[owner]);
  await h.advance(30n);
  const userTokenBefore=getTokenDecoder().decode((await h.read(setup.operators[0].token.address))!).amount;
  await h.send('resolved funded cash exits with stale sources',[await withdrawal(100n)],[owner]);
  assert.equal((await root(roots[0])).cash,plannedCash[0]-100n);
  const terminal=sdk.getCustodyV3Decoder().decode((await h.read(common.custody))!);
  assert.equal(terminal.totalCash,expectedCash-100n);assert.equal(terminal.allocatedVault,initial.allocatedBefore-100n);
  assert.equal(getTokenDecoder().decode((await h.read(common.vault))!).amount,initial.allocatedBefore-100n);
  assert.equal(getTokenDecoder().decode((await h.read(setup.operators[0].token.address))!).amount,userTokenBefore+100n);
  const resolvedAccounts=await raw();
  const report=async(reactivatedAccounts?:Awaited<ReturnType<typeof raw>>)=>({
    scenario:options.twoMarket?'two-market-resolved':options.retireResolved?'resolved-retirement':'recovery-retirement',
    emergency:Boolean(options.emergency),fullBooks:Boolean(options.fullBooks),liquidationSteps,
    venue:common.venue,custody:common.custody,safety:common.safety,registry:common.registry,vault:common.vault,
    mint:setup.mint.address,userTokens:setup.operators.map(operator=>operator.token.address),reserveDestination,certificate,
    resolution,work,pages,roots,markets,ledgers,makerAccounts:makers.flat().map(maker=>({registration:maker.registration,
      capitalBinding:maker.capitalBinding,config:maker.config,makerId:maker.makerId})),frozenInputs:rowInputs,
    initial,verified,rounded,terminal,frozenAccounts:snapshots,completedAccounts,resolvedAccounts,reactivatedAccounts,rawAccounts:await raw()});
  if(options.twoMarket) {
    await h.send('precreate unused retirement storage for parity',[sdk.getInitializeAccountRetirementV3Instruction({...common,payer,certificate})]);
    return report();
  }
  await reject('resolved reserve cannot be swept before choosing retirement',reserveWithdraw(),6108);
  const recover=(resume:boolean,caller=payer)=>sdk.getRecoverAccountsV3Instruction({...accounts,...sources,caller,epoch:initial.epoch,resume});
  const reactivate=(caller=payer)=>sdk.getReactivateAccountsV3Instruction({...accounts,...sources,caller,epoch:initial.epoch});
  if(options.retireResolved) {
    await h.send('precreate unused retirement storage for parity',[sdk.getInitializeAccountRetirementV3Instruction({...common,payer,certificate})]);
    const retireResolved=async(authority=payer,includeUnusedProof=false)=>sdk.getRetireAccountsV3Instruction({
      ...common,certificate:includeUnusedProof?certificate:undefined,resolution,authority,safetyEpoch:(await safety()).epoch});
    await reject('resolved retirement rejects extraneous flat proof',await retireResolved(payer,true));
    await reject('resolved retirement requires venue authority',await retireResolved(owner),6102,[owner]);
    await h.send('explicit resolved retirement consumes complete discharge proof',[await retireResolved()]);
    assert.equal((await header()).stage,13);assert.equal((await safety()).mode,4);
    await reject('resolved retirement cannot resume or sweep then reopen',recover(true));
    await reject('resolved retirement cannot reactivate',reactivate());
    const cashBefore=sdk.getCustodyV3Decoder().decode((await h.read(common.custody))!).totalCash;
    await h.send('withdraw terminal reserve after resolved retirement',[reserveWithdraw()]);
    assert.equal(sdk.getCustodyV3Decoder().decode((await h.read(common.custody))!).totalCash,cashBefore);
    assert.equal(getTokenDecoder().decode((await h.read(reserveDestination))!).amount,10n);
    return report();
  }
  await reject('resolution alone does not authorize immediate resumption',recover(true));
  await reject('only venue authority can resume',recover(true,owner),6102,[owner]);
  await h.send('stale sources record no recovery credit',[recover(false)]);
  assert.equal((await safety()).recoverySince,0n);
  for(let round=0;round<2;round++) {
    await h.advance(2n);
    for(let index=0;index<6;index++)await setup.publish(index);
    await h.send('begin permissionless sustained source recovery',[recover(false,owner)],[owner]);
  }
  await h.advance(2n);
  await setup.publish(0,{published:(await h.now())-21n});
  await h.send('invalid source resets recovery credit',[recover(false)]);
  assert.equal((await safety()).recoverySince,0n);
  for(let round=0;round<4;round++) {
    await h.advance(2n);
    for(let index=0;index<6;index++)await setup.publish(index);
    await h.send('complete sustained source recovery',[recover(false)]);
  }
  await options.defaultProbe?.('default build rejects recovery',recover(true));
  await h.send('explicit authority recovery returns only to custody',[recover(true)]);
  assert.equal((await safety()).mode,0);assert.equal((await header()).stage,12);
  for(let index=0;index<2;index++) {
    assert.equal((await setup.marketState(index)).fundingIndexScaled,initial.funding[index]);
    assert.equal((await setup.marketState(index)).oracle.status,0);
    assert.equal(sdk.getMarketLedgerV3Decoder().decode((await h.read(ledgers[index]))!).fees,initial.feesBefore[index]);
  }
  await h.send('recovered custody accepts deposits with historical generations',[sdk.getDepositAccountV3Instruction({
    ...common,owner,margin:roots[0],quoteMint:setup.mint.address,userToken:setup.operators[0].token.address,amount:10n})],[owner]);
  await h.send('recovered custody permits source-independent funded withdrawal',[await withdrawal(10n)],[owner]);
  await reject('reactivation requires separate fresh maker and source qualification',reactivate(),6124);
  await reject('reactivation remains venue-authorized',reactivate(owner),6102,[owner]);
  for(let round=0;round<4;round++) {
    await h.advance(2n);
    for(let index=0;index<6;index++)await setup.publish(index);
    for(const index of [0,1])await h.send('separate recovered custody maker qualification',[
      sdk.getSampleAccountOracleV3Instruction(setup.sampleAccounts(index))]);
  }
  await options.defaultProbe?.('default build rejects reactivation',reactivate());
  await h.send('explicit separate local candidate reactivation',[reactivate()]);
  assert.equal((await safety()).mode,1);
  assert.deepEqual(sdk.getMakerRegistrationV3Decoder().decode((await h.read(maker.registration))!).buyConsumed,registration.buyConsumed+25n);
  await reject('reactivation cannot replay',reactivate());
  const reactivatedAccounts=await raw();
  await h.send('initialize small retirement certificate',[sdk.getInitializeAccountRetirementV3Instruction({...common,payer,certificate})]);
  assert.equal((await h.read(certificate))!.length,80);
  const scan=(start:number,members:Address[])=>{
    const instruction=sdk.getCheckAccountRetirementV3Instruction({...common,certificate,start});
    return {...instruction,accounts:[...instruction.accounts!,...members.map(address=>({address,role:AccountRole.READONLY}))]};
  };
  const retire=async(authority=payer)=>sdk.getRetireAccountsV3Instruction({...common,certificate,resolution:undefined,authority,safetyEpoch:(await safety()).epoch});
  await reject('retirement rejects incomplete cohort proof',await retire());
  await reject('retirement scan cannot omit first root',scan(1,[roots[1]]));
  await h.send('scan initial liability-free root',[scan(0,[roots[0]])]);
  await h.send('ordinary actual deposit invalidates administrative scan',[sdk.getDepositAccountV3Instruction({
    ...common,owner,margin:roots[0],quoteMint:setup.mint.address,userToken:setup.operators[0].token.address,amount:1n})],[owner]);
  await reject('retirement rejects stale scan continuation',scan(1,[roots[1]]));
  for(let start=0;start<roots.length;start+=2)await h.send('complete fresh flat no-claim no-order scan',[scan(start,roots.slice(start,start+2))]);
  await reject('complete retirement proof cannot be replaced',scan(0,[roots[0]]));
  await reject('retirement remains venue-authorized',await retire(owner),6102,[owner]);
  await reject('live reserve still cannot be redeemed after scan',reserveWithdraw(),6108);
  await options.defaultProbe?.('default build rejects retirement',await retire());
  await h.send('irreversibly retire fully reconciled venue',[await retire()]);
  assert.equal((await safety()).mode,4);
  await reject('retired identity cannot recover',recover(true));
  await reject('retired identity cannot reactivate',reactivate());
  await reject('retired identity cannot retire twice',await retire());
  await reject('retired identity rejects new deposits',sdk.getDepositAccountV3Instruction({...common,owner,margin:roots[0],
    quoteMint:setup.mint.address,userToken:setup.operators[0].token.address,amount:1n}),6108,[owner]);
  await reject('foreign reserve authority rejects',sdk.getWithdrawRetiredReserveV3Instruction({...common,reserveAuthority:owner,
    destination:reserveDestination,quoteMint:setup.mint.address,marketIndex:1,amount:10n}),6102,[owner]);
  await h.advance(30n);
  await h.send('retired owner cash stays withdrawable with stale sources',[await withdrawal(1n)],[owner]);
  const beforeReserve=sdk.getCustodyV3Decoder().decode((await h.read(common.custody))!);
  const ledgerBefore=sdk.getMarketLedgerV3Decoder().decode((await h.read(ledgers[1]))!);
  assert.equal(ledgerBefore.insurance,10n);
  await options.defaultProbe?.('default build rejects retired reserve withdrawal',reserveWithdraw());
  await h.send('retired reserve exits only to immutable canonical ATA',[reserveWithdraw()]);
  const afterReserve=sdk.getCustodyV3Decoder().decode((await h.read(common.custody))!);
  assert.equal(afterReserve.totalCash,beforeReserve.totalCash);
  assert.equal(afterReserve.allocatedVault,beforeReserve.allocatedVault-10n);
  assert.equal(getTokenDecoder().decode((await h.read(reserveDestination))!).amount,10n);
  const ledgerAfter=sdk.getMarketLedgerV3Decoder().decode((await h.read(ledgers[1]))!);
  assert.equal(ledgerAfter.insurance,0n);assert.equal(ledgerAfter.fees,ledgerBefore.fees);
  assert.equal(ledgerAfter.insuranceFeeRemainder,ledgerBefore.insuranceFeeRemainder);
  return report(reactivatedAccounts);
}
