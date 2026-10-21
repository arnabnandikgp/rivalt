import assert from 'node:assert/strict';
import { getMintToInstruction, getTokenDecoder } from '@solana-program/token';
import { getTransferSolInstruction } from '@solana-program/system';
import type { Instruction } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { addresses, fixtureKey, payerKey } from './custody-cases.js';
import { makerAddresses, type MakerHarness } from './maker-cases.js';
export type RouteHarness = MakerHarness & { replaceMaker(hostile: boolean): Promise<void> };
const scale=1_000_000_000n, abs=(n:bigint)=>n<0n?-n:n;
export async function routeCases(h:RouteHarness) {
  const a=await addresses(),payer=await payerKey(),owner=await fixtureKey('trader'),mint=await fixtureKey('mint'),token=await fixtureKey('user-token');
  const [trader]=await sdk.findParticipantPda({market:a.market,owner:owner.address}),[routeState]=await sdk.findRouteStatePda({market:a.market});
  const makers=await Promise.all([0,1].map(makerAddresses));
  const market=async()=>sdk.getMarketStateDecoder().decode((await h.read(a.market))!);
  const risk=async()=>sdk.getTestRouteStateDecoder().decode((await h.read(routeState))!);
  const balance=async(key=trader)=>sdk.getParticipantDecoder().decode((await h.read(key))!);
  const reg=async(id:number)=>sdk.getMakerRegistrationDecoder().decode((await h.read(makers[id].registration))!);
  const keys=[a.market,routeState,a.vault,trader,...makers.flatMap(x=>[x.capital,x.registration,x.config])];
  const snapshot=()=>Promise.all(keys.map(k=>h.read(k)));
  async function rejected(label:string,ix:Instruction,error:number|'reject',signers=[owner]) {
    const before=await snapshot();await h.send(label,[sdk.routeComputeBudget(),ix],signers,error);
    assert.deepEqual(await snapshot(),before,`${label}: venue residue after failure`);
  }
  async function renew(id:number) {
    const x=makers[id],s=sdk.makerA.getMakerConfigDecoder().decode((await h.read(x.config))!).state;
    if(await h.slot()<s.expirySlot) await h.waitUntil(s.expirySlot);
    await h.send(`publish maker ${id} expired epoch`,[(id===0?sdk.makerA:sdk.makerB).getPublishEpochInstruction({owner:x.owner,config:x.config,duration:3600n})],[x.owner]);
    await h.send(`sync maker ${id} current epoch`,[await sdk.getSyncMakerEpochInstructionAsync(x)]);
  }
  // B expires during P03's A-expiry scenario; refresh it through real owner authority.
  await renew(1);
  for(const x of makers) await h.send('retain fifty test tokens of maker margin',[await sdk.getWithdrawInstructionAsync({...x,participant:x.capital,quoteMint:mint.address,userToken:x.token.address,amount:450_000_000n})],[x.owner]);
  await h.send('mint trader test collateral',[getMintToInstruction({mint:mint.address,token:token.address,mintAuthority:payer,amount:100_000_000n})]);
  const cash={...a,owner,participant:trader,quoteMint:mint.address,userToken:token.address};
  await h.send('deposit actual trader collateral',[await sdk.getDepositInstructionAsync({...cash,amount:60_000n})],[owner]);
  await h.send('reject test route activation without venue authority',[await sdk.getInitializeTestRoutesInstructionAsync({...a,authority:owner,reference:60_000n,duration:3600n})],[owner],2001);
  await h.send('activate explicit synthetic expiring risk profile',[await sdk.getInitializeTestRoutesInstructionAsync({...a,authority:payer,reference:60_000n,duration:3600n})]);
  const publish=async(reference:bigint,duration=3600n)=>h.send(`publish synthetic reference ${reference}`,[await sdk.getPublishTestRiskInstructionAsync({...a,authority:payer,reference,duration})]);
  async function input(side:number,alloc:[number,bigint][]) {
    const m=await market(),r=await risk(),t=await balance(),slot=await h.slot();
    const rs=await Promise.all(alloc.map(([id])=>reg(id)));
    const ps=await Promise.all(alloc.map(([id])=>balance(makers[id].capital)));
    // Independent enumerated marginal prices, deliberately not quoteMaker or the route allocator.
    const gross=alloc.map(([id,n],i)=>{let sum=0n;const consumed=side===0?rs[i].buyConsumed:rs[i].sellConsumed;
      for(let j=0n;j<n;j++){const index=consumed+j,spread=id===0?10n+index:30n+(index>256n?index-256n:0n);
        const center=r.referencePrice-(id===0?ps[i].lots/64n*4n:ps[i].lots/256n);sum+=side===0?center+spread:center-spread;}return sum;});
    const total=gross.reduce((s,x)=>s+x,0n),fee=(total+4999n)/5000n;
    const first=makers[alloc[0][0]],second=alloc.length===2?makers[alloc[1][0]]:null;
    const args={...a,owner,trader,routeState,firstCapital:first.capital,firstRegistration:first.registration,firstProgram:first.pricingProgram,firstProgramData:first.programData,firstConfig:first.config,
      secondCapital:second?.capital??undefined,secondRegistration:second?.registration??undefined,secondProgram:second?.pricingProgram??undefined,secondProgramData:second?.programData??undefined,secondConfig:second?.config??undefined,
      domain:m.domain,termsEpoch:m.termsEpoch,configEpoch:m.configEpoch,observationSequence:r.observationSequence,nonce:t.nonce,startSlot:slot,expirySlot:slot+150n,
      side,lots:alloc.reduce((s,x)=>s+x[1],0n),allInLimit:side===0?total+fee:total-fee,maxFee:fee,reduceOnly:false,generation:null as bigint|null,
      legs:alloc.map(([,lots],i)=>({lots,quoteEpoch:rs[i].quoteEpoch,authorityEpoch:rs[i].authorityEpoch}))};
    return {args,gross,total,fee,m,r,t,rs,ps};
  }
  async function reconcile() {
    const m=await market(),r=await risk(),ps=await Promise.all([trader,...makers.map(x=>x.capital)].map(k=>balance(k)));
    assert.equal(ps.reduce((s,p)=>s+p.cash,0n),m.totalCash);
    assert.equal(ps.reduce((s,p)=>s+p.lots,0n),0n);
    assert.equal(ps.reduce((s,p)=>s+p.lots*r.referencePrice*scale+p.virtualScaled,0n),m.settlement*scale);
    assert.equal(ps.reduce((s,p)=>s+abs(p.lots),0n),r.grossLots);
    const v=getTokenDecoder().decode((await h.read(a.vault))!);
    assert.equal(v.amount,m.allocatedVault);assert.equal(v.amount,m.totalCash+m.settlement+m.insurance+m.fees);
    return {market:m,risk:r,participants:ps,vault:v.amount};
  }
  const fills:any[]=[];
  async function fill(label:string,side:number,alloc:[number,bigint][],extra:Partial<Awaited<ReturnType<typeof input>>['args']>={}) {
    const v=await input(side,alloc),args={...v.args,...extra},ix=await sdk.getExecuteRouteInstructionAsync(args);
    await h.send(label,[sdk.routeComputeBudget(),ix],[owner]);
    const t=await balance(),sign=side===0?1n:-1n,q=v.t.lots+sign*args.lots;
    const generation=v.t.generation+BigInt(v.t.lots!==q&&(v.t.lots===0n||q===0n||(v.t.lots>0n)!==(q>0n)));
    assert.equal(t.lots,q);assert.equal(t.virtualScaled,v.t.virtualScaled-sign*v.total*scale);assert.equal(t.cash,v.t.cash-v.fee);
    assert.equal(t.nonce,v.t.nonce+1n);assert.equal(t.generation,generation);
    for(let i=0;i<alloc.length;i++) {const [id,n]=alloc[i],p=await balance(makers[id].capital),r=await reg(id);
      assert.equal(p.lots,v.ps[i].lots-sign*n);assert.equal(p.virtualScaled,v.ps[i].virtualScaled+sign*v.gross[i]*scale);assert.equal(p.cash,v.ps[i].cash);
      assert.equal(side===0?r.buyConsumed:r.sellConsumed,(side===0?v.rs[i].buyConsumed:v.rs[i].sellConsumed)+n);}
    assert.equal((await market()).fees,v.m.fees+v.fee);assert.equal((await market()).totalCash,v.m.totalCash-v.fee);
    await reconcile();fills.push({label,side,allocation:alloc,gross:v.total,fee:v.fee});return ix;
  }
  await rejected('trader cannot use cash below post-fee adverse IM',await sdk.getExecuteRouteInstructionAsync((await input(0,[[0,10n]])).args),6120);
  await h.send('fund remaining trader margin by real deposit',[await sdk.getDepositInstructionAsync({...cash,amount:99_940_000n})],[owner]);
  const reverted=await sdk.getExecuteRouteInstructionAsync((await input(0,[[0,1n],[1,1n]])).args),beforeReverted=await snapshot();
  await h.send('later instruction rolls back emitted route and all financial state',[sdk.routeComputeBudget(),reverted,reverted],[owner],6117);
  assert.deepEqual(await snapshot(),beforeReverted);
  const v=await input(0,[[0,21n],[1,79n]]);
  assert.equal(v.total,6_002_790n);assert(v.total<6_003_000n && v.total<6_005_950n,'price beneficial vs both complete single-maker fills');
  const old=await fill('price-beneficial split, aggregate fee once',0,[[0,21n],[1,79n]]);
  await rejected('reject replayed signed economic nonce',old,6117);
  await rejected('reject missing maker accounts for two legs',await sdk.getExecuteRouteInstructionAsync({...v.args,nonce:1n,secondCapital:undefined}),6117);
  const stale=await input(0,[[0,10n]]);
  await fill('consume current A prefix',0,[[0,10n]]);
  await rejected('reject stale price after another fill consumes prefix',await sdk.getExecuteRouteInstructionAsync({...stale.args,nonce:2n}),6119);
  const base=await input(0,[[0,1n],[1,1n]]);
  for(const [label,patch,error] of [
    ['wrong domain',{domain:new Uint8Array(32)},6117],['wrong terms',{termsEpoch:99n},6117],['wrong config',{configEpoch:99n},6117],
    ['wrong observation',{observationSequence:99n},6118],['wrong nonce',{nonce:99n},6117],['future start',{startSlot:base.args.startSlot+100n,expirySlot:base.args.startSlot+150n},6117],
    ['exclusive expiry',{startSlot:0n,expirySlot:1n},6117],['oversized route',{lots:4609n},6117],['inexact FOK sum',{lots:3n},6117],
    ['fee budget',{maxFee:0n},6119],['all-in buy limit',{allInLimit:base.args.allInLimit-1n},6119],
    ['old generation',{generation:0n},6117],['risk-increasing reduce-only',{reduceOnly:true,generation:1n},6117],
  ] as const) await rejected(`reject ${label}`,await sdk.getExecuteRouteInstructionAsync({...base.args,...patch}),error);
  await rejected('reject owner mismatch',await sdk.getExecuteRouteInstructionAsync({...base.args,owner:payer}),2006,[]);
  await rejected('reject same maker/capital twice',await sdk.getExecuteRouteInstructionAsync({...base.args,secondCapital:makers[0].capital,secondRegistration:makers[0].registration,secondProgram:makers[0].pricingProgram,secondProgramData:makers[0].programData,secondConfig:makers[0].config}), 'reject');
  await rejected('reject trader as maker capital',await sdk.getExecuteRouteInstructionAsync({...base.args,firstCapital:trader}),'reject');
  await rejected('reject wrong bound maker config',await sdk.getExecuteRouteInstructionAsync({...base.args,secondConfig:makers[0].config}),6110);
  await rejected('second maker stale epoch rolls back complete route',await sdk.getExecuteRouteInstructionAsync({...base.args,legs:[base.args.legs[0],{...base.args.legs[1],quoteEpoch:99n}]}),6112);
  const beforeQuarantine=await input(0,[[0,1n],[1,1n]]);
  await h.send('quarantine second route maker',[await sdk.getQuarantineMakerInstructionAsync({...makers[1],authority:payer})]);
  await rejected('second maker quarantine rolls back complete route',await sdk.getExecuteRouteInstructionAsync(beforeQuarantine.args),6113);
  await h.send('jointly restore B standing authority',[await sdk.getApproveMakerInstructionAsync({...makers[1],authority:payer})],[makers[1].owner]);
  await rejected('old second-maker authority after approval',await sdk.getExecuteRouteInstructionAsync(beforeQuarantine.args),6112);
  await rejected('withdrawal remains disabled in test trading mode',await sdk.getWithdrawInstructionAsync({...cash,amount:1n}),6108);
  // Cross-maker close retains an unpaid claim; no settlement cash is fabricated.
  const position=await balance();
  await fill('reduce-only cross-maker close with generation',1,[[1,110n]],{reduceOnly:true,generation:position.generation});
  assert.equal((await balance()).lots,0n);assert.notEqual((await balance()).virtualScaled,0n);
  await rejected('old protection cannot reopen flat exposure',await sdk.getExecuteRouteInstructionAsync({...((await input(1,[[1,1n]])).args),reduceOnly:true,generation:position.generation}),6117);
  await fill('split required by size beyond either single maker',0,[[0,100n],[1,3997n]]);
  await rejected('current consumed capacity cannot be reused',await sdk.getExecuteRouteInstructionAsync((await input(0,[[1,21n]])).args),6115);
  await publish(100_000n);
  await rejected('post-fill maker health rejects after index change',await sdk.getExecuteRouteInstructionAsync((await input(1,[[1,1n]])).args),6120);
  await publish(60_000n);
  // A real transfer strengthens an exposed participant without changing q/v.
  const prior=await balance();await h.send('deposit while exposed',[await sdk.getDepositInstructionAsync({...cash,amount:1n})],[owner]);assert.equal((await balance()).lots,prior.lots);
  // Close the actual inventory before refreshing epochs; B sell depth requires a fresh epoch.
  await renew(0);await renew(1);await publish(60_000n);
  await fill('close real positions through two makers',1,[[0,131n],[1,3966n]]);
  assert.equal((await balance()).lots,0n);
  await fill('maximum 4608-lot route with both complete depths',0,[[0,512n],[1,4096n]]);
  await rejected('no residual cheap A liquidity after full depth',await sdk.getExecuteRouteInstructionAsync((await input(0,[[0,1n]])).args),6115);
  await publish(10_000n);
  await rejected('index-derived execution band rejects deep sell terms',await sdk.getExecuteRouteInstructionAsync((await input(1,[[1,10n]])).args),6119);
  await publish(60_000n);
  // Hostile deployment uses the real fixed B identity and actual joint approval.
  const approvedBefore=await input(1,[[0,1n],[1,1n]]);
  await h.replaceMaker(true);
  await rejected('unapproved hostile binary rejects before CPI',await sdk.getExecuteRouteInstructionAsync(approvedBefore.args),6114);
  await h.send('jointly approve hostile fixture for adversarial qualification',[await sdk.getApproveMakerInstructionAsync({...makers[1],authority:payer})],[makers[1].owner]);
  for(const [n,error,label] of [[1n,6116,'wrong gross return'],[2n,6116,'oversized return'],[3n,'reject','read-only config write'],[4n,6000,'explicit second CPI rejection']] as const)
    await rejected(`hostile ${label}: no venue residue`,await sdk.getExecuteRouteInstructionAsync((await input(1,[[0,1n],[1,n]])).args),error);
  await h.replaceMaker(false);
  await h.send('jointly reapprove restored B binary',[await sdk.getApproveMakerInstructionAsync({...makers[1],authority:payer})],[makers[1].owner]);
  // Risk observations expire using real slots on RPC, never a worker-supplied validity flag.
  await publish(60_000n,64n);await h.waitUntil((await risk()).validUntil);
  await rejected('expired observation rejects execution',await sdk.getExecuteRouteInstructionAsync((await input(1,[[0,1n]])).args),6118);
  await publish(60_000n);
  await fill('restored valid route after hostile and stale-source failures',1,[[0,1n],[1,1n]]);
  return {fills,final:await reconcile()};
}
