import assert from 'node:assert/strict';
import {AccountRole,type Instruction} from '@solana/kit';
import {getCreateAccountInstruction,getTransferSolInstruction} from '@solana-program/system';
import {TOKEN_PROGRAM_ADDRESS,getInitializeAccount3Instruction,getMintToInstruction,getTokenDecoder} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {addresses,fixtureKey,payerKey} from './custody-cases.js';
import {makerAddresses,type MakerHarness} from './maker-cases.js';
import {feedAddress,initializeFeed,publishFeed,type SourceChange} from './oracle-fixture.js';
export type OracleHarness=MakerHarness & {now():Promise<bigint>;waitTime(time:bigint):Promise<void>};
export async function oracleSetup(h:OracleHarness,makerDuration=3600n){
  const a=await addresses(),payer=await payerKey(),mint=await fixtureKey('mint'),owner=await fixtureKey('trader'),token=await fixtureKey('user-token');
  const makers=await Promise.all([0,1].map(makerAddresses)),[trader]=await sdk.findParticipantPda({market:a.market,owner:owner.address}),[routeState]=await sdk.findRouteStatePda({market:a.market}),[guard]=await sdk.findGuardPda({market:a.market});
  const m=sdk.getMarketStateDecoder().decode((await h.read(a.market))!);
  for(const [id,x]of makers.entries()){
    await h.send(`P07 provision actual maker ${id} collateral`,[getTransferSolInstruction({source:payer,destination:x.owner.address,amount:1_000_000_000n}),await sdk.getRegisterParticipantInstructionAsync({...a,owner:x.owner}),getCreateAccountInstruction({payer,newAccount:x.token,lamports:await h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),getInitializeAccount3Instruction({account:x.token.address,mint:mint.address,owner:x.owner.address}),getMintToInstruction({mint:mint.address,token:x.token.address,mintAuthority:payer,amount:500_000_000n})],[x.owner,x.token]);
    await h.send(`P07 initialize maker ${id} curve`,[await (id===0?sdk.makerA:sdk.makerB).getInitializeConfigInstructionAsync({...x,domain:m.domain,duration:makerDuration}),await sdk.getDepositInstructionAsync({...x,participant:x.capital,quoteMint:mint.address,userToken:x.token.address,amount:500_000_000n})],[x.owner]);
    await h.send(`P07 bind maker ${id}`,[await sdk.getRegisterMakerInstructionAsync({...x,authority:payer,makerId:id,inventoryLimit:100_000n})],[x.owner]);
  }
  await h.send('P07 fund trader and initialize risk/guard',[getMintToInstruction({mint:mint.address,token:token.address,mintAuthority:payer,amount:100_000_000n}),await sdk.getDepositInstructionAsync({...a,owner,participant:trader,quoteMint:mint.address,userToken:token.address,amount:100_000_000n}),await sdk.getInitializeTestRoutesInstructionAsync({...a,authority:payer,reference:60_000n,duration:3600n}),await sdk.getInitializeExitGuardInstructionAsync({...a,payer})],[owner]);
  for(let i=0;i<4;i++){const f=await feedAddress(i);await h.send(`initialize signed local source ${i}`,[getTransferSolInstruction({source:payer,destination:f.authority.address,amount:100_000_000n}),await initializeFeed(i)],[f.authority]);}
  const primary=(await feedAddress(0)).authority,guardKey=(await feedAddress(2)).authority;
  await h.send('activate immutable G08 controlled fixture profile',[await sdk.getInitializeOracleInstructionAsync({...a,routeState,authority:payer,primary:primary.address,guard:guardKey.address})]);
  return {...a,payer,mint,owner,token,trader,routeState,guard,makers,primary,guardKey};
}
export async function oracleCases(h:OracleHarness){
  const a=await oracleSetup(h),{makers,payer,owner,trader,routeState}=a;
  const market=async()=>sdk.getMarketStateDecoder().decode((await h.read(a.market))!),risk=async()=>sdk.getTestRouteStateDecoder().decode((await h.read(routeState))!);
  const participant=async(key=trader)=>sdk.getParticipantDecoder().decode((await h.read(key))!);
  const sampleInput=async()=>{const f=await Promise.all([0,1,2,3].map(feedAddress)),[x,y]=makers;return {...a,primaryBtc:f[0].feed,primaryCollateral:f[1].feed,guardBtc:f[2].feed,guardCollateral:f[3].feed,firstCapital:x.capital,firstRegistration:x.registration,firstProgram:x.pricingProgram,firstProgramData:x.programData,firstConfig:x.config,secondCapital:y.capital,secondRegistration:y.registration,secondProgram:y.pricingProgram,secondProgramData:y.programData,secondConfig:y.config};};
  const update=async(changes:Record<number,SourceChange>={})=>{const now=await h.now();for(let i=0;i<4;i++)await h.send(`publish signed source ${i}`,[await publishFeed(i,now,changes[i])],[(await feedAddress(i)).authority]);};
  const sample=async(label:string)=>{const r=await risk();await h.waitTime(r.oracle.sampledAt+2n);await h.send(label,[sdk.fundingComputeBudget(),await sdk.getSampleOracleInstructionAsync(await sampleInput())]);return risk();};
  const recover=async()=>{for(let i=0;i<4;i++){await update();await sample('qualify source/maker recovery interval');}assert.equal((await risk()).oracle.status,2);};
  async function route(label:string,side:number,lots:bigint,id=0,reduceOnly=false,error?:number){
    const m=await market(),r=await risk(),p=await participant(),x=makers[id],reg=sdk.getMakerRegistrationDecoder().decode((await h.read(x.registration))!),slot=await h.slot();
    const ix=await sdk.getExecuteRouteInstructionAsync({...a,owner,trader,firstCapital:x.capital,firstRegistration:x.registration,firstProgram:x.pricingProgram,firstProgramData:x.programData,firstConfig:x.config,domain:m.domain,termsEpoch:m.termsEpoch,configEpoch:m.configEpoch,observationSequence:r.observationSequence,nonce:p.nonce,startSlot:slot,expirySlot:slot+150n,side,lots,allInLimit:side===0?1_000_000_000n:0n,maxFee:1_000_000n,reduceOnly,generation:p.generation,legs:[{lots,quoteEpoch:reg.quoteEpoch,authorityEpoch:reg.authorityEpoch}]});
    const before=await Promise.all([a.market,routeState,trader,x.capital,x.registration].map(k=>h.read(k)));
    await h.send(label,[sdk.routeComputeBudget(),ix],[owner],error);if(error)assert.deepEqual(await Promise.all([a.market,routeState,trader,x.capital,x.registration].map(k=>h.read(k))),before);
  }
  await h.send('synthetic setter cannot bypass authenticated source profile',[await sdk.getPublishTestRiskInstructionAsync({...a,authority:payer,reference:90_000n,duration:3600n})],[],6108);
  await update();let r=await sample('first authenticated sample starts recovery');assert.equal(r.oracle.status,1);assert.equal(r.oracle.quantity,100n);assert.equal(r.oracle.bid,5_997_210n);assert.equal(r.oracle.ask,6_002_790n);assert.equal(r.oracle.premiumScaled,0n);
  await route('risk increase blocked during recovery',0,3n,0,false,6124);
  await recover();
  await route('open three lots before positive funding',0,3n);
  const beforeSample=await Promise.all(makers.map(x=>h.read(x.registration)));
  await update();r=await sample('impact midpoint recomputed from consumed maker depth');assert.deepEqual(await Promise.all(makers.map(x=>h.read(x.registration))),beforeSample,'funding must not consume curves');
  // A buy depth has consumed 3 lots: optimal ask allocation A18/B82, bid A21/B79.
  assert.equal(r.oracle.bid,5_997_210n);assert.equal(r.oracle.ask,6_002_847n);assert.equal(r.oracle.premiumScaled,285_000_000n);
  const sampled=r.oracle.sampledAt,base=r.oracle.fundingBase;
  await h.waitTime(sampled+3n);
  await route('same account closes after causal funding prefix',1,3n,1,true);
  let p=await participant();const closed=p.virtualScaled;
  assert.equal(p.fundingCheckpointScaled,base+237_500n);assert.equal(closed%1_000_000_000n,-712_500n);
  await h.waitTime(sampled+4n);await route('same account reopens retaining old fraction',0,3n,1);
  p=await participant();assert.equal(p.virtualScaled%1_000_000_000n,-712_500n);
  assert.equal(p.fundingCheckpointScaled,base+316_666n);
  await h.waitTime(sampled+6n);await route('second close charges only reopened interval',1,3n,1,true);
  p=await participant();assert.equal(p.virtualScaled%1_000_000_000n,-1_187_502n);
  const preciseFraction=p.virtualScaled%1_000_000_000n;
  // A different participant starts at zero fractional entitlement.
  const entrant=await fixtureKey('p07-entrant');await h.send('new entrant does not inherit old funding dust',[getTransferSolInstruction({source:payer,destination:entrant.address,amount:10_000_000n}),await sdk.getRegisterParticipantInstructionAsync({...a,owner:entrant})],[entrant]);
  const [entry]=await sdk.findParticipantPda({market:a.market,owner:entrant.address});assert.equal((await participant(entry)).virtualScaled,0n);
  const attacks:Record<string,Record<number,SourceChange>>={
    'wrong verifier':{0:{verifier:a.program}},'partial verification':{0:{level:1}},'negative price':{0:{price:-1n}},'wrong exponent':{0:{exponent:-8}},'wide confidence':{0:{confidence:300_000_001n}},
    'stale timestamp':{0:{published:(await h.now())-30n}},'future timestamp':{0:{published:(await h.now())+1000n}},'divergent guard':{2:{price:62_000_000_000n}},
  };
  for(const [name,changes]of Object.entries(attacks)){await update(changes);r=await sample(`record ${name} restrictive mode`);assert.equal(r.oracle.status,0);assert.equal(r.oracle.heldUntil,0n);await route(`reject risk with ${name}`,0,1n,0,false,6118);}
  await update({1:{price:900_000n},3:{price:900_000n}});r=await sample('collateral shock converts index and degrades');assert.equal(r.referencePrice,66_666n);assert.equal(r.oracle.status,1);assert.equal(r.oracle.heldUntil,0n);await route('depeg cannot admit new exposure',0,1n,0,false,6124);
  await update({2:{level:1}});r=await sample('primary remains credible when guard unavailable');assert.equal(r.oracle.status,1);assert.equal(r.lower,58_200n);assert.equal(r.upper,61_800n);
  await recover();
  await h.send('missing required maker cannot be replaced by alias',[sdk.fundingComputeBudget(),await sdk.getSampleOracleInstructionAsync({...await sampleInput(),secondRegistration:makers[0].registration})],[],'reject');
  await h.send('quarantine required maker A',[await sdk.getQuarantineMakerInstructionAsync({...makers[0],authority:payer})]);
  await update();r=await sample('unavailable required maker invalidates funding hold');assert.equal(r.oracle.status,1);assert.equal(r.oracle.heldUntil,0n);
  const frozen=(await market()).fundingIndexScaled;await h.waitTime((await h.now())+8n);await update();await sample('missing maker interval contributes zero funding');assert.equal((await market()).fundingIndexScaled,frozen);
  await h.send('joint maker recovery invalidates strategy stamp',[await sdk.getApproveMakerInstructionAsync({...makers[0],authority:payer})],[makers[0].owner]);await recover();
  const beforeGap=(await market()).fundingIndexScaled;await h.waitTime((await h.now())+31n);await update();r=await sample('long catch-up gap is explicitly skipped');assert.equal((await market()).fundingIndexScaled,beforeGap);assert.equal(r.oracle.outcome,3);assert(r.oracle.skippedSeconds>=31n);assert.equal(r.oracle.status,1);
  await recover();
  // Largest G08 quantity uses a separate per-lot exhaustive reference, not SDK allocation.
  await update({0:{price:10_000_000_000n},2:{price:10_000_000_000n}});r=await sample('maximum 600-lot authenticated reference size');
  assert.equal(r.oracle.quantity,600n);
  const referenceImpact=async(side:number)=>{
    const regs=await Promise.all(makers.map(async x=>sdk.getMakerRegistrationDecoder().decode((await h.read(x.registration))!)));
    const ps=await Promise.all(makers.map(x=>participant(x.capital)));let best:bigint|null=null;
    for(let n=0n;n<=512n;n++){
      let total=0n,valid=true;
      for(const [id,lots]of [[0,n],[1,600n-n]]as const){
        const consumed=side===0?regs[id].buyConsumed:regs[id].sellConsumed;
        if(consumed+lots>(id===0?512n:4096n)){valid=false;break;}
        for(let j=0n;j<lots;j++){const k=consumed+j,spread=id===0?10n+k:30n+(k>256n?k-256n:0n),center=10_000n-(id===0?ps[id].lots/64n*4n:ps[id].lots/256n);total+=side===0?center+spread:center-spread;}
      }
      if(valid&&(best===null||(side===0?total<best:total>best)))best=total;
    }return best;
  };
  assert.equal(r.oracle.ask,await referenceImpact(0));assert.equal(r.oracle.bid,await referenceImpact(1));
  await recover();await route('consume shallow maker ask depth for cap coverage',0,450n,0);await route('consume deep maker ask depth to exercise actual funding cap',0,3500n,1);
  await update();r=await sample('on-chain positive premium capped to fifty basis points');assert.equal(r.oracle.premiumScaled,300_000_000_000n);
  await h.waitTime((await risk()).oracle.sampledAt+2n);
  const beforeWrong=await h.read(routeState);
  await h.send('caller cannot fake missing source with a different account',[sdk.fundingComputeBudget(),await sdk.getSampleOracleInstructionAsync({...await sampleInput(),primaryBtc:a.market})],[],6123);
  assert.deepEqual(await h.read(routeState),beforeWrong);
  const wrongFlags=await sdk.getSampleOracleInstructionAsync(await sampleInput());
  await h.send('writable source flag cannot manufacture an oracle outage',[sdk.fundingComputeBudget(),{...wrongFlags,accounts:wrongFlags.accounts.map((x,i)=>i===2?{...x,role:AccountRole.WRITABLE}:x)}],[],6123);
  assert.deepEqual(await h.read(routeState),beforeWrong);
  const cohort=async()=>{const m=await market(),r=await risk(),reg=sdk.getParticipantRegistryDecoder().decode((await h.read(a.registry))!);const ix=await sdk.getCheckExitCohortInstructionAsync({...a,sequence:m.sequence,observation:r.observationSequence,start:0});return {...ix,accounts:[...ix.accounts,...reg.members.map(address=>({address,role:AccountRole.READONLY}))]};};
  await h.waitTime((await risk()).oracle.sourceDeadline+1n);
  await h.send('no credible bounds cannot certify a net-zero exposed market',[await cohort()],[],6121);
  await recover();
  await route('close shallow maker exposure before flat cash exit',1,453n,0,true);
  await route('close deep maker exposure before flat cash exit',1,3497n,1,true);
  assert.equal((await participant()).lots,0n);for(const x of makers)assert.equal((await participant(x.capital)).lots,0n);
  await h.waitTime((await risk()).oracle.sourceDeadline+1n);
  await h.send('complete flat solvent cohort can certify without current prices',[await cohort()]);
  await h.send('direct owner funded cash exit survives source outage',[await sdk.getWithdrawTradingInstructionAsync({...a,participant:trader,quoteMint:a.mint.address,userToken:a.token.address,sequence:(await market()).sequence,observation:(await risk()).observationSequence,amount:1n})],[owner]);

  // Exercise actual collect/settle with retained nonzero funding checkpoints.
  const debtor=await participant(),loss=(-debtor.virtualScaled)/1_000_000_000n;
  assert(loss>0n&&loss<debtor.cash);
  const poolBefore=(await market()).settlement;
  await h.send('collect whole loss while retaining participant-owned funding fraction',[await sdk.getCollectLossInstructionAsync({...a,participant:trader,sequence:(await market()).sequence,observation:(await risk()).observationSequence,amount:loss})]);
  assert.equal((await participant()).virtualScaled,debtor.virtualScaled+loss*1_000_000_000n);assert.equal((await participant()).cash,debtor.cash-loss);assert.equal((await market()).settlement,poolBefore+loss);
  for(const x of makers){
    const p=await participant(x.capital),gain=p.virtualScaled/1_000_000_000n;assert(gain>0n);
    await h.send('certify checkpoint-adjusted flat cohort for funded fractional settlement',[await cohort()]);
    await h.send('settle whole funded gain without transferring or rounding up fractional claim',[await sdk.getSettleGainInstructionAsync({...a,participant:x.capital,sequence:(await market()).sequence,observation:(await risk()).observationSequence,amount:gain})]);
    assert.equal((await participant(x.capital)).virtualScaled,p.virtualScaled-gain*1_000_000_000n);assert.equal((await participant(x.capital)).cash,p.cash+gain);
  }
  await h.send('recertify flat cohort before maker funded cash exit',[await cohort()]);
  const makerCash=(await participant(makers[0].capital)).cash;
  await h.send('maker can withdraw own funded cash while retaining unpaid claims',[await sdk.getWithdrawTradingInstructionAsync({...a,owner:makers[0].owner,participant:makers[0].capital,quoteMint:a.mint.address,userToken:makers[0].token.address,sequence:(await market()).sequence,observation:(await risk()).observationSequence,amount:makerCash})],[makers[0].owner]);
  await update();r=await sample('zero funded depth in required maker invalidates sampling');assert.equal(r.oracle.status,1);assert.equal(r.oracle.heldUntil,0n);
  // Every participant's checkpoint contributes to exact claims after q turnover.
  const registry=sdk.getParticipantRegistryDecoder().decode((await h.read(a.registry))!),ps=await Promise.all(registry.members.map(participant)),m=await market();
  assert.equal(ps.reduce((n,p)=>n+p.lots,0n),0n);assert.equal(ps.reduce((n,p)=>n+p.virtualScaled+p.lots*p.fundingCheckpointScaled,0n),m.settlement*1_000_000_000n);
  const vault=getTokenDecoder().decode((await h.read(a.vault))!).amount;assert.equal(vault,ps.reduce((n,p)=>n+p.cash,0n)+m.settlement+m.insurance+m.fees);
  return {market:m,risk:await risk(),participants:ps,preciseFraction,vault};
}
