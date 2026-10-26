import assert from 'node:assert/strict';
import type { Address } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type { GroupTradingHarness } from './group-trading-cases.js';
import type { groupSafetyCases } from './group-safety-cases.js';

/** Signed stored authority, cumulative fees, funding and existing-position TP/SL. */
export async function groupOrderCases(h: GroupTradingHarness, lifecycle: Awaited<ReturnType<typeof groupSafetyCases>>,
  capture: (label: string, keys: Address[]) => Promise<void>) {
  const {fixture,route,reject,protectedKeys}=lifecycle;
  const {common,owner,payer,markets,operators}=fixture;
  const margin=operators[0].capital[1];
  const state=()=>fixture.rootState(margin);
  const manage=(operation:sdk.GroupOrderActionArgs,signer=owner)=>sdk.getManageGroupOrderV2Instruction({
    ...common,market:markets[1],margin,owner:signer,operation});
  const slot=await h.slot();
  const terms:sdk.OrderTermsArgs={side:0,lots:100n,limit:31_000n,feeBudget:1_000n,startSlot:slot,expirySlot:slot+1200n,
    trigger:0,threshold:0n,reduceOnly:false,generation:0n};
  const entryId=(await state()).book.lastOrderId+1n;
  await reject('reject foreign stored-order creation',[manage({__kind:'Place',expectedId:entryId,terms},payer)],[],sdk.CLEARING_ERROR__AUTHORITY);
  await h.send('place reserved ETH limit',[manage({__kind:'Place',expectedId:entryId,terms})],[owner]);
  assert((await state()).reserved>0n);
  await lifecycle.certificate();
  await reject('reject withdrawal of cash reserved by remaining order',[await lifecycle.cashInstruction(margin,900_000n,true)],[owner],sdk.CLEARING_ERROR__ARITHMETIC);
  await reject('reject transfer of cash reserved by remaining order',[sdk.getTransferTradingCashV2Instruction({...fixture.safety,
    ...await fixture.stamp(),owner,donor:margin,recipient:operators[0].capital[0],amount:900_000n})],[owner],sdk.CLEARING_ERROR__ARITHMETIC);
  async function execution(id:bigint,parts:bigint[]) {
    const root=await state(),order=root.book.orders.find(entry=>entry.order.id===id)!.order;
    const quoted=await route(1,order.side as 0|1,parts,order.reduceOnly,margin,payer);
    const {intent}=sdk.getExecuteGroupRouteV2InstructionDataDecoder().decode(quoted.instruction.data!);
    return {...quoted,instruction:{...quoted.instruction,data:sdk.getExecuteGroupOrderV2InstructionDataEncoder().encode({args:{
      id,version:order.version,filled:order.filled,observationSequence:intent.observationSequence,
      startSlot:intent.startSlot,expirySlot:intent.expirySlot,lots:intent.lots,legs:intent.legs}})}};
  }
  const first=await execution(entryId,[40n,10n]);
  await h.send('permissionless partial stored split',[first.instruction]);
  let entry=(await state()).book.orders.find(entry=>entry.order.id===entryId)!.order;
  assert.equal(entry.filled,50n);assert.equal(entry.feeCharged,(first.gross+4999n)/5000n);
  await reject('reject replayed stored fill prefix',[first.instruction],[],sdk.CLEARING_ERROR__ORDER_STATE);
  const second=await execution(entryId,[50n]);
  await h.send('permissionless remaining stored fill',[second.instruction]);
  entry=(await state()).book.orders.find(entry=>entry.order.id===entryId)!.order;
  assert.equal(entry.filled,100n);assert.equal(entry.feeCharged,(first.gross+second.gross+4999n)/5000n);
  assert.equal((await state()).reserved,0n);
  await fixture.qualify();await h.advance(2n);
  const before=await state(),market=await fixture.marketState(1),protectionSlot=await h.slot();
  const protectionTerms={...terms,side:1,lots:100n,limit:29_000n,feeBudget:1_000n,startSlot:protectionSlot,expirySlot:protectionSlot+1200n,
    reduceOnly:true,generation:before.positions[1].generation};
  const takeProfitId=before.book.lastOrderId+1n,stopLossId=takeProfitId+1n;
  await h.send('protect existing ETH position after pending funding',[manage({__kind:'Protect',expectedId:takeProfitId,
    takeProfit:{...protectionTerms,trigger:1,threshold:31_000n},stopLoss:{...protectionTerms,trigger:2,threshold:25_000n}})],[owner]);
  const funded=await state(),materialized=await fixture.marketState(1);
  assert.equal(funded.positions[1].fundingCheckpointScaled,materialized.fundingIndexScaled);
  assert.equal(funded.positions[1].virtualScaled,before.positions[1].virtualScaled
    -before.positions[1].lots*(materialized.fundingIndexScaled-before.positions[1].fundingCheckpointScaled));
  assert(materialized.fundingIndexScaled!==market.fundingIndexScaled,'pending funding was actually accrued');
  await reject('reject untriggered stop loss',[(await execution(stopLossId,[5n])).instruction],[],sdk.CLEARING_ERROR__ORDER_TRIGGER);
  await fixture.publish(4,{price:3_200_000_000n});await fixture.publish(5,{price:3_200_000_000n});await fixture.qualify();
  await capture('orders-funded-protected',protectedKeys());
  await h.send('partial take profit consumes shared allowance',[(await execution(takeProfitId,[40n,10n])).instruction]);
  assert.equal((await state()).book.protections.find(entry=>entry.protection.id===1n)!.protection.remaining,50n);
  await h.send('remaining take profit closes generation',[(await execution(takeProfitId,[50n])).instruction]);
  const flat=await state();assert.equal(flat.positions[1].lots,0n);assert.equal(flat.positions[1].generation,before.positions[1].generation+1n);
  assert.equal(flat.book.protections.find(entry=>entry.protection.id===1n)!.protection.remaining,0n);assert.equal(flat.reserved,0n);
  await reject('reject sibling protection after flat',[(await execution(stopLossId,[1n])).instruction],[],sdk.CLEARING_ERROR__ORDER_STATE);
  const expirySlot=await h.slot(),expiryId=flat.book.lastOrderId+1n;
  await h.send('place short-lived authority',[manage({__kind:'Place',expectedId:expiryId,terms:{...terms,startSlot:expirySlot,expirySlot:expirySlot+2n}})],[owner]);
  await reject('reject foreign order cancellation',[manage({__kind:'Cancel',id:expiryId,version:1n,protectionGroup:false},payer)],[],sdk.CLEARING_ERROR__AUTHORITY);
  await h.advance(1n,3n);
  await h.send('permissionless expired-authority cleanup',[manage({__kind:'Cleanup'},payer)]);
  assert.equal((await state()).reserved,0n);
  await reject('reject no-op permissionless cleanup',[manage({__kind:'Cleanup'},payer)],[],sdk.CLEARING_ERROR__ORDER_STATE);
  await fixture.publish(4,{price:3_000_000_000n});await fixture.publish(5,{price:3_000_000_000n});await fixture.qualify();
  await capture('orders-complete',protectedKeys());
}
