import assert from 'node:assert/strict';
import { AccountRole,getAddressEncoder,type Address } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { getTransferCheckedInstruction } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { fixtureKey } from './custody-cases.js';
import { groupPda } from './group-custody-cases.js';
import { u16 } from './group-fixture.js';
import type { GroupTradingHarness } from './group-trading-cases.js';
import type { groupSafetyCases } from './group-safety-cases.js';

type Lifecycle = Awaited<ReturnType<typeof groupSafetyCases>>;
export async function groupDefaultCases(h:GroupTradingHarness, lifecycle:Lifecycle,capture:(label:string,keys:Address[])=>Promise<void>) {
  const {fixture,route,certificate,reject,protectedKeys}=lifecycle;
  const {common,safety,payer,owner,operators,roots}=fixture;
  const encoder=getAddressEncoder();
  const receiverOwner=await fixtureKey('p18c-receiver');
  await h.send('receiver rent funding',[getTransferSolInstruction({source:payer,destination:receiverOwner.address,amount:1_000_000_000n})]);
  const portfolio=await groupPda('portfolio-v2',encoder.encode(fixture.group),encoder.encode(receiverOwner.address),u16(0));
  const receiver=await groupPda('margin-v2',encoder.encode(portfolio),u16(1));
  await h.send('register receiver portfolio during trading',[await sdk.getCreatePortfolioV2InstructionAsync({...common,owner:receiverOwner,portfolio,index:0})],[receiverOwner]);
  await h.send('register consenting receiver root',[await sdk.getRegisterMarginV2InstructionAsync({...common,owner:receiverOwner,portfolio,margin:receiver,
    subaccountIndex:1,mode:1,isolatedMarketIndex:0,role:2})],[receiverOwner]);roots.push(receiver);
  // Owner cash cannot be moved to a receiver with a different owner; the receiver
  // instead owns its own minted test collateral and signs an actual token deposit.
  const {getCreateAccountInstruction}=await import('@solana-program/system');
  const {TOKEN_PROGRAM_ADDRESS,getInitializeAccount3Instruction,getMintToInstruction}=await import('@solana-program/token');
  const receiverToken=await fixtureKey('p18c-receiver-token');
  await h.send('receiver test collateral',[getCreateAccountInstruction({payer,newAccount:receiverToken,lamports:await h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),
    getInitializeAccount3Instruction({account:receiverToken.address,mint:fixture.mint.address,owner:receiverOwner.address}),
    getMintToInstruction({mint:fixture.mint.address,token:receiverToken.address,mintAuthority:payer,amount:1_000_000n})],[receiverToken]);
  await h.send('receiver funds own root',[await lifecycle.cashInstruction(receiver,1_000_000n,false,receiverOwner,receiverToken.address)],[receiverOwner]);
  await certificate();
  await reject('reject sibling transfer to another owner',[sdk.getTransferTradingCashV2Instruction({...safety,...await fixture.stamp(),owner,
    donor:operators[0].capital[0],recipient:receiver,amount:1n})],[owner],2001);
  await fixture.qualify();
  const open=await route(0,0,[50n,50n]);await h.send('open position for funded liquidation',[open.instruction],[owner]);
  await fixture.publish(0,{price:52_000_000_000n});await fixture.publish(2,{price:52_000_000_000n});await fixture.qualify();
  const liquidation=async(lots:bigint,price:bigint,receiving=receiver,signer=receiverOwner)=>sdk.getLiquidateGroupV2Instruction({...safety,...await fixture.stamp(),receiverOwner:signer,
    target:operators[0].capital[0],receiver:receiving,marketIndex:0,lots,price});
  await reject('reject provider capital as liquidation receiver',[await liquidation(50n,52_000n,fixture.makers[0][0].capital,fixture.makers[0][0].owner)],
    [fixture.makers[0][0].owner],sdk.CLEARING_ERROR__LIQUIDATION);
  await reject('reject target flip by liquidation',[await liquidation(101n,52_000n)],[receiverOwner],sdk.CLEARING_ERROR__ARITHMETIC);
  // Independent 1% risk bands are [51,480, 52,520]. At 48,855, closing 50
  // releases 131,300 MM and loses 131,250 equity: its 50-atom progress is
  // consumed by the 1,222-atom funded fee.
  await reject('reject liquidation progress consumed by funded fee',[await liquidation(50n,48_855n)],[receiverOwner],sdk.CLEARING_ERROR__ARITHMETIC);
  await capture('before-liquidation',protectedKeys());
  await h.send('funded partial liquidation after source move',[await liquidation(50n,52_000n)],[receiverOwner]);
  assert.equal((await fixture.rootState(receiver)).positions[0].lots,50n);
  assert.equal((await fixture.rootState(operators[0].capital[0])).positions[0].lots,50n);
  await capture('after-liquidation',protectedKeys());
  // Exit the transferred and remaining position through the unchanged two-maker route.
  for(const [root,signer] of [[receiver,receiverOwner],[operators[0].capital[0],owner]] as const) {
    const close=await route(0,1,[25n,25n],true,root,signer);await h.send('close after partial liquidation',[close.instruction],[signer]);
  }
  for(const root of roots) {
    const account=await fixture.rootState(root);if(account.mode!==1)continue;
    const index=account.isolatedMarketIndex,claim=account.positions[index].virtualScaled;
    if(claim<=-1_000_000_000n)await h.send('collect funded liquidation lifecycle loss',[sdk.getChangeGroupClaimV2Instruction({...safety,...await fixture.stamp(),margin:root,
      marketIndex:index,amount:-claim/1_000_000_000n,gain:false})]);
  }
  for(const root of roots) {
    const account=await fixture.rootState(root);if(account.mode!==1)continue;
    const index=account.isolatedMarketIndex,entitlement=account.positions[index].virtualScaled/1_000_000_000n;
    // Whole-atom loss collection can leave fractional losses unpaid. A positive
    // claim is paid only from P; the unbacked remainder is still an unpaid claim.
    const pool=(await fixture.groupState()).settlement,amount=entitlement<pool?entitlement:pool;
    if(amount>0n){await certificate();await h.send('pay collected liquidation lifecycle gain',[sdk.getChangeGroupClaimV2Instruction({...safety,...await fixture.stamp(),margin:root,marketIndex:index,amount,gain:true})]);}
  }
  await capture('liquidation-lifecycle-complete',protectedKeys());
  // Fill the real registry. Each root is genuinely initialized, not injected.
  for(let operatorIndex=0;roots.length<64;operatorIndex++) {
    const signer=await fixtureKey(`p18c-cohort-${operatorIndex}`);
    await h.send('cohort owner rent',[getTransferSolInstruction({source:payer,destination:signer.address,amount:1_000_000_000n})]);
    const portfolio=await groupPda('portfolio-v2',encoder.encode(fixture.group),encoder.encode(signer.address),u16(0));
    await h.send('cohort portfolio',[await sdk.getCreatePortfolioV2InstructionAsync({...common,owner:signer,portfolio,index:0})],[signer]);
    for(let child=0;child<=8 && roots.length<64;child++) {
      const margin=await groupPda('margin-v2',encoder.encode(portfolio),u16(child));
      await h.send('cohort immutable margin root',[await sdk.getRegisterMarginV2InstructionAsync({...common,owner:signer,portfolio,margin,
        subaccountIndex:child,mode:child===0?0:1,isolatedMarketIndex:child===0?255:child%2,role:0})],[signer]);roots.push(margin);
    }
  }
  const overflow=await groupPda('margin-v2',encoder.encode(operators[0].portfolio),u16(3));
  await reject('reject registry member 65',[await sdk.getRegisterMarginV2InstructionAsync({...common,owner,portfolio:operators[0].portfolio,margin:overflow,
    subaccountIndex:3,mode:1,isolatedMarketIndex:0,role:0})],[owner],sdk.CLEARING_ERROR__CAPACITY);
  assert.equal(await h.read(overflow),null,'failed account initialization rolled back');
  await certificate();
  const completeStamp=await fixture.stamp();
  const rewind=sdk.getCheckGroupExitV2Instruction({...safety,...completeStamp,start:0});
  await reject('reject same-stamp completed certificate rewind',[{...rewind,accounts:[...rewind.accounts!,{address:roots[0],role:AccountRole.READONLY}]}],[],sdk.CLEARING_ERROR__EXIT_COHORT);
  await fixture.qualify();
  await h.send('open BTC loss root before complete-group default',[(await route(0,0,[10n,10n])).instruction],[owner]);
  await h.send('open ETH gain sibling before complete-group default',[(await route(1,0,[20n,30n])).instruction],[owner]);
  await fixture.publish(0,{price:10_000_000_000n});await fixture.publish(2,{price:10_000_000_000n});
  await fixture.publish(4,{price:4_000_000_000n});await fixture.publish(5,{price:4_000_000_000n});
  await fixture.qualify();
  const beforeInsurance=await fixture.groupState();assert(beforeInsurance.fees>1_000n);
  await reject('reject foreign fee allocation',[sdk.getAllocateGroupFeesV2Instruction({...common,authority:owner,amount:1n})],[owner],2001);
  await reject('reject allocation beyond funded fees',[sdk.getAllocateGroupFeesV2Instruction({...common,authority:payer,amount:beforeInsurance.fees+1n})],[],sdk.CLEARING_ERROR__ARITHMETIC);
  await h.send('explicit fee allocation to insurance',[sdk.getAllocateGroupFeesV2Instruction({...common,authority:payer,amount:1_000n})]);
  await h.send('actual SPL donation to group vault',[getTransferCheckedInstruction({source:operators[0].token.address,mint:fixture.mint.address,
    destination:fixture.vault,authority:owner,amount:7n,decimals:6})],[owner]);
  await reject('reject foreign surplus classification',[sdk.getClassifyGroupSurplusV2Instruction({...common,authority:owner})],[owner],2001);
  await h.send('classify donated insurance',[sdk.getClassifyGroupSurplusV2Instruction({...common,authority:payer})]);
  const insured=await fixture.groupState();assert.equal(insured.insurance,1_007n);assert.equal(insured.fees,beforeInsurance.fees-1_000n);
  assert.equal(insured.totalCash,beforeInsurance.totalCash);assert.equal(insured.allocatedVault,beforeInsurance.allocatedVault+7n);
  await h.send('pause does not prevent complete-group default',[sdk.getPauseGroupCustodyV2Instruction({...common,authority:payer,paused:true})]);
  await capture('before-default',protectedKeys());
  await h.send('freeze complete mixed-market group',[sdk.getFreezeGroupV2Instruction({...safety,...fixture.sources,...await fixture.stamp(),caller:payer,
    target:operators[0].capital[0],emergency:false})]);
  const readResolution=async()=>sdk.getGroupResolutionV2Decoder().decode((await h.read(fixture.resolution))!);
  const frozen=await readResolution();assert.equal(frozen.header.count,64);assert.equal(frozen.header.stage,2);
  assert.deepEqual([...frozen.header.prices],[10_000n,40_000n]);
  await capture('frozen-default',protectedKeys());
  await reject('reject deposit during frozen default',[await lifecycle.cashInstruction(fixture.cross,1n,false)],[owner],sdk.CLEARING_ERROR__PROFILE);
  await reject('reject fee allocation during frozen default',[sdk.getAllocateGroupFeesV2Instruction({...common,authority:payer,amount:1n})],[],sdk.CLEARING_ERROR__PROFILE);
  const page=async(epoch:bigint,stage:number,start:number,count:number,keys=roots.slice(start,start+count))=>{
    const instruction=sdk.getAdvanceGroupResolutionV2Instruction({...safety,epoch,stage,start});
    return {...instruction,accounts:[...instruction.accounts!,...keys.map(address=>({address,role:[3,10].includes(stage)?AccountRole.WRITABLE:AccountRole.READONLY}))]};
  };
  await reject('reject wrong default epoch',[await page(frozen.header.epoch+1n,2,0,1)],[],sdk.CLEARING_ERROR__RESOLUTION);
  await reject('reject skipped default cursor',[await page(frozen.header.epoch,2,1,1)],[],sdk.CLEARING_ERROR__RESOLUTION);
  await reject('reject duplicate default member',[await page(frozen.header.epoch,2,0,2,[roots[0],roots[0]])],[],sdk.CLEARING_ERROR__RESOLUTION);
  await reject('reject oversized default page',[await page(frozen.header.epoch,2,0,5)],[],sdk.CLEARING_ERROR__RESOLUTION);
  while((await readResolution()).header.stage<=11) {
    const current=(await readResolution()).header;
    const count=Math.min((current.stage%4)+1,64-current.cursor);
    const instruction=await page(current.epoch,current.stage,current.cursor,count);
    await h.send('advance exact complete-group default page',[instruction]);
    if(current.cursor===0)await reject('reject replayed default page',[instruction],[],sdk.CLEARING_ERROR__RESOLUTION);
  }
  const complete=await readResolution();assert.equal(complete.header.stage,12);assert.equal((await fixture.groupState()).settlement,0n);
  for(const root of roots)assert((await fixture.rootState(root)).positions.every(position=>position.lots===0n && position.virtualScaled===0n));
  await capture('complete-default',protectedKeys());
  async function recover(resume:boolean,caller=payer){return sdk.getRecoverGroupResolutionV2Instruction({...safety,...fixture.sources,epoch:complete.header.epoch,resume,caller});}
  await reject('reject resume before fresh recovery',[await recover(true)],[],sdk.CLEARING_ERROR__RESOLUTION);
  for(let round=0;round<4;round++){
    await h.advance(2n);for(let index=0;index<6;index++)await fixture.publish(index);
    await h.send('independent all-market recovery observation',[await recover(false)]);
  }
  await reject('reject unauthorized resume',[await recover(true,owner)],[owner],sdk.CLEARING_ERROR__AUTHORITY);
  await h.send('authority resumes reconciled isolated group',[await recover(true)]);
  assert.equal((await fixture.groupState()).mode,1);
  await capture('resumed-default',protectedKeys());
  return {readResolution,page};
}
