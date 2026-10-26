import assert from 'node:assert/strict';
import { AccountRole, type Address, type Instruction } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { groupFixture } from './group-fixture.js';
import type { GroupTradingHarness } from './group-trading-cases.js';
import type { Keypair } from '@solana/web3.js';

export async function groupSafetyCases(h: GroupTradingHarness, capture: (label:string,keys:Address[])=>Promise<void>,
  options: {namespace?:string;setupOnly?:boolean;makerDuration?:bigint} = {}) {
  const fixture=await groupFixture(h,options.namespace,options.makerDuration), {common,safety,owner,payer,markets,roots,makers,operators}=fixture;
  const protectedKeys=()=>[fixture.group,fixture.registry,fixture.vault,fixture.guard,fixture.resolution,...markets,...roots,...operators.map(operator=>operator.token.address)];
  async function reject(label:string,instructions:Instruction[],signers:Keypair[],error:number) {
    const before=await Promise.all(protectedKeys().map(h.read));
    await h.send(label,instructions,signers,error);
    assert.deepEqual(await Promise.all(protectedKeys().map(h.read)),before,`${label}: rollback`);
  }
  async function certificate(pageSize=8) {
    const stamp=await fixture.stamp();
    for(let start=0;start<roots.length;start+=pageSize) {
      const instruction=sdk.getCheckGroupExitV2Instruction({...safety,...stamp,start});
      await h.send('complete group certificate page',[{...instruction,accounts:[...instruction.accounts!,...roots.slice(start,start+pageSize).map(address=>({address,role:AccountRole.READONLY}))]}]);
    }
    const guard=sdk.getGroupExitGuardV2Decoder().decode((await h.read(fixture.guard))!);
    assert.equal(guard.next,roots.length);assert.equal(guard.count,roots.length);assert.equal(guard.sequence,stamp.sequence);
    return stamp;
  }
  const cashInstruction=async(margin:Address,amount:bigint,withdraw:boolean,signer=owner,token=operators[0].token.address)=>
    sdk.getGroupTradingCashV2Instruction({...safety,...await fixture.stamp(),owner:signer,margin,quoteMint:fixture.mint.address,userToken:token,amount,withdraw});
  async function route(index:number,side:0|1,parts:bigint[],reduceOnly=false,root=operators[0].capital[index],signer=owner):Promise<{instruction:Instruction;gross:bigint;fee:bigint}> {
    const market=await fixture.marketState(index),trader=await fixture.rootState(root),slot=await h.slot();
    const quotes=[];const legs=[];
    for(const [makerIndex,lots] of parts.entries()) {
      const maker=makers[index][makerIndex];
      const registration=sdk.getMakerRegistrationV2Decoder().decode((await h.read(maker.registration))!);
      const args={side,lots,referencePrice:market.referencePrice,quoteEpoch:registration.quoteEpoch,authorityEpoch:registration.authorityEpoch,
        termsEpoch:market.termsEpoch,configEpoch:market.configEpoch};
      const quote=sdk.getQuoteResponseDecoder().decode(await h.quote('quote authenticated maker',sdk.getPreviewGroupMakerV2Instruction({...maker,args})));
      assert.equal(quote.version,2);quotes.push(quote);legs.push({lots,quoteEpoch:registration.quoteEpoch,authorityEpoch:registration.authorityEpoch});
    }
    const gross=quotes.reduce((sum,quote)=>sum+quote.grossQuote,0n),fee=(gross+4999n)/5000n;
    const [first,second]=makers[index];
    const instruction=sdk.getExecuteGroupRouteV2Instruction({...common,market:markets[index],actor:signer,trader:root,
      firstCapital:first.capital,firstRegistration:first.registration,firstProgram:first.pricingProgram,firstProgramData:first.programData,firstConfig:first.config,
      secondCapital:parts.length===2?second.capital:undefined,secondRegistration:parts.length===2?second.registration:undefined,
      secondProgram:parts.length===2?second.pricingProgram:undefined,secondProgramData:parts.length===2?second.programData:undefined,secondConfig:parts.length===2?second.config:undefined,
      intent:{domain:fixture.domain,termsEpoch:market.termsEpoch,configEpoch:market.configEpoch,observationSequence:market.observationSequence,
        nonce:trader.nonce,startSlot:slot,expirySlot:slot+100n,side,lots:parts.reduce((sum,lots)=>sum+lots,0n),allInLimit:side===0?gross+fee:gross-fee,
        maxFee:fee,reduceOnly,generation:trader.positions[index].generation,legs}});
    return {instruction,gross,fee};
  }
  await h.send('initialize complete-group safety state',[await sdk.getInitializeGroupSafetyV2InstructionAsync({...safety,authority:payer})]);
  await reject('reject unqualified isolated activation',[sdk.getActivateIsolatedGroupV2Instruction({...safety,authority:payer})],[],sdk.CLEARING_ERROR__ORACLE_POLICY);
  await fixture.qualify();
  await reject('reject foreign activation authority',[sdk.getActivateIsolatedGroupV2Instruction({...safety,authority:owner})],[owner],2001);
  await h.send('activate local isolated group',[sdk.getActivateIsolatedGroupV2Instruction({...safety,authority:payer})]);
  assert.equal((await fixture.groupState()).mode,1);
  assert.equal((await fixture.marketState(0)).oracle.status,0);
  assert.equal((await fixture.marketState(1)).oracle.status,0);
  await reject('reject repeat activation',[sdk.getActivateIsolatedGroupV2Instruction({...safety,authority:payer})],[],sdk.CLEARING_ERROR__PROFILE);
  await fixture.qualify();
  await capture('activated-empty',protectedKeys());
  if(options.setupOnly)return {fixture,certificate,route,cashInstruction,reject,protectedKeys};
  for(const index of [0,1]) {
    const open=await route(index,0,[20n,30n]);
    await h.send('both-market atomic split open',[open.instruction],[owner]);
    const state=await fixture.rootState(operators[0].capital[index]);
    assert.equal(state.positions[index].lots,50n);assert.equal(state.cash,1_000_000n-open.fee);
    await capture(`opened-${index}`,protectedKeys());
    await reject('reject replayed route nonce',[open.instruction],[owner],sdk.CLEARING_ERROR__ROUTE_INTENT);
    const close=await route(index,1,[20n,30n],true);
    await h.send('both-market atomic split close',[close.instruction],[owner]);
    const flat=await fixture.rootState(operators[0].capital[index]);assert.equal(flat.positions[index].lots,0n);
    assert.equal(flat.cash,1_000_000n-open.fee-close.fee);
  }
  // Ordinary loss collection precedes any selected winner payment.
  for(const root of roots) {
    const state=await fixture.rootState(root);
    if(state.mode!==1)continue;
    const index=state.isolatedMarketIndex,claim=state.positions[index].virtualScaled;
    assert.equal(state.positions[index].lots,0n);
    if(claim<=-1_000_000_000n)await h.send('collect actual closed loss',[sdk.getChangeGroupClaimV2Instruction({...safety,...await fixture.stamp(),margin:root,
      marketIndex:index,amount:-claim/1_000_000_000n,gain:false})]);
  }
  await capture('losses-collected',protectedKeys());
  for(const root of roots) {
    const state=await fixture.rootState(root);if(state.mode!==1)continue;
    const index=state.isolatedMarketIndex,amount=state.positions[index].virtualScaled/1_000_000_000n;
    if(amount>0n) {
      await certificate();
      await h.send('pay guarded funded closed gain',[sdk.getChangeGroupClaimV2Instruction({...safety,...await fixture.stamp(),margin:root,marketIndex:index,amount,gain:true})]);
    }
  }
  await certificate();
  const staleWithdrawal=await cashInstruction(operators[0].capital[0],1n,true);
  await h.send('deposit into dormant cross cash',[await cashInstruction(fixture.cross,100n,false)],[owner]);
  await reject('reject certificate from prior sequence',[staleWithdrawal],[owner],sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE);
  await certificate();
  await h.send('withdraw dormant cross cash',[await cashInstruction(fixture.cross,100n,true)],[owner]);
  assert.equal((await fixture.rootState(fixture.cross)).cash,0n);
  await certificate();
  await h.send('transfer owner allocated cash',[sdk.getTransferTradingCashV2Instruction({...safety,...await fixture.stamp(),owner,
    donor:operators[0].capital[0],recipient:operators[0].capital[1],amount:10n})],[owner]);
  await certificate();
  await h.send('withdraw funded isolated cash',[await cashInstruction(operators[0].capital[1],100n,true)],[owner]);
  const disabled=await route(0,0,[1n],false,fixture.cross);
  await reject('reject cross route after isolated activation',[disabled.instruction],[owner],sdk.CLEARING_ERROR__PROFILE);
  await capture('ordinary-lifecycle',protectedKeys());
  return {fixture,certificate,route,cashInstruction,reject,protectedKeys};
}
