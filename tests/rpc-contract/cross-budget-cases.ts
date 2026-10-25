/** Focused maximum-book measurement, separate from the full default lifecycle. */
import assert from 'node:assert/strict';
import {AccountRole,getAddressEncoder,type Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {groupSafetyCases} from './group-safety-cases.js';
import type {GroupTradingHarness} from './group-trading-cases.js';
import {groupPda} from './group-custody-cases.js';
import {u16} from './group-fixture.js';

export async function crossBudgetCases(h:GroupTradingHarness,capture:(label:string,keys:Address[])=>Promise<void>) {
  const setup=await groupSafetyCases(h,capture,{namespace:'p20-budget',setupOnly:true});
  const {fixture,certificate,cashInstruction,protectedKeys}=setup;
  const {owner,payer,common,safety,markets,operators,cross}=fixture;
  const activationInstruction=sdk.getActivateCrossGroupV2Instruction({...safety,authority:payer});
  await certificate();await h.send('activate bounded cross budget group',[activationInstruction]);
  await h.send('fund cross budget root',[await cashInstruction(cross,1_000_000n,false)],[owner]);
  const route=async(index:number,side:0|1,parts:bigint[],reduceOnly=false,margin=cross)=>{
    const quoted=await setup.route(index,side,parts,reduceOnly,margin,owner);
    const {intent}=sdk.getExecuteGroupRouteV2InstructionDataDecoder().decode(quoted.instruction.data!);
    return {...quoted,instruction:{...quoted.instruction,
      accounts:[...quoted.instruction.accounts!,{address:markets[1-index],role:AccountRole.WRITABLE}],
      data:sdk.getExecuteMarginRouteV2InstructionDataEncoder().encode({...await fixture.stamp(),intent})}};
  };
  for(const index of [0,1])await h.send('open both budget positions',[(await route(index,0,[2n,3n])).instruction],[owner]);
  await fixture.qualify();await h.advance(2n);
  for(let id=1;id<=4;id++) {
    const index=id%2,slot=await h.slot();
    await h.send('reserve every cross order slot',[sdk.getManageMarginOrderV2Instruction({...common,...await fixture.stamp(),owner,
      margin:cross,market:markets[index],otherMarket:markets[1-index],operation:sdk.groupOrderAction('Place',{
        expectedId:BigInt(id),terms:{side:0,lots:1n,limit:index===0?61_000n:31_000n,feeBudget:100n,startSlot:slot,
          expirySlot:slot+1_200n,trigger:0,threshold:0n,reduceOnly:false,generation:0n}})})],[owner]);
  }
  const before=await fixture.rootState(cross);
  assert.equal(before.book.orders.filter(entry=>entry.order.state===1).length,4);
  await certificate();
  const allocation=sdk.getTransferTradingCashV2Instruction({...safety,...await fixture.stamp(),owner,
    donor:operators[0].capital[0],recipient:cross,amount:1n});
  const quoted=await route(0,0,[1n,1n]);
  const decoded=sdk.getExecuteMarginRouteV2InstructionDataDecoder().decode(quoted.instruction.data!);
  await capture('max-book-before',protectedKeys());
  await h.send('maximum book atomic transfer and two-maker cross open',[allocation,{...quoted.instruction,
    data:sdk.getExecuteMarginRouteV2InstructionDataEncoder().encode({...decoded,sequence:decoded.sequence+1n})}],[owner]);
  const after=await fixture.rootState(cross);
  assert.deepEqual(after.positions.map(position=>position.lots),[7n,5n]);
  assert.equal(after.cash,before.cash+1n-quoted.fee);
  assert.equal(after.book.orders.filter(entry=>entry.order.state===1).length,4);
  await capture('max-book-after',protectedKeys());
  await h.send('maximum book two-maker reduction',[(await route(0,1,[1n,1n],true)).instruction],[owner]);
  await capture('max-book-reduced',protectedKeys());
  const encoder=getAddressEncoder();
  const portfolio=await groupPda('portfolio-v2',encoder.encode(fixture.group),encoder.encode(owner.address),u16(1));
  const receiver=await groupPda('margin-v2',encoder.encode(portfolio),u16(0));
  await h.send('create bounded receiver portfolio',[await sdk.getCreatePortfolioV2InstructionAsync({...common,owner,portfolio,index:1})],[owner]);
  await h.send('register cross receiver for full-book liquidation',[await sdk.getRegisterMarginV2InstructionAsync({...common,owner,portfolio,
    margin:receiver,subaccountIndex:0,mode:0,isolatedMarketIndex:255,role:2})],[owner]);fixture.roots.push(receiver);
  await h.send('fund cross receiver',[await cashInstruction(receiver,1_000_000n,false)],[owner]);
  await h.send('receiver holds independent ETH position',[(await route(1,0,[1n,1n],false,receiver)).instruction],[owner]);
  for(let id=1;id<=4;id++) {
    const index=id%2,slot=await h.slot();
    await h.send('reserve every receiver order slot',[sdk.getManageMarginOrderV2Instruction({...common,...await fixture.stamp(),owner,
      margin:receiver,market:markets[index],otherMarket:markets[1-index],operation:sdk.groupOrderAction('Place',{
        expectedId:BigInt(id),terms:{side:0,lots:1n,limit:index===0?61_000n:31_000n,feeBudget:100n,startSlot:slot,
          expirySlot:slot+1_200n,trigger:0,threshold:0n,reduceOnly:false,generation:0n}})})],[owner]);
  }
  await certificate();await h.send('admissible cash exit before adverse price move',[await cashInstruction(cross,800_000n,true)],[owner]);
  await fixture.publish(0,{price:10_000_000_000n});await fixture.publish(2,{price:10_000_000_000n});await fixture.qualify();
  await capture('max-receiver-before',protectedKeys());
  await h.send('full-book cross liquidation with two-market receiver',[sdk.getLiquidateGroupV2Instruction({...safety,...await fixture.stamp(),
    receiverOwner:owner,target:cross,receiver,marketIndex:0,lots:1n,price:10_000n})],[owner]);
  const liquidated=await fixture.rootState(cross),received=await fixture.rootState(receiver);
  assert(liquidated.book.orders.every(entry=>entry.order.state===6));
  assert.equal(received.book.orders.filter(entry=>entry.order.state===1).length,4);
  assert.deepEqual(received.positions.map(position=>position.lots),[1n,2n]);
  await capture('max-receiver-after',protectedKeys());
  return {...setup,qualificationVersion:1,activationInstruction,liquidationTarget:cross};
}
