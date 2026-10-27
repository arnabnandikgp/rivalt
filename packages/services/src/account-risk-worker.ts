import assert from 'node:assert/strict';
import {AccountRole,address,type Address,type Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import type {AccountRuntime,AccountWorkerOutcome} from './account-runtime.js';
import type {AccountAuthority} from './account-authority.js';
import {accountRemainderOrders,accountRiskSources,readAccountResolution} from './account-worker-state.js';
import {readAccountRateProposal} from './account-frozen-proposal.js';

/** Each call resumes exactly the current on-chain cursor. Proposal/order data is
 * untrusted; neither the worker nor the queue computes authoritative payouts. */
export async function accountResolutionInstruction(runtime:AccountRuntime,snapshot:Awaited<ReturnType<AccountRuntime['snapshot']>>,
  continuation:Awaited<ReturnType<typeof readAccountResolution>>) {
  const {header,workState,rows,pages,registryState}=continuation;
  const common={...snapshot,...continuation,epoch:header.epoch},start=header.cursor;
  if(header.stage===4) {
    const {header:current,proposal}=await readAccountRateProposal(runtime.rpc,snapshot.venue,header.epoch);
    assert(current.evaluation===header.evaluation,'Rate evaluation advanced; reread');
    const matches=sdk.hex(current.proposalHash)===sdk.hex(proposal.hash);
    const offset=matches?current.proposalUploaded:0;
    assert(offset>=0&&offset<proposal.bytes.length&&offset%8===0,'Invalid rate upload cursor');
    return sdk.getProposeAccountResolutionV3Instruction({...common,evaluation:current.evaluation,proposalHash:proposal.hash,offset,
      bytes:proposal.bytes.subarray(offset,Math.min(proposal.bytes.length,offset+512))});
  }
  if(header.stage===5&&start===header.count)return sdk.getFinalizeAccountResolutionRatesV3Instruction(common);
  if(header.stage===7) {
    if(workState.limbCursor===0) {
      assert(start===0,'Uncommitted remainder ordering');
      const denominator=header.flowDenominator.limbs.reduceRight((total,limb)=>(total<<64n)+limb,0n);
      return sdk.getOrderAccountResolutionV3Instruction({...common,orders:accountRemainderOrders(rows,denominator)});
    }
    assert(start<2*header.count,'Invalid order verification cursor');
    const id=workState.marketEdgeOrder[Math.floor(start/header.count)][start%header.count];
    assert(id<header.count,'Invalid proposed member');
    return sdk.getCheckAccountResolutionOrderV3Instruction({...common,page:pages[Math.floor(id/2)],start});
  }
  if(header.stage===8)return sdk.getRoundAccountResolutionV3Instruction({...common,start});
  assert([2,3,5,6,9,10].includes(header.stage)&&start<header.count,'No bounded resolution page due');
  const length=[5,6].includes(header.stage)?1:Math.min(2-start%2,header.count-start);
  const instruction=sdk.getAdvanceAccountResolutionV3Instruction({...common,page:pages[Math.floor(start/2)],stage:header.stage,start,length});
  const members=[2,9,10].includes(header.stage)?registryState.members.slice(start,start+length):[];
  return {...instruction,accounts:[...instruction.accounts,...members.map(address=>({address,
    role:header.stage===9?AccountRole.WRITABLE:AccountRole.READONLY}))]};
}

export async function accountRiskWork(runtime:AccountRuntime,key:Keypair,receiver?:Address):Promise<AccountWorkerOutcome> {
  const budget=await runtime.budget('risk',key);
  if(await runtime.pendingBudget(budget))return {status:'blocked',reason:'original-risk-intent-pending'};
  const {state}=await runtime.discovery(),snapshot=await runtime.snapshot();
  const continuation=await readAccountResolution(runtime.rpc,snapshot.venue),{header}=continuation;
  const submit=async(id:string,instruction:Instruction,resolution=false,authority:AccountAuthority|null=null)=>{
    try {
      // Frozen continuation has no invented expiry proof. Unknown originals hold
      // the budget; history/reconciliation must resolve them before any new wire.
      await runtime.enqueue(`risk:${id}`,[resolution?sdk.resolutionComputeBudget():sdk.groupRouteComputeBudget(),instruction],key,budget,authority,true);
      return true;
    } catch(error) {if(error instanceof Error&&error.message==='Risk action presently unavailable')return false;throw error;}
  };
  const common={...snapshot,...continuation,...accountRiskSources(snapshot)};
  if(snapshot.safetyState.mode===2) {
    if(header.stage===1)return await submit(`value:${header.epoch}`,sdk.getValueAccountResolutionV3Instruction({...common,epoch:header.epoch}),true)?
      {status:'queued',reason:'awaited-complete-cohort-valuation'}:{status:'blocked',reason:'closeout-sources-unavailable'};
    if(header.stage>=2&&header.stage<=10) {
      const instruction=await accountResolutionInstruction(runtime,snapshot,continuation);
      // Discovery sequence distinguishes a valid stage reset after a competing
      // invalid proposal. It is a job identity only, never a signed cash guard.
      const id=`page:${header.epoch}:${header.stage}:${header.cursor}:${header.evaluation}:${header.proposalUploaded}:${continuation.workState.limbCursor}:${snapshot.custodyState.sequence}`;
      return await submit(id,instruction,true)?{status:'queued',reason:'complete-account-resolution-step'}:
        {status:'blocked',reason:'resolution-step-simulation-rejected'};
    }
    return {status:'blocked',reason:'unsupported-frozen-stage'};
  }
  if(snapshot.safetyState.mode===3&&header.stage===11) {
    const safety=snapshot.safetyState;
    if(snapshot.now-safety.recoveryLast<2n)return {status:'idle',reason:'recovery-check-not-due'};
    if(safety.recoverySince>0n&&safety.recoveryLast-safety.recoverySince>=6n)return {status:'blocked',reason:'explicit-authority-resume-required'};
    const attempts=await runtime.store.pool.query('SELECT count(*)::int AS count FROM service_intents WHERE run_id=$1 AND starts_with(request_id,$2)',
      [runtime.runId,`risk:check:${header.epoch}:`]);
    if(attempts.rows[0].count>=8)return {status:'blocked',reason:'bounded-recovery-checks-exhausted'};
    return await submit(`check:${header.epoch}:${safety.recoveryLast}`,sdk.getRecoverAccountsV3Instruction({...common,caller:key,epoch:header.epoch,resume:false}),true)?
      {status:'queued',reason:'permissionless-account-recovery-check'}:{status:'blocked',reason:'fresh-recovery-sources-unavailable'};
  }
  if(snapshot.safetyState.mode!==1)return {status:'blocked',reason:'venue-mode'};
  const candidates=state.members.filter(member=>state.roots[member].positions.some(position=>BigInt(position.lots)!==0n||BigInt(position.virtualScaled)<0n));
  const probes=candidates.length?Array.from({length:Math.min(2,candidates.length)},(_,offset)=>address(candidates[(runtime.riskProbeCursor+offset)%candidates.length])):[];
  runtime.riskProbeCursor=candidates.length?(runtime.riskProbeCursor+probes.length)%candidates.length:0;
  for(const target of probes) {
    const instruction=sdk.getFreezeAccountsV3Instruction({...common,caller:key,target,safetyEpoch:snapshot.safetyState.epoch,
      resolutionEpoch:header.epoch,emergency:false});
    if(await submit(`freeze:${header.epoch}:${target}:${snapshot.custodyState.sequence}`,instruction))return {status:'queued',reason:'authenticated-net-insolvency'};
  }
  if(snapshot.safetyState.paused)return {status:'blocked',reason:'venue-paused-after-default-probes'};
  if(!receiver)return {status:'blocked',reason:'no-configured-funded-receiver'};
  for(const target of probes) {
    if(target===receiver)continue;
    const current=await runtime.snapshot([target,receiver]),capital=current.roots[receiver],root=current.roots[target];
    if(capital.owner!==key.address||capital.role===1||capital.cash===0n)return {status:'blocked',reason:'receiver-owner-or-capital-unavailable'};
    const view=sdk.accountBalanceView(root,current.safetyState,current.marketStates,current.now,current.slot);
    if(view.maintenanceDeficitScaled===null||BigInt(view.maintenanceDeficitScaled)===0n)continue;
    for(const marketIndex of [0,1] as const) {
      if(capital.mode===1&&capital.isolatedMarketIndex!==marketIndex)continue;
      const quantity=root.positions[marketIndex].lots,absolute=quantity<0n?-quantity:quantity;
      for(let lots=absolute<64n?absolute:64n;lots>0n;lots/=2n) {
        const instruction=sdk.getLiquidateAccountV3Instruction({...current,receiverOwner:key,target,receiver,
          targetGuard:sdk.accountGuard(current,target),receiverGuard:sdk.accountGuard(current,receiver),marketIndex,lots,price:current.marketStates[marketIndex].referencePrice});
        // Execution checks and advances this consenting receiver's version. At
        // finalized expiry an unchanged canonical version proves no economic
        // effect, while the queue still retains any unseen transaction fee.
        if(await submit(`liquidate:${root.id}:${marketIndex}:${lots}:${root.stateVersion}:${capital.stateVersion}`,instruction,false,
          {kind:'accountStateVersion',venue:current.venue,account:receiver,value:capital.stateVersion.toString()}))
          return {status:'queued',reason:'funded-whole-account-liquidation'};
      }
    }
  }
  return {status:'idle',reason:'no-admissible-post-fee-liquidation'};
}
