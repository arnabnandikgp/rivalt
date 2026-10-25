/** P20 internal candidate: genuine signed cross positions, cash and safety.
 * The ordinary successor artifact remains gated until this qualification passes. */
import assert from 'node:assert/strict';
import {AccountRole,type Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {groupSafetyCases} from './group-safety-cases.js';
import {groupDefaultCases} from './group-default-cases.js';
import {groupEmergencyCases} from './group-emergency-cases.js';
import type {GroupTradingHarness} from './group-trading-cases.js';
import {fixtureKey} from './custody-cases.js';

export async function crossSafetyCases(h:GroupTradingHarness,capture:(label:string,keys:Address[])=>Promise<void>) {
  const setup=await groupSafetyCases(h,capture,{namespace:'p20',setupOnly:true});
  const {fixture,certificate,cashInstruction,reject,protectedKeys}=setup;
  const {owner,payer,common,safety,markets,operators,cross}=fixture;
  const activation=()=>sdk.getActivateCrossGroupV2Instruction({...safety,authority:payer});
  await reject('cross activation requires current complete certificate',[activation()],[],sdk.CLEARING_ERROR__EXIT_COHORT);
  await certificate();
  await reject('cross activation requires group authority',[
    sdk.getActivateCrossGroupV2Instruction({...safety,authority:owner})],[owner],2001);
  await h.send('explicit candidate cross activation',[activation()]);
  assert.equal((await fixture.groupState()).mode,2);
  await reject('repeat cross activation rejects',[activation()],[],sdk.CLEARING_ERROR__PROFILE);
  const delegate=await fixtureKey('p20-cross-delegate');
  await h.send('owner grants authority on this cross root',[sdk.getSetMarginDelegateV2Instruction({...common,owner,margin:cross,
    delegate:delegate.address,expirySlot:await h.slot()+10_000n})],[owner]);

  const fullRoute=async(index:number,side:0|1,parts:bigint[],reduceOnly=false,root=cross,actor=owner)=>{
    const quoted=await setup.route(index,side,parts,reduceOnly,root,actor);
    const {intent}=sdk.getExecuteGroupRouteV2InstructionDataDecoder().decode(quoted.instruction.data!);
    return {...quoted,instruction:{...quoted.instruction,
      accounts:[...quoted.instruction.accounts!,{address:markets[1-index],role:AccountRole.WRITABLE}],
      data:sdk.getExecuteMarginRouteV2InstructionDataEncoder().encode({...await fixture.stamp(),intent})}};
  };
  const net=async(actor=owner)=>sdk.getNetMarginClaimsV2Instruction({...safety,...await fixture.stamp(),owner:actor,margin:cross});
  await certificate();
  const transfer=sdk.getTransferTradingCashV2Instruction({...safety,...await fixture.stamp(),owner,
    donor:operators[0].capital[0],recipient:cross,amount:1_000_000n});
  const open=await fullRoute(0,0,[2n,3n]);
  const decoded=sdk.getExecuteMarginRouteV2InstructionDataDecoder().decode(open.instruction.data!);
  const afterTransfer={...decoded,sequence:decoded.sequence+1n};
  await reject('failed cross transfer-and-split rolls back donor recipient and makers',[transfer,{...open.instruction,
    data:sdk.getExecuteMarginRouteV2InstructionDataEncoder().encode({...afterTransfer,intent:{...afterTransfer.intent,nonce:99n}})}],
    [owner],sdk.CLEARING_ERROR__ROUTE_INTENT);
  await h.send('atomic isolated cash allocation and cross split open',[transfer,{...open.instruction,
    data:sdk.getExecuteMarginRouteV2InstructionDataEncoder().encode(afterTransfer)}],[owner]);
  assert.equal((await fixture.rootState(cross)).positions[0].lots,5n);
  assert.equal((await fixture.rootState(operators[0].capital[0])).cash,0n);
  await h.send('delegate opens second market against the same cross cash',[(await fullRoute(1,0,[2n,3n],false,cross,delegate)).instruction],[delegate]);
  await reject('open claims cannot be explicitly netted',[await net()],[owner],sdk.CLEARING_ERROR__ARITHMETIC);
  await capture('cross-open-two-markets',protectedKeys());
  await fixture.qualify();await h.advance(2n);
  const beforeFunding=await fixture.rootState(cross);
  const order=async(index:number,operation:sdk.GroupOrderActionArgs,actor=owner)=>sdk.getManageMarginOrderV2Instruction({
    ...common,...await fixture.stamp(),owner:actor,margin:cross,market:markets[index],otherMarket:markets[1-index],operation});
  let slot=await h.slot();
  const entryId=beforeFunding.book.lastOrderId+1n;
  await h.send('cross ETH reservation materializes both market funding prefixes',[await order(1,sdk.groupOrderAction('Place',{
    expectedId:entryId,terms:{side:0,lots:100n,limit:31_000n,feeBudget:1_000n,startSlot:slot,expirySlot:slot+1200n,
      trigger:0,threshold:0n,reduceOnly:false,generation:0n}}))],[owner]);
  const afterFunding=await fixture.rootState(cross);
  for(const index of [0,1]) {
    const funding=(await fixture.marketState(index)).fundingIndexScaled;
    assert.equal(afterFunding.positions[index].fundingCheckpointScaled,funding);
    assert.equal(afterFunding.positions[index].virtualScaled,beforeFunding.positions[index].virtualScaled
      -beforeFunding.positions[index].lots*(funding-beforeFunding.positions[index].fundingCheckpointScaled));
  }
  assert(afterFunding.positions.some((position,index)=>position.fundingCheckpointScaled!==beforeFunding.positions[index].fundingCheckpointScaled));
  await certificate();
  await reject('whole-account reserve blocks cross withdrawal',[await cashInstruction(cross,900_000n,true)],[owner],sdk.CLEARING_ERROR__ARITHMETIC);
  await reject('whole-account reserve blocks sibling transfer',[sdk.getTransferTradingCashV2Instruction({...safety,...await fixture.stamp(),owner,
    donor:cross,recipient:operators[0].capital[1],amount:900_000n})],[owner],sdk.CLEARING_ERROR__ARITHMETIC);
  await h.send('owner cancels cross risk order',[await order(1,sdk.groupOrderAction('Cancel',{id:entryId,version:1n,protectionGroup:false}))],[owner]);

  slot=await h.slot();
  const state=await fixture.rootState(cross),takeProfitId=state.book.lastOrderId+1n,stopLossId=takeProfitId+1n;
  const protect={side:1,lots:5n,limit:28_000n,feeBudget:100n,startSlot:slot,expirySlot:slot+1200n,
    reduceOnly:true,generation:state.positions[1].generation};
  await h.send('protect existing cross ETH position',[await order(1,sdk.groupOrderAction('Protect',{expectedId:takeProfitId,
    takeProfit:{...protect,trigger:1,threshold:31_000n},stopLoss:{...protect,trigger:2,threshold:29_000n}}))],[owner]);
  async function executeProtection(id:bigint,parts:bigint[]) {
    const current=await fixture.rootState(cross),stored=current.book.orders.find(entry=>entry.order.id===id)!.order;
    const quote=await fullRoute(1,1,parts,true,cross,payer);
    const {intent}=sdk.getExecuteMarginRouteV2InstructionDataDecoder().decode(quote.instruction.data!);
    return {...quote.instruction,data:sdk.getExecuteMarginOrderV2InstructionDataEncoder().encode({...await fixture.stamp(),args:{
      id,version:stored.version,filled:stored.filled,lots:intent.lots,observationSequence:intent.observationSequence,
      startSlot:intent.startSlot,expirySlot:intent.expirySlot,legs:intent.legs}})};
  }
  await reject('untriggered cross protection rejects',[await executeProtection(stopLossId,[1n])],[],sdk.CLEARING_ERROR__ORDER_TRIGGER);
  await fixture.publish(0,{price:61_000_000_000n});await fixture.publish(2,{price:61_000_000_000n});
  await fixture.publish(4,{price:2_900_000_000n});await fixture.publish(5,{price:2_900_000_000n});await fixture.qualify();
  await h.send('partial cross stop consumes shared allowance',[await executeProtection(stopLossId,[1n,1n])]);
  assert.equal((await fixture.rootState(cross)).book.protections[0].protection.remaining,3n);
  await h.send('remaining cross stop closes ETH only',[await executeProtection(stopLossId,[3n])]);
  assert.equal((await fixture.rootState(cross)).positions[0].lots,5n);
  assert.equal((await fixture.rootState(cross)).positions[1].lots,0n);
  await reject('flat ETH invalidates sibling cross TP',[await executeProtection(takeProfitId,[1n])],[],sdk.CLEARING_ERROR__ORDER_STATE);
  await h.send('close profitable BTC on same cross root',[(await fullRoute(0,1,[2n,3n],true)).instruction],[owner]);
  await certificate();
  await reject('unfunded cross profit is not cash',[sdk.getChangeGroupClaimV2Instruction({...safety,...await fixture.stamp(),margin:cross,
    marketIndex:0,amount:1n,gain:true})],[],sdk.CLEARING_ERROR__ARITHMETIC);
  await h.send('collect actual closed maker loss to fund a gain',[sdk.getChangeGroupClaimV2Instruction({...safety,...await fixture.stamp(),
    margin:fixture.makers[0][0].capital,marketIndex:0,amount:1n,gain:false})]);
  await certificate();
  await capture('cross-before-funded-gain',protectedKeys());
  await h.send('settle cross profit only from funded pool',[sdk.getChangeGroupClaimV2Instruction({...safety,...await fixture.stamp(),margin:cross,
    marketIndex:0,amount:1n,gain:true})]);
  await capture('cross-after-funded-gain',protectedKeys());
  const flat=await fixture.rootState(cross);
  assert(flat.positions[0].virtualScaled>0n&&flat.positions[1].virtualScaled<0n);
  const netBefore=flat.positions.reduce((sum,position)=>sum+position.virtualScaled,0n);
  const pools=await fixture.groupState();
  await reject('foreign actor cannot net cross claims',[await net(payer)],[],2001);
  await reject('trade delegate cannot net cross claims',[await net(delegate)],[delegate],2001);
  await capture('cross-before-netting',protectedKeys());
  await h.send('explicit owner flat claim netting',[await net()],[owner]);
  const netted=await fixture.rootState(cross),netPools=await fixture.groupState();
  assert.equal(netted.cash,flat.cash);assert.equal(netted.positions.reduce((sum,position)=>sum+position.virtualScaled,0n),netBefore);
  assert(netted.positions.some(position=>position.virtualScaled===0n));
  for(const key of ['totalCash','settlement','insurance','fees','allocatedVault'] as const)assert.equal(netPools[key],pools[key]);
  await capture('cross-after-netting',protectedKeys());
  for(const [index,position] of netted.positions.entries()) {
    const loss=-position.virtualScaled/1_000_000_000n;
    if(loss>0n)await h.send('collect whole-atom cross loss and preserve its fraction',[sdk.getChangeGroupClaimV2Instruction({
      ...safety,...await fixture.stamp(),margin:cross,marketIndex:index,amount:loss,gain:false})]);
  }
  await certificate();
  const staleExit=await cashInstruction(cross,1n,true);
  await h.send('deposit invalidates cross exit certificate',[await cashInstruction(cross,1n,false)],[owner]);
  await reject('cross withdrawal loses sequence race',[staleExit],[owner],sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE);
  await certificate();await h.send('owner withdraws funded cross cash',[await cashInstruction(cross,1n,true)],[owner]);
  await fixture.publish(0,{price:60_000_000_000n});await fixture.publish(2,{price:60_000_000_000n});
  await fixture.publish(4,{price:3_000_000_000n});await fixture.publish(5,{price:3_000_000_000n});await fixture.qualify();

  // Independent G06 sign case through actual fills/source updates: the BTC
  // gain keeps economic net positive while the ETH loss makes risk equity
  // negative. Default cannot replace liquidation or seize profitable claims.
  await h.send('funded cross BTC exposure for risk versus bankruptcy',[(await fullRoute(0,0,[45n,45n])).instruction],[owner]);
  await h.send('funded cross ETH exposure for risk versus bankruptcy',[(await fullRoute(1,0,[45n,45n])).instruction],[owner]);
  await fixture.publish(0,{price:70_000_000_000n});await fixture.publish(2,{price:70_000_000_000n});
  await fixture.publish(4,{price:1_500_000_000n});await fixture.publish(5,{price:1_500_000_000n});await fixture.qualify();
  await capture('cross-negative-risk-positive-net',protectedKeys());
  await reject('negative risk alone cannot authorize cross default',[sdk.getFreezeGroupV2Instruction({
    ...safety,...fixture.sources,...await fixture.stamp(),caller:payer,target:cross,emergency:false})],[],sdk.CLEARING_ERROR__RESOLUTION);
  await fixture.publish(0,{price:60_000_000_000n});await fixture.publish(2,{price:60_000_000_000n});
  await fixture.publish(4,{price:3_000_000_000n});await fixture.publish(5,{price:3_000_000_000n});await fixture.qualify();
  for(const index of [0,1])await h.send('close recovered cross equity-sign exposure',[(await fullRoute(index,1,[45n,45n],true)).instruction],[owner]);

  // Reuse the actual complete-cohort transaction flow, selecting one cross root
  // for both markets. Registry membership/account bytes are never rewritten.
  const lifecycle={...setup,route:fullRoute,fixture:{...fixture,
    operators:[{...operators[0],capital:[cross,cross]},...operators.slice(1)]}};
  const defaults=await groupDefaultCases(h,lifecycle,capture,{crossReceiver:true});
  await groupEmergencyCases(h,lifecycle,defaults,capture,{secondMarketExposure:true,reactivate:async()=>{
    await certificate();await h.send('explicit cross reactivation after complete recovery',[activation()]);
  }});
  return {...setup,qualificationVersion:2,activationInstruction:activation(),liquidationTarget:cross};
}
