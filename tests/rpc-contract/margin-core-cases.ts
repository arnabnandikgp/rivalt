/** P19 signed authority/dependency checks. Cross exposure remains deliberately disabled. */
import assert from 'node:assert/strict';
import {AccountRole, address, type Address, type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {fixtureKey} from './custody-cases.js';
import {groupSafetyCases} from './group-safety-cases.js';
import type {GroupTradingHarness} from './group-trading-cases.js';

export async function marginCoreCases(h:GroupTradingHarness,capture:(label:string,keys:Address[])=>Promise<void>) {
  const setup=await groupSafetyCases(h,capture,{namespace:'p19',setupOnly:true});
  const {fixture,certificate,route,cashInstruction}=setup;
  const {owner,payer,common,safety,markets,operators,makers,cross}=fixture;
  const btc=operators[0].capital[0],eth=operators[0].capital[1];
  const delegate=await fixtureKey('p19-delegate');
  const zero=address('11111111111111111111111111111111');
  const protectedKeys=()=>[...setup.protectedKeys(),...makers.flat().flatMap(maker=>[maker.registration,maker.config,maker.groupBinding])];
  async function reject(label:string,instructions:Instruction[],signers:Parameters<GroupTradingHarness['send']>[2],error:number) {
    const before=await Promise.all(protectedKeys().map(h.read));
    await h.send(label,instructions,signers,error);
    assert.deepEqual(await Promise.all(protectedKeys().map(h.read)),before,`${label}: complete rollback`);
  }
  const grant=(margin:Address,expiry:bigint,key=delegate.address,actor=owner)=>sdk.getSetMarginDelegateV2Instruction({
    ...common,owner:actor,margin,delegate:key,expirySlot:expiry});
  const fullRoute=async(index:number,side:0|1,parts:bigint[],reduceOnly=false,root=operators[0].capital[index],actor=delegate)=>{
    const result=await route(index,side,parts,reduceOnly,root,actor);
    const original=sdk.getExecuteGroupRouteV2InstructionDataDecoder().decode(result.instruction.data!);
    return {...result,instruction:{...result.instruction,accounts:[...result.instruction.accounts!,{address:markets[1-index],role:AccountRole.WRITABLE}],
      data:sdk.getExecuteMarginRouteV2InstructionDataEncoder().encode({...await fixture.stamp(),intent:original.intent})}};
  };
  const order=async(margin:Address,index:number,operation:sdk.GroupOrderActionArgs,actor=delegate)=>sdk.getManageMarginOrderV2Instruction({
    ...common,...await fixture.stamp(),owner:actor,margin,market:markets[index],otherMarket:markets[1-index],operation});
  const terms=async()=>({side:0,lots:2n,limit:61_000n,feeBudget:100n,startSlot:await h.slot(),expirySlot:await h.slot()+1_000n,
    trigger:0,threshold:0n,reduceOnly:false,generation:0n});
  await reject('foreign owner cannot grant', [grant(btc,await h.slot()+1_000n,delegate.address,payer)],[],2001);
  await h.send('owner grants root-scoped delegate',[grant(btc,await h.slot()+1_000n)],[owner]);
  let state=await fixture.rootState(btc);
  assert.equal(state.delegateEpoch,2n);assert.equal(state.nonce,1n);
  await capture('delegate-granted',protectedKeys());
  await reject('delegate cannot redelegate',[grant(btc,await h.slot()+1_000n,payer.address,delegate)],[delegate],2001);
  await reject('delegate cannot withdraw owner cash',[await cashInstruction(btc,1n,true,delegate)],[delegate],2001);
  await reject('delegate cannot allocate owner cash',[sdk.getTransferTradingCashV2Instruction({...safety,...await fixture.stamp(),owner:delegate,donor:btc,recipient:eth,amount:1n})],[delegate],2001);
  const unauthorized=await fullRoute(1,0,[1n]);
  await reject('grant does not propagate to sibling ETH root',[unauthorized.instruction],[delegate],sdk.CLEARING_ERROR__AUTHORITY);
  await h.send('delegate authorizes durable split order',[await order(btc,0,sdk.groupOrderAction('Place',{
    expectedId:1n,terms:{...await terms(),lots:5n}}))],[delegate]);
  const opened=await fullRoute(0,0,[2n,3n],false,btc,payer);
  const openIntent=sdk.getExecuteMarginRouteV2InstructionDataDecoder().decode(opened.instruction.data!).intent;
  const execution={id:1n,version:1n,filled:0n,lots:5n,observationSequence:openIntent.observationSequence,
    startSlot:openIntent.startSlot,expirySlot:openIntent.expirySlot,legs:openIntent.legs};
  const storedOpen={...opened.instruction,data:sdk.getExecuteMarginOrderV2InstructionDataEncoder().encode({
    ...await fixture.stamp(),args:execution})};
  await h.send('keeper executes live delegated split order',[storedOpen]);
  state=await fixture.rootState(btc);assert.equal(state.positions[0].lots,5n);assert.equal(state.cash,1_000_000n-opened.fee);
  await capture('delegated-open',protectedKeys());
  await reject('filled delegated order cannot replay',[storedOpen],[],sdk.CLEARING_ERROR__ORDER_STATE);
  const fresh=await fullRoute(0,0,[1n]);
  await reject('omitted second market rejects',[{...fresh.instruction,accounts:fresh.instruction.accounts!.slice(0,-1)}],[delegate],3005);
  await reject('duplicate second market rejects',[{...fresh.instruction,accounts:[...fresh.instruction.accounts!.slice(0,-1),{address:markets[0],role:AccountRole.WRITABLE}]}],[delegate],2040);
  const place=await order(btc,0,sdk.groupOrderAction('Place',{expectedId:2n,terms:await terms()}));
  await h.send('delegate places whole-account durable order',[place],[delegate]);
  state=await fixture.rootState(btc);assert.equal(state.book.orders[0].delegateEpoch,2n);assert(state.reserved>0n);
  const oldIntent=await fullRoute(0,1,[2n,3n],true);
  await h.send('owner revokes delegate and durable authority',[grant(btc,0n,zero)],[owner]);
  state=await fixture.rootState(btc);assert.equal(state.reserved,0n);assert.equal(state.delegateEpoch,3n);
  assert.equal(state.book.orders[0].order.state,6);
  await capture('delegate-revoked',protectedKeys());
  await reject('keeper cannot execute revoked durable authority',[{...storedOpen,
    data:sdk.getExecuteMarginOrderV2InstructionDataEncoder().encode({...await fixture.stamp(),args:{...execution,id:2n,lots:1n}})}],[],sdk.CLEARING_ERROR__ORDER_STATE);
  await reject('revoked delegate cannot execute signed intent',[oldIntent.instruction],[delegate],sdk.CLEARING_ERROR__AUTHORITY);
  await h.send('owner regrants same key',[grant(btc,await h.slot()+1_000n)],[owner]);
  // Refresh only the group snapshot, preserving the original nonce in the old wire.
  const stale=sdk.getExecuteMarginRouteV2InstructionDataDecoder().decode(oldIntent.instruction.data!);
  await reject('same-key regrant cannot revive old nonce',[{...oldIntent.instruction,data:sdk.getExecuteMarginRouteV2InstructionDataEncoder().encode({
    ...await fixture.stamp(),intent:stale.intent})}],[delegate],sdk.CLEARING_ERROR__ROUTE_INTENT);
  await fixture.qualify();
  const close=await fullRoute(0,1,[2n,3n],true);
  await h.send('delegate closes exact existing position',[close.instruction],[delegate]);
  assert.equal((await fixture.rootState(btc)).positions[0].lots,0n);
  await capture('delegated-close',protectedKeys());
  await h.send('owner places order independent of delegate',[await order(btc,0,sdk.groupOrderAction('Place',{expectedId:3n,terms:await terms()}),owner)],[owner]);
  await h.send('delegate replacement adopts current grant epoch',[await order(btc,0,sdk.groupOrderAction('Replace',{id:3n,version:1n,terms:await terms()}))],[delegate]);
  state=await fixture.rootState(btc);assert.equal(state.book.orders.find(entry=>entry.order.id===3n)!.delegateEpoch,4n);
  await h.send('owner revokes delegated replacement',[grant(btc,0n,zero)],[owner]);
  assert.equal((await fixture.rootState(btc)).reserved,0n);
  await h.send('short exclusive delegate grant',[grant(btc,await h.slot()+40n)],[owner]);
  await h.advance(3n,80n);
  await reject('expired delegate cannot manage orders',[await order(btc,0,sdk.groupOrderAction('Place',{expectedId:4n,terms:await terms()}))],[delegate],sdk.CLEARING_ERROR__AUTHORITY);
  await h.send('owner revokes expired grant',[grant(btc,0n,zero)],[owner]);
  await fixture.qualify();
  await certificate();
  const allocation=sdk.getTransferTradingCashV2Instruction({...safety,...await fixture.stamp(),owner,donor:btc,recipient:eth,amount:10n});
  const allocatedOpen=await fullRoute(1,0,[1n],false,eth,owner);
  const allocatedData=sdk.getExecuteMarginRouteV2InstructionDataDecoder().decode(allocatedOpen.instruction.data!);
  const afterAllocation={...allocatedData,sequence:allocatedData.sequence+1n};
  await reject('failed transfer-and-open rolls back both roots and maker',[allocation,{...allocatedOpen.instruction,
    data:sdk.getExecuteMarginRouteV2InstructionDataEncoder().encode({...afterAllocation,intent:{...afterAllocation.intent,nonce:99n}})}],
    [owner],sdk.CLEARING_ERROR__ROUTE_INTENT);
  await h.send('owner atomic transfer-and-open',[allocation,{...allocatedOpen.instruction,
    data:sdk.getExecuteMarginRouteV2InstructionDataEncoder().encode(afterAllocation)}],[owner]);
  const allocatedClose=await fullRoute(1,1,[1n],true,eth,owner);
  await h.send('close allocated ETH position',[allocatedClose.instruction],[owner]);
  await h.send('grant dormant cross root without activation',[grant(cross,await h.slot()+1_000n)],[owner]);
  await h.send('fund dormant delegated cross cash',[await cashInstruction(cross,100n,false)],[owner]);
  await certificate();
  await h.send('dormant delegation does not lock cash exit',[await cashInstruction(cross,100n,true)],[owner]);
  const disabled=await fullRoute(0,0,[1n],false,cross);
  await reject('successor build rejects cross route',[disabled.instruction],[delegate],sdk.CLEARING_ERROR__PROFILE);
  await reject('successor build rejects cross order',[await order(cross,0,sdk.groupOrderAction('Place',{expectedId:1n,terms:await terms()}))],[delegate],sdk.CLEARING_ERROR__PROFILE);
  await reject('owner cross netting stays release gated',[sdk.getNetMarginClaimsV2Instruction({...safety,...await fixture.stamp(),owner,margin:cross})],[owner],sdk.CLEARING_ERROR__PROFILE);
  await reject('delegate cannot authorize closed netting',[sdk.getNetMarginClaimsV2Instruction({...safety,...await fixture.stamp(),owner:delegate,margin:cross})],[delegate],2001);
  await capture('margin-core-final',protectedKeys());
  return {...setup,reject,protectedKeys,disabledCross:disabled.instruction,delegate};
}
