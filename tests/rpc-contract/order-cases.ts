import assert from 'node:assert/strict';
import {AccountRole,type Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {fixtureKey} from './custody-cases.js';
import {oracleSetup,type OracleHarness} from './oracle-cases.js';
import {feedAddress,publishFeed,type SourceChange} from './oracle-fixture.js';
export type OrderSetup=Awaited<ReturnType<typeof oracleSetup>>;
export async function orderTools(h:OracleHarness,a:OrderSetup){
  const market=async()=>sdk.getMarketStateDecoder().decode((await h.read(a.market))!);
  const risk=async()=>sdk.getTestRouteStateDecoder().decode((await h.read(a.routeState))!);
  const participant=async(key=a.trader)=>sdk.getParticipantDecoder().decode((await h.read(key))!);
  async function sample(price=60_000n,changes:Record<number,SourceChange>={}){
    await h.waitTime((await risk()).oracle.sampledAt+2n);const time=await h.now();
    await h.send('publish actual signed order trigger sources',await Promise.all([0,1,2,3].map(i=>publishFeed(i,time,{...(i%2===0?{price:price*1_000_000n}:{}),...changes[i]}))),[a.primary,a.guardKey]);
    const f=await Promise.all([0,1,2,3].map(feedAddress)),[x,y]=a.makers;
    await h.send('validate current index and funding for orders',[sdk.fundingComputeBudget(),await sdk.getSampleOracleInstructionAsync({...a,primaryBtc:f[0].feed,primaryCollateral:f[1].feed,guardBtc:f[2].feed,guardCollateral:f[3].feed,
      firstCapital:x.capital,firstRegistration:x.registration,firstProgram:x.pricingProgram,firstProgramData:x.programData,firstConfig:x.config,
      secondCapital:y.capital,secondRegistration:y.registration,secondProgram:y.pricingProgram,secondProgramData:y.programData,secondConfig:y.config})]);
  }
  async function recover(price=60_000n){for(let i=0;i<4;i++)await sample(price);assert.equal((await risk()).oracle.status,2);}
  async function terms(overrides:Partial<sdk.OrderTerms>={}):Promise<sdk.OrderTerms>{const slot=await h.slot();return{side:0,lots:10n,limit:66_000n,feeBudget:1000n,startSlot:slot,expirySlot:slot+3600n,trigger:0,threshold:0n,reduceOnly:false,generation:0n,...overrides};}
  async function place(label:string,t:Partial<sdk.OrderTerms>={}){const p=await participant(),id=p.book.lastOrderId+1n;
    await h.send(label,[await sdk.getPlaceOrderInstructionAsync({...a,owner:a.owner,participant:a.trader,expectedId:id,terms:await terms(t)})],[a.owner]);return id;}
  const order=async(id:bigint)=>(await participant()).book.orders.find(o=>o.id===id)!;
  async function cancelIx(id:bigint,version?:bigint,owner=a.owner){return sdk.getCancelOrderInstructionAsync({...a,owner,participant:a.trader,id,version:version??(await order(id)).version});}
  async function cancel(id:bigint,label='owner cancellation releases remaining reservation'){await h.send(label,[await cancelIx(id)],[a.owner]);}
  async function fillIx(id:bigint,lots:bigint,maker=0,keeper=a.payer,overrides:Record<string,any>={}){
    const o=await order(id),r=await risk(),slot=await h.slot(),x=a.makers[maker],reg=sdk.getMakerRegistrationDecoder().decode((await h.read(x.registration))!);
    return sdk.getExecuteOrderInstructionAsync({...a,keeper,trader:a.trader,firstCapital:x.capital,firstRegistration:x.registration,firstProgram:x.pricingProgram,firstProgramData:x.programData,firstConfig:x.config,
      id,version:o.version,filled:o.filled,observationSequence:r.observationSequence,startSlot:slot,expirySlot:slot+150n,lots,legs:[{lots,quoteEpoch:reg.quoteEpoch,authorityEpoch:reg.authorityEpoch}],...overrides});
  }
  const financialKeys=[a.market,a.routeState,a.trader,a.vault,a.guard,a.registry,a.token.address,...a.makers.flatMap(x=>[x.capital,x.registration])];
  async function rejected(label:string,ix:Instruction,signers:Keypair[]=[],error:number|'reject'=6125){
    const before=await Promise.all(financialKeys.map(k=>h.read(k)));
    await h.send(label,[sdk.routeComputeBudget(),ix],signers,error);
    assert.deepEqual(await Promise.all(financialKeys.map(k=>h.read(k))),before,`${label}: no state residue`);
  }
  async function fill(id:bigint,lots:bigint,label='permissionless keeper executes exact stored partial',maker=0){
    const before=await participant(),o=await order(id),x=a.makers[maker],capital=await participant(x.capital),reg=sdk.getMakerRegistrationDecoder().decode((await h.read(x.registration))!),r=await risk();
    let gross=0n;const consumed=o.side===0?reg.buyConsumed:reg.sellConsumed;
    for(let k=0n;k<lots;k++){
      const offset=consumed+k,spread=maker===0?10n+offset:30n+(offset>256n?offset-256n:0n);
      const center=r.referencePrice-(maker===0?capital.lots/64n*4n:capital.lots/256n);
      gross+=o.side===0?center+spread:center-spread;
    }
    const fee=(o.notional+gross+4999n)/5000n-o.feeCharged;
    await h.send(label,[sdk.routeComputeBudget(),await fillIx(id,lots,maker)]);
    const after=await participant(),done=await order(id),m=await market(),sign=o.side===0?1n:-1n;
    assert.equal(after.cash,before.cash-fee);assert.equal(after.lots,before.lots+sign*lots);
    assert.equal(after.virtualScaled,before.virtualScaled-before.lots*(m.fundingIndexScaled-before.fundingCheckpointScaled)-sign*gross*1_000_000_000n);
    assert.equal(done.notional,o.notional+gross);assert.equal(done.feeCharged,o.feeCharged+fee);assert.equal(done.filled,o.filled+lots);assert.equal(done.version,o.version);
    return {gross,fee};
  }
  async function manual(side:number,lots:bigint,reduceOnly=false){const m=await market(),r=await risk(),p=await participant(),x=a.makers[1],reg=sdk.getMakerRegistrationDecoder().decode((await h.read(x.registration))!),slot=await h.slot();
    await h.send('wallet immediate trade preserves existing order constraints',[sdk.routeComputeBudget(),await sdk.getExecuteRouteInstructionAsync({...a,owner:a.owner,trader:a.trader,firstCapital:x.capital,firstRegistration:x.registration,firstProgram:x.pricingProgram,firstProgramData:x.programData,firstConfig:x.config,
      domain:m.domain,termsEpoch:m.termsEpoch,configEpoch:m.configEpoch,observationSequence:r.observationSequence,nonce:p.nonce,startSlot:slot,expirySlot:slot+150n,side,lots,maxFee:1_000_000n,allInLimit:side===0?1_000_000_000n:0n,reduceOnly,generation:p.generation,legs:[{lots,quoteEpoch:reg.quoteEpoch,authorityEpoch:reg.authorityEpoch}]})],[a.owner]);}
  async function flat(){const p=await participant();if(p.lots!==0n)await manual(p.lots>0n?1:0,p.lots<0n?-p.lots:p.lots,true);}
  async function certify(){const m=await market(),r=await risk(),reg=sdk.getParticipantRegistryDecoder().decode((await h.read(a.registry))!);
    const ix=await sdk.getCheckExitCohortInstructionAsync({...a,sequence:m.sequence,observation:r.observationSequence,start:0});
    await h.send('complete actual cohort before reserved cash withdrawal',[{...ix,accounts:[...ix.accounts,...reg.members.map(address=>({address,role:AccountRole.READONLY}))]}]);}
  async function withdrawIx(amount:bigint){const m=await market(),r=await risk();return sdk.getWithdrawTradingInstructionAsync({...a,owner:a.owner,participant:a.trader,quoteMint:a.mint.address,userToken:a.token.address,sequence:m.sequence,observation:r.observationSequence,amount});}
  return {market,risk,participant,sample,recover,terms,place,order,cancelIx,cancel,fillIx,rejected,fill,manual,flat,certify,withdrawIx};
}
export async function orderCases(h:OracleHarness,a:OrderSetup){
  const t=await orderTools(h,a);await t.recover();
  for(const bad of [{lots:0n},{lots:4609n},{limit:8999n},{limit:110001n},{feeBudget:1000001n},{trigger:3},{trigger:1,threshold:9999n},{reduceOnly:true,generation:0n},{generation:1n}]){
    await t.rejected('invalid authorization terms reject atomically',await sdk.getPlaceOrderInstructionAsync({...a,owner:a.owner,participant:a.trader,expectedId:(await t.participant()).book.lastOrderId+1n,terms:await t.terms(bad)}),[a.owner],6126);
  }
  const nowSlot=await h.slot();
  await t.rejected('maximum lifetime cannot be exceeded',await sdk.getPlaceOrderInstructionAsync({...a,owner:a.owner,participant:a.trader,expectedId:1n,terms:await t.terms({startSlot:nowSlot,expirySlot:nowSlot+216001n})}),[a.owner],6126);
  let bound=await t.place('future start remains reserved but cannot execute',{startSlot:nowSlot+10n});await t.rejected('inclusive start has not arrived',await t.fillIx(bound,1n));await t.cancel(bound);
  bound=await t.place('all-in bound includes trading fee',{lots:1n,limit:60010n});await t.rejected('gross price alone does not meet all-in bound',await t.fillIx(bound,1n),[],6119);await t.cancel(bound);
  bound=await t.place('lifetime fee budget is enforced',{lots:2n,feeBudget:13n});await t.fill(bound,1n,'consume a bounded lifetime fee authorization',1);await t.rejected('remaining fee budget cannot be exceeded',await t.fillIx(bound,1n,1),[],6119);await t.cancel(bound);await t.flat();
  const p0=await t.participant();const id=await t.place('place durable independently reserved limit');
  // 10*(6060 IM + 6600 worst loss) + 1000 lifetime fee authorization.
  assert.equal((await t.participant()).reserved,127600n);
  const cancelledAfterPartial=await t.cancelIx(id);
  const first=await t.fill(id,1n);assert.deepEqual(first,{gross:60010n,fee:13n});assert.equal((await t.order(id)).state,2);
  assert.equal((await t.participant()).reserved,114927n);
  const beforeReplace=await t.order(id),oldCancel=await t.cancelIx(id);
  await h.send('replacement preserves executed notional fee and quantity prefix',[await sdk.getReplaceOrderInstructionAsync({...a,owner:a.owner,participant:a.trader,id,version:1n,terms:await t.terms({lots:12n,limit:65_000n,feeBudget:2000n})})],[a.owner]);
  assert.equal((await t.order(id)).version,2n);assert.equal((await t.order(id)).notional,beforeReplace.notional);
  await t.rejected('old cancel cannot cancel replacement',oldCancel,[a.owner]);
  const second=await t.fill(id,1n);assert.deepEqual(second,{gross:60011n,fee:12n});assert.equal((await t.order(id)).feeCharged,25n);
  await t.cancel(id);assert.equal((await t.participant()).reserved,0n);
  await t.rejected('cancel from before replacement cannot resurrect authority',cancelledAfterPartial,[a.owner]);
  let n=await t.place('fresh order for partial then cancel');const cancel=await t.cancelIx(n);await t.fill(n,2n);const pendingFill=await t.fillIx(n,1n);
  await h.send('pre-signed cancel remains valid after partial fill',[cancel],[a.owner]);await t.rejected('cancel wins against later subfill',pendingFill);
  n=await t.place('reverse cancel/fill race');const firstFill=await t.fillIx(n,1n);await t.cancel(n);await t.rejected('cancel before first fill leaves no effect',firstFill);
  n=await t.place('cancel before replace');const replace=await sdk.getReplaceOrderInstructionAsync({...a,owner:a.owner,participant:a.trader,id:n,version:1n,terms:await t.terms({lots:20n})});await t.cancel(n);await t.rejected('cancel before replace cannot revive order',replace,[a.owner]);
  n=await t.place('duplicate keepers share one consumed prefix');const attacker=await fixtureKey('attacker');const duplicate=await t.fillIx(n,1n,0,attacker);await t.fill(n,1n);await t.rejected('different keeper cannot replay previous prefix',duplicate,[attacker]);
  await t.rejected('remaining authority cannot be overfilled',await t.fillIx(n,10n));await t.rejected('foreign owner cannot cancel',await t.cancelIx(n,1n,attacker),[attacker],'reject');await t.cancel(n);
  const reused=await t.place('terminal slot reuses storage with fresh monotonic identity');assert(reused>n);await t.rejected('old identity cannot target reused slot',await t.cancelIx(n,1n),[a.owner]);await t.cancel(reused);
  await t.flat();
  n=await t.place('remaining reservation protects withdraw before fill');await t.certify();const cash=(await t.participant()).cash,reserved=(await t.participant()).reserved;
  await t.rejected('withdraw cannot spend remaining order reserve',await t.withdrawIx(cash-reserved+1n),[a.owner],6100);
  const afterWithdrawFill=await t.fillIx(n,1n);await h.send('withdraw first retains conservative fill capacity',[await t.withdrawIx(1n)],[a.owner]);await h.send('stored fill after withdrawal rechecks remaining health',[sdk.routeComputeBudget(),afterWithdrawFill]);await t.cancel(n);
  n=await t.place('fill invalidates pre-signed withdrawal snapshot');await t.certify();const staleWithdraw=await t.withdrawIx(1n);await t.fill(n,1n);await t.rejected('fill wins withdrawal race by market sequence',staleWithdraw,[a.owner],6122);await t.cancel(n);await t.flat();
  // Four slots are a real on-chain bound; no alias slot or hidden fifth authority.
  const slots=[];for(let i=0;i<4;i++)slots.push(await t.place('reserve one of four bounded slots',{lots:1n}));
  await t.rejected('fifth persistent slot rejected',await sdk.getPlaceOrderInstructionAsync({...a,owner:a.owner,participant:a.trader,expectedId:(await t.participant()).book.lastOrderId+1n,terms:await t.terms({lots:1n})}),[a.owner],6127);
  await t.fill(slots[0],1n,'fill with all four bounded order records populated');
  assert.equal((await t.participant()).orderIds.filter(x=>x>0n).length,3);
  for(const o of slots.slice(1))await t.cancel(o);await t.flat();
  const resourceOrders=[];for(let i=0;i<3;i++)resourceOrders.push(await t.place('populate trader resource fixture',{lots:1n}));
  const resourceMakerOrders:{maker:typeof a.makers[number];id:bigint}[]=[];
  for(const maker of a.makers)for(let i=0;i<4;i++){const p=await t.participant(maker.capital),id=p.book.lastOrderId+1n;resourceMakerOrders.push({maker,id});
    await h.send('populate maker order resource fixture',[await sdk.getPlaceOrderInstructionAsync({...a,owner:maker.owner,participant:maker.capital,expectedId:id,terms:await t.terms({lots:1n})})],[maker.owner]);}
  n=await t.place('persisted exact 600-lot split authority',{lots:600n,feeBudget:20000n});
  const secondMaker=a.makers[1],secondReg=sdk.getMakerRegistrationDecoder().decode((await h.read(secondMaker.registration))!),firstReg=sdk.getMakerRegistrationDecoder().decode((await h.read(a.makers[0].registration))!);
  const split={secondCapital:secondMaker.capital,secondRegistration:secondMaker.registration,secondProgram:secondMaker.pricingProgram,secondProgramData:secondMaker.programData,secondConfig:secondMaker.config,
    legs:[{lots:100n,quoteEpoch:firstReg.quoteEpoch,authorityEpoch:firstReg.authorityEpoch},{lots:500n,quoteEpoch:secondReg.quoteEpoch,authorityEpoch:secondReg.authorityEpoch}]};
  await t.rejected('failed second leg leaves stored prefix and both makers unchanged',await t.fillIx(n,600n,0,a.payer,{...split,legs:[split.legs[0],{...split.legs[1],quoteEpoch:secondReg.quoteEpoch+1n}]}),[],6112);
  let splitGross=0n;const splitRisk=await t.risk();
  for(const [maker,lots]of [[0,100n],[1,500n]]as const){const cap=await t.participant(a.makers[maker].capital),reg=maker===0?firstReg:secondReg;
    for(let j=0n;j<lots;j++){const k=reg.buyConsumed+j;splitGross+=splitRisk.referencePrice-(maker===0?cap.lots/64n*4n:cap.lots/256n)+(maker===0?10n+k:30n+(k>256n?k-256n:0n));}}
  await h.send('both maker legs commit one stored economic fee prefix',[sdk.routeComputeBudget(),await t.fillIx(n,600n,0,a.payer,split)]);
  assert.equal((await t.order(n)).notional,splitGross);assert.equal((await t.order(n)).feeCharged,(splitGross+4999n)/5000n);assert.equal((await t.order(n)).state,3);await t.flat();
  for(const id of resourceOrders)await t.cancel(id);
  for(const {maker,id}of resourceMakerOrders)await h.send('release maker resource fixture',[await sdk.getCancelOrderInstructionAsync({...a,owner:maker.owner,participant:maker.capital,id,version:1n})],[maker.owner]);
  n=await t.place('standalone stop-limit is not permanently triggered',{lots:2n,trigger:1,threshold:61_000n});await t.rejected('unmet central trigger rejects even executable price',await t.fillIx(n,1n),[],6128);
  await t.sample(61_000n);await t.fill(n,1n);await t.sample(60_000n);await t.rejected('trigger is re-evaluated after a partial',await t.fillIx(n,1n),[],6128);await t.cancel(n);await t.flat();
  // Each pair has two economic fee prefixes, one shared exposure allowance.
  async function protection(){const p=await t.participant(),start=await h.slot(),id=p.book.lastOrderId+1n;const common={side:1,lots:10n,reduceOnly:true,generation:p.generation,startSlot:start,expirySlot:start+3600n,limit:54_000n,feeBudget:1000n};
    await h.send('place existing-position TP/SL pair',[await sdk.getPlaceProtectionInstructionAsync({...a,owner:a.owner,participant:a.trader,expectedId:id,tp:await t.terms({...common,trigger:1,threshold:61_000n}),sl:await t.terms({...common,trigger:2,threshold:59_000n})})],[a.owner]);return [id,id+1n] as const;}
  await t.manual(0,10n);let [tp,sl]=await protection();await t.sample(61_000n);await t.fill(tp,4n,'partial TP consumes shared group allowance');const tpGroup=(await t.order(tp)).groupId;assert.equal((await t.participant()).book.groups.find(g=>g.id===tpGroup)?.remaining,6n);
  await t.sample(59_000n);await t.rejected('SL cannot exceed TP-clipped allowance',await t.fillIx(sl,7n));await t.fill(sl,6n,'SL consumes only the remaining six lots');assert.equal((await t.participant()).lots,0n);assert.equal((await t.order(tp)).state,6);
  await t.sample();await t.manual(0,10n);[tp,sl]=await protection();await t.sample(59_000n);await t.fill(sl,4n,'SL first clips TP in reverse race ordering');await t.sample(61_000n);await t.fill(tp,6n,'TP consumes remaining allowance after SL');assert.equal((await t.participant()).lots,0n);
  await t.sample();await t.manual(0,10n);[tp,sl]=await protection();await t.cancel(tp,'cancel one protection child preserves sibling');assert([1,2].includes((await t.order(sl)).state));
  await t.manual(1,6n,true);await t.manual(0,2n);await t.sample(59_000n);await t.rejected('manual reduction clips current allowance without reverse exposure',await t.fillIx(sl,7n));await t.fill(sl,3n);await t.flat();
  const oldGeneration=(await t.order(sl)).generation;await t.manual(0,10n);assert.notEqual((await t.participant()).generation,oldGeneration);await t.rejected('old SL cannot revive after close/reopen',await t.fillIx(sl,1n));await t.flat();
  await t.sample();await t.manual(0,10n);[tp,sl]=await protection();const currentGroup=(await t.order(tp)).groupId;const group=(await t.participant()).book.groups.find(g=>g.id===currentGroup)!;
  const groupCancel=await sdk.getCancelProtectionInstructionAsync({...a,owner:a.owner,participant:a.trader,groupId:group.id,version:group.version});
  const old=await t.order(sl);await h.send('protective replacement preserves allowance and advances group version',[await sdk.getReplaceOrderInstructionAsync({...a,owner:a.owner,participant:a.trader,id:sl,version:old.version,terms:await t.terms({side:old.side,lots:old.lots,limit:old.limit,feeBudget:old.feeBudget,trigger:old.trigger,threshold:old.threshold,reduceOnly:true,generation:old.generation})})],[a.owner]);
  await t.rejected('stale group cancel cannot erase replaced protection',groupCancel,[a.owner]);
  await h.send('current group cancel atomically releases both children',[await sdk.getCancelProtectionInstructionAsync({...a,owner:a.owner,participant:a.trader,groupId:group.id,version:group.version+1n})],[a.owner]);await t.flat();
  await t.sample();await t.manual(1,10n);{
    const p=await t.participant(),id=p.book.lastOrderId+1n,start=await h.slot();const common={side:0,lots:10n,reduceOnly:true,generation:p.generation,startSlot:start,expirySlot:start+3600n,limit:66000n,feeBudget:1000n};
    await h.send('short position protection uses reversed trigger directions',[await sdk.getPlaceProtectionInstructionAsync({...a,owner:a.owner,participant:a.trader,expectedId:id,tp:await t.terms({...common,trigger:2,threshold:59000n}),sl:await t.terms({...common,trigger:1,threshold:61000n})})],[a.owner]);
    await t.sample(59000n);await t.fill(id,4n);await t.sample(61000n);await t.rejected('short SL cannot reverse exposure',await t.fillIx(id+1n,7n));await t.fill(id+1n,6n);assert.equal((await t.participant()).lots,0n);
  }
  await t.sample();
  // Funding must revalue maker-owned reservations at the NEW source bounds.
  const maker=a.makers[0],makerIds:bigint[]=[];
  for(let i=0;i<4;i++){const p=await t.participant(maker.capital),id=p.book.lastOrderId+1n;makerIds.push(id);
    await h.send('maker capital reserves its own independent stored intent',[await sdk.getPlaceOrderInstructionAsync({...a,owner:maker.owner,participant:maker.capital,expectedId:id,terms:await t.terms({lots:4608n})})],[maker.owner]);}
  await t.sample(10_000n);assert.equal((await t.risk()).oracle.status,1);assert.equal((await t.risk()).oracle.heldUntil,0n);
  for(const id of makerIds)await h.send('maker cancellation releases authority despite invalid funding coverage',[await sdk.getCancelOrderInstructionAsync({...a,owner:maker.owner,participant:maker.capital,id,version:1n})],[maker.owner]);
  await t.recover();
  n=await t.place('cancellation remains independent of failed sources');await t.sample(60_000n,{0:{level:1}});assert.equal((await t.risk()).oracle.status,0);await t.cancel(n,'direct cancellation succeeds without oracle or maker pricing');await t.recover();
  const expiry=(await h.slot())+64n;n=await t.place('exclusive expiry authority',{lots:1n,expirySlot:expiry});await h.waitUntil(expiry);
  await t.rejected('exact expiry slot excludes execution',await t.fillIx(n,1n));await h.send('permissionless terminal cleanup releases expired reserve',[await sdk.getCleanupOrdersInstructionAsync({...a,participant:a.trader})]);assert.equal((await t.order(n)).state,5);assert.equal((await t.participant()).reserved,0n);
  const m=await t.market(),ps=await Promise.all([a.trader,...a.makers.map(x=>x.capital)].map(k=>t.participant(k)));
  assert.equal(ps.reduce((n,p)=>n+p.cash,0n),m.totalCash);assert.equal(ps.reduce((n,p)=>n+p.lots,0n),0n);assert.equal(ps.reduce((n,p)=>n+p.virtualScaled+p.lots*p.fundingCheckpointScaled,0n),m.settlement*1_000_000_000n);
  assert((await t.participant()).book.lastOrderId>20n);assert.equal((await t.participant()).cash<p0.cash,true);
  return {market:m,participants:ps};
}
