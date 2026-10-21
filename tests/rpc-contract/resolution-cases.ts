import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {AccountRole,type Address,type Instruction} from '@solana/kit';
import {getCreateAccountInstruction,getTransferSolInstruction} from '@solana-program/system';
import {TOKEN_PROGRAM_ADDRESS,getInitializeAccount3Instruction,getMintToInstruction} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {fixtureKey} from './custody-cases.js';
import {type OracleHarness,oracleSetup} from './oracle-cases.js';
import {orderTools} from './order-cases.js';
import {feedAddress,publishFeed} from './oracle-fixture.js';
const json=(x:unknown)=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v);
export async function resolutionTools(h:OracleHarness,a:Awaited<ReturnType<typeof oracleSetup>>){
  const t=await orderTools(h,a),[resolution]=await sdk.findResolutionPda({market:a.market});
  const qualify=t.recover;
  t.recover=async(price=60000n)=>{
    for(const [i,x]of a.makers.entries()){
      const r=sdk.getMakerRegistrationDecoder().decode((await h.read(x.registration))!);
      if(r.expirySlot-(await h.slot())<600n){await h.waitUntil(r.expirySlot);
        await h.send('renew real maker epoch before long resolution matrix',[(i===0?sdk.makerA:sdk.makerB).getPublishEpochInstruction({owner:x.owner,config:x.config,duration:3600n}),await sdk.getSyncMakerEpochInstructionAsync({...a,...x})],[x.owner]);}
    }
    await qualify(price);
  };
  const state=async()=>sdk.getResolutionStateDecoder().decode((await h.read(resolution))!);
  const registry=async()=>sdk.getParticipantRegistryDecoder().decode((await h.read(a.registry))!);
  const sources=async()=>{const f=await Promise.all([0,1,2,3].map(feedAddress));return{primaryBtc:f[0].feed,primaryCollateral:f[1].feed,guardBtc:f[2].feed,guardCollateral:f[3].feed};};
  async function fresh(price=60_000n){const awaitNow=await h.now();await h.send('publish authenticated resolution sources',await Promise.all([0,1,2,3].map(i=>publishFeed(i,awaitNow,{price:i%2===0?price*1_000_000n:1_000_000n}))),[a.primary,a.guardKey]);}
  async function provision(name:string,cash:bigint){
    const owner=await fixtureKey(name),token=await fixtureKey(`${name}-token`),[participant]=await sdk.findParticipantPda({market:a.market,owner:owner.address});
    await h.send('fund receiver rent and create real SPL token account',[getTransferSolInstruction({source:a.payer,destination:owner.address,amount:50_000_000n}),await sdk.getRegisterParticipantInstructionAsync({...a,owner}),getCreateAccountInstruction({payer:a.payer,newAccount:token,lamports:await h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),getInitializeAccount3Instruction({account:token.address,mint:a.mint.address,owner:owner.address}),getMintToInstruction({mint:a.mint.address,token:token.address,mintAuthority:a.payer,amount:cash})],[owner,token]);
    if(cash>0n)await h.send('deposit actual consenting receiver capital',[await sdk.getDepositInstructionAsync({...a,owner,participant,quoteMint:a.mint.address,userToken:token.address,amount:cash})],[owner]);
    return{owner,participant,token};
  }
  async function splitOpen(){
    const m=await t.market(),r=await t.risk(),p=await t.participant(),slot=await h.slot(),[x,y]=a.makers;
    const regs=await Promise.all(a.makers.map(async x=>sdk.getMakerRegistrationDecoder().decode((await h.read(x.registration))!)));
    await h.send('owner opens five lots with each actual maker for two independent profit recipients',[sdk.routeComputeBudget(),await sdk.getExecuteRouteInstructionAsync({...a,owner:a.owner,trader:a.trader,
      firstCapital:x.capital,firstRegistration:x.registration,firstProgram:x.pricingProgram,firstProgramData:x.programData,firstConfig:x.config,
      secondCapital:y.capital,secondRegistration:y.registration,secondProgram:y.pricingProgram,secondProgramData:y.programData,secondConfig:y.config,
      domain:m.domain,termsEpoch:m.termsEpoch,configEpoch:m.configEpoch,observationSequence:r.observationSequence,nonce:p.nonce,startSlot:slot,expirySlot:slot+150n,
      side:0,lots:10n,maxFee:1_000_000n,allInLimit:1_000_000_000n,reduceOnly:false,generation:p.generation,
      legs:regs.map(r=>({lots:5n,quoteEpoch:r.quoteEpoch,authorityEpoch:r.authorityEpoch}))})],[a.owner]);
  }
  async function liq(receiverOwner:aType['owner'],lots=4n,price=42_000n,overrides:Record<string,any>={}){
    return sdk.getLiquidateInstructionAsync({...a,receiverOwner,target:a.trader,sequence:(await t.market()).sequence,observation:(await t.risk()).observationSequence,lots,price,...overrides});
  }
  type aType=typeof a;
  async function freeze(emergency=false,target=a.trader,caller=a.payer){return sdk.getFreezeMarketInstructionAsync({...a,...await sources(),resolution,caller,target,sequence:(await t.market()).sequence,observation:(await t.risk()).observationSequence,emergency});}
  async function page(size=4,overrides:Record<string,any>={},members?:Address[]){const s=await state(),r=await registry(),start=overrides.start??s.header.cursor,stage=overrides.stage??s.header.stage;
    const ix=await sdk.getAdvanceResolutionInstructionAsync({...a,resolution,epoch:s.header.epoch,stage,start,...overrides});
    return {...ix,accounts:[...ix.accounts,...(members??r.members.slice(start,start+size)).map(address=>({address,role:[3,10].includes(stage)?AccountRole.WRITABLE:AccountRole.READONLY}))]};
  }
  async function recoverIx(resume=false,caller=a.payer){return sdk.getRecoverResolutionInstructionAsync({...a,...await sources(),resolution,caller,epoch:(await state()).header.epoch,resume});}
  async function expected(){const m=await t.market(),s=await state(),r=await registry(),participants=await Promise.all(r.members.map(t.participant));
    const input={participants,price:s.header.price,funding:s.header.funding,insurance:m.insurance,settlement:m.settlement};
    return{input,output:JSON.parse(execFileSync('python3',['tests/financial/resolution-reference.py'],{input:json(input),encoding:'utf8'}))};}
  async function reconcile(){const r=await registry();sdk.reconcileResolution(await t.market(),await t.risk(),Object.fromEntries(await Promise.all(r.members.map(async key=>[key,await t.participant(key)]))),await state());}
  async function rejected(label:string,ix:Instruction,signers:aType['owner'][]=[],error:number|'reject'='reject'){const keys=[a.market,a.routeState,a.registry,a.vault,resolution,...(await registry()).members];const before=await Promise.all(keys.map(k=>h.read(k)));
    await h.send(label,[sdk.resolutionComputeBudget(),ix],signers,error);assert.deepEqual(await Promise.all(keys.map(k=>h.read(k))),before,label);}
  async function finish(expectedResult:any,pageSize=4){const progress=[];
    while((await state()).header.stage<12){const old=await state();await h.send(`resolution stage ${old.header.stage} exact page ${old.header.cursor}`,[sdk.resolutionComputeBudget(),await page(pageSize)]);await reconcile();progress.push((await state()).header);}
    const s=await state(),m=await t.market(),r=await registry();
    assert.equal(m.insurance.toString(),expectedResult.insurance);assert.equal(m.settlement,0n);assert.equal(s.header.insuredAtoms.toString(),expectedResult.insuredAtoms);assert.equal(s.header.planPool.toString(),expectedResult.planPool);
    for(const row of expectedResult.rows){const p=await t.participant(r.members[row.id]),actual=s.rows[row.id];assert.equal(p.cash.toString(),row.cash);assert.equal(p.lots,0n);assert.equal(p.virtualScaled,0n);for(const k of ['collected','claim','insuredScaled','impairedScaled','paid','roundingScaled']as const)assert.equal(actual[k].toString(),row[k]);}
    return progress;
  }
  return{...t,resolution,state,registry,sources,fresh,provision,splitOpen,liq,freeze,page,recoverIx,expected,reconcile,rejected,finish};
}
export async function resolutionCases(h:OracleHarness,a:Awaited<ReturnType<typeof oracleSetup>>,pageSize=4,cohortSize=5,emergencyCase=false){
  const t=await resolutionTools(h,a);await t.recover();
  await h.send('initialize bounded resolution account',[await sdk.getInitializeResolutionInstructionAsync({...a,authority:a.payer})]);
  const receiver=await t.provision('p09-receiver',1_000_000n),empty=await t.provision('p09-empty',0n);
  while((await t.registry()).count<cohortSize){const owner=await fixtureKey(`p09-member-${(await t.registry()).count}`);
    await h.send('register exact bounded cohort member',[getTransferSolInstruction({source:a.payer,destination:owner.address,amount:20_000_000n}),await sdk.getRegisterParticipantInstructionAsync({...a,owner})],[owner]);}
  await t.recover();
  // The exit guard itself uses its independent 1-8-member pages.
  for(let start=0;start<cohortSize;start+=8){const m=await t.market(),r=await t.risk(),reg=await t.registry();const ix=await sdk.getCheckExitCohortInstructionAsync({...a,sequence:m.sequence,observation:r.observationSequence,start});await h.send('certify full funded cohort before withdrawing',[{...ix,accounts:[...ix.accounts,...reg.members.slice(start,start+8).map(address=>({address,role:AccountRole.READONLY}))]}]);}
  await h.send('retain exactly funded target cash before opening',[await t.withdrawIx((await t.participant()).cash-200_000n)],[a.owner]);
  await t.splitOpen();await t.recover();
  const order=await t.place('risk-increasing authority to invalidate only after liquidation progress',{lots:1n,feeBudget:100n});
  const protectedPosition=await t.participant(),protectionId=protectedPosition.book.lastOrderId+1n;
  const protection={side:1,lots:10n,limit:60_000n,feeBudget:100n,reduceOnly:true,generation:protectedPosition.generation};
  await h.send('existing-position TP/SL remains clipped through partial liquidation',[await sdk.getPlaceProtectionInstructionAsync({...a,owner:a.owner,participant:a.trader,expectedId:protectionId,
    tp:await t.terms({...protection,trigger:1,threshold:61_000n}),sl:await t.terms({...protection,trigger:2,threshold:59_000n})})],[a.owner]);
  await t.rejected('healthy target cannot be liquidated',await t.liq(receiver.owner,4n,60_000n),[receiver.owner],6129);
  await t.rejected('solvent participant cannot trigger default',await t.freeze());
  await t.sample(42_000n);
  await t.rejected('zero funded receiver cannot acquire exposure',await t.liq(empty.owner),[empty.owner],6129);
  await h.send('fund a real but insufficient receiver margin',[getMintToInstruction({mint:a.mint.address,token:empty.token.address,mintAuthority:a.payer,amount:100n}),await sdk.getDepositInstructionAsync({...a,owner:empty.owner,participant:empty.participant,quoteMint:a.mint.address,userToken:empty.token.address,amount:100n})],[empty.owner]);
  await t.sample(42_000n);
  await t.rejected('positive receiver cash still must satisfy post-transfer IM',await t.liq(empty.owner),[empty.owner],6129);
  await t.rejected('maker capital cannot bypass standing commitment as receiver',await t.liq(a.makers[0].owner),[a.makers[0].owner],6129);
  await t.rejected('self liquidation rejected',await t.liq(a.owner),[a.owner]);
  await t.rejected('out-of-band price rejected',await t.liq(receiver.owner,4n,37_799n),[receiver.owner],6129);
  await t.rejected('within-band price must still improve deficit after fee',await t.liq(receiver.owner,4n,37_800n),[receiver.owner],6129);
  await t.rejected('target exposure cannot reverse',await t.liq(receiver.owner,11n),[receiver.owner],6129);
  await t.rejected('wrong receiver signature rejected',await t.liq(empty.owner,4n,42_000n,{receiver:receiver.participant}),[empty.owner]);
  await t.sample(42_000n);
  const [binding]=await sdk.findReceiverBindingPda({receiver:receiver.participant});
  await h.send('dust lamports cannot grief unfunded binding proof',[getTransferSolInstruction({source:a.payer,destination:binding,amount:await h.rent(0)})]);
  const before=await t.participant(),received=await t.participant(receiver.participant),preMarket=await t.market();
  const duplicate=await t.liq(receiver.owner);
  await h.send('funded receiver signs strictly improving partial liquidation',[sdk.resolutionComputeBudget(),duplicate],[receiver.owner]);
  const after=await t.participant(),post=await t.market(),r=await t.participant(receiver.participant);
  assert.equal(after.cash,before.cash-84n);assert.equal(r.cash,received.cash+84n);assert.equal(after.lots,6n);assert.equal(r.lots,4n);
  assert.equal(after.virtualScaled,before.virtualScaled-before.lots*(post.fundingIndexScaled-before.fundingCheckpointScaled)+168_000n*1_000_000_000n);
  assert.equal(r.virtualScaled,-168_000n*1_000_000_000n);assert.equal(post.totalCash,preMarket.totalCash);assert.equal(post.fees,preMarket.fees);assert.equal((await t.order(order)).state,6);assert.equal(after.reserved,200n);
  for(const id of [protectionId,protectionId+1n])assert.equal(sdk.orderRemaining(after,after.book.orders.find(o=>o.id===id)!,post.termsEpoch,await h.slot()),6n);
  await t.rejected('duplicate liquidation snapshot rejected',duplicate,[receiver.owner]);
  await t.sample(10_000n);
  const coverage=(await t.risk()).oracle;
  await h.send('permissionless authenticated bankruptcy freezes entire registry',[sdk.resolutionComputeBudget(),await t.freeze()]);
  const frozenCoverage=(await t.risk()).oracle,freezeMarket=await t.market(),freezeHeader=(await t.state()).header;
  const covered=coverage.heldUntil>coverage.sampledAt?(freezeMarket.fundingTime<coverage.heldUntil?freezeMarket.fundingTime:coverage.heldUntil)-coverage.sampledAt:0n;
  assert.equal(frozenCoverage.coveredSeconds,coverage.coveredSeconds+(covered>0n?covered:0n));
  assert.equal(frozenCoverage.skippedSeconds,coverage.skippedSeconds+freezeHeader.frozenAt-coverage.sampledAt-(covered>0n?covered:0n));
  const expected=await t.expected();await t.reconcile();
  assert.equal((await t.state()).header.stage,2);assert.equal((await t.market()).mode,3);
  await t.rejected('custody authority cannot bypass resolution recovery',[await sdk.getSetCustodyPauseInstructionAsync({...a,authority:a.payer,paused:false})][0]);
  await t.rejected('deposit cannot join frozen loss-bearing cash',await sdk.getDepositInstructionAsync({...a,owner:a.owner,participant:a.trader,quoteMint:a.mint.address,userToken:a.token.address,amount:1n}),[a.owner]);
  await t.rejected('ordinary withdrawal blocked while frozen',await t.withdrawIx(1n),[a.owner]);
  await t.rejected('wrong resolution epoch rejected',await t.page(4,{epoch:2n}));
  await t.rejected('skipped page rejected',await t.page(4,{start:1}));
  const members=(await t.registry()).members;
  await t.rejected('duplicate member cannot substitute for complete cohort',await t.page(2,{},[members[0],members[0]]));
  await t.rejected('omitted registry member rejected',await t.page(2,{},[members[0],members[2]]));
  await t.rejected('reordered registry page rejected',await t.page(2,{},[members[1],members[0]]));
  await t.rejected('foreign account rejected',await t.page(1,{},[a.vault]));
  await t.rejected('early recovery rejected',await t.recoverIx(true));
  await t.fresh(70_000n);await t.rejected('a later source cannot reprice an already pinned cohort',await t.recoverIx());assert.equal((await t.state()).header.price,10_000n);
  const first=await t.page(2);await h.send('first exact page advances durable cursor',[sdk.resolutionComputeBudget(),first]);await t.rejected('competing keeper cannot replay completed page',first);await t.reconcile();
  const progress=await t.finish(expected.output,pageSize);
  await t.rejected('complete accounting alone does not authorize resume',await t.recoverIx(true));
  for(let i=0;i<4;i++){await h.waitTime((await h.now())+2n);await t.fresh(60_000n);await h.send('authenticated recovery observation',[sdk.resolutionComputeBudget(),await t.recoverIx()]);}
  await t.rejected('non-authority cannot resume completed resolution',await t.recoverIx(true,receiver.owner),[receiver.owner]);
  const frozen=await t.market(),beforeResume=await h.now(),oldCoverage=(await t.risk()).oracle;await h.send('authority resumes only fully reconciled recovered market',[sdk.resolutionComputeBudget(),await t.recoverIx(true)]);
  assert.equal((await t.market()).termsEpoch,frozen.termsEpoch+1n);assert.equal((await t.market()).mode,2);assert.equal((await t.risk()).oracle.status,0);assert.equal((await t.state()).header.stage,13);
  const resumedCoverage=(await t.risk()).oracle,skipped=resumedCoverage.skippedSeconds-oldCoverage.skippedSeconds;
  assert.equal(resumedCoverage.coveredSeconds,oldCoverage.coveredSeconds);
  assert(skipped>=beforeResume-freezeHeader.frozenAt&&skipped<=(await h.now())-freezeHeader.frozenAt);
  assert.equal((await t.market()).fundingIndexScaled,freezeHeader.funding);
  let emergencyEvidence:any=null;
  if(emergencyCase){
    await t.recover();const deadline=(await t.risk()).oracle.sourceDeadline;
    await t.sample(60_000n,{0:{level:1}});assert.equal((await t.risk()).oracle.status,0);assert.equal((await t.risk()).oracle.sourceDeadline,deadline);
    await h.waitTime(deadline+29n);await t.rejected('emergency grace interval cannot be shortened',await t.freeze(true));
    await h.waitTime(deadline+30n);await t.rejected('permissionless caller cannot manufacture source emergency',await t.freeze(true,a.trader,receiver.owner),[receiver.owner]);
    await h.send('authority freezes only after authenticated source outage grace',[sdk.resolutionComputeBudget(),await t.freeze(true)]);
    assert.equal((await t.state()).header.stage,1);assert.equal((await t.state()).header.price,0n);
    await t.rejected('no valuation page may invent a missing reference',await t.page());
    await t.rejected('stale sources cannot pin closeout price',await t.recoverIx());
    await t.fresh(60_000n);await h.send('new authenticated sources pin exactly one common reference',[sdk.resolutionComputeBudget(),await t.recoverIx()]);
    emergencyEvidence=await t.expected();await t.finish(emergencyEvidence.output,pageSize);
  }
  return{expected,progress,emergencyEvidence,finalMarket:await t.market(),resolution:await t.state(),receiver:receiver.participant};
}
