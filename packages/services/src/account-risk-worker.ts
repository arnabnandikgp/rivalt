import assert from 'node:assert/strict';
import {address,type Address,type Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {quantityCandidates} from './quantity-candidates.js';
import type {AccountRuntime,AccountWorkerOutcome} from './account-runtime.js';
import type {AccountAuthority} from './account-authority.js';
import {accountRiskSources,readAccountResolution,accountDefaultContext} from './account-worker-state.js';

import {accountDefaultStep} from './account-default-worker.js';
import {accountDefaultBatch,defaultBatchComputeBudget} from './account-default-batch.js';

/** Exact schema-10 bindings qualify the paged controller; old journals reject. */
export const CANONICAL_DEFAULT_AUTOMATION_READY=true;

export async function accountRiskWork(runtime:AccountRuntime,key:Keypair,receiver?:Address):Promise<AccountWorkerOutcome> {
  const budget=await runtime.budget('risk',key);
  if(await runtime.pendingBudget(budget))return {status:'blocked',reason:'original-risk-intent-pending'};
  const submit=async(id:string,instruction:Instruction|Instruction[],resolution=false,authority:AccountAuthority|null=null)=>{
    try {
      // Frozen continuation has no invented expiry proof. Unknown originals hold
      // the budget; history/reconciliation must resolve them before any new wire.
      await runtime.enqueue(`risk:${id}`,[resolution?(Array.isArray(instruction)?defaultBatchComputeBudget():sdk.resolutionComputeBudget()):sdk.liquidationComputeBudget(),...(Array.isArray(instruction)?instruction:[instruction])],key,budget,authority,true);
      return true;
    } catch(error) {if(error instanceof Error&&error.message==='Risk action presently unavailable')return false;throw error;}
  };
  // An already frozen source supplies complete membership authority. Continuing
  // it needs immutable deployment binding, not fresh live candidate discovery.
  if(runtime.deploymentSelection==='account-scale-candidate'||runtime.deploymentSelection==='selected') {
    const binding=await runtime.environment(),frozen=await readAccountResolution(runtime.rpc,address(binding.venue));
    if([2,14].includes(frozen.header.stage)) {
      const step=await accountDefaultStep(runtime,key,frozen,await accountDefaultContext(runtime.rpc,frozen));
      if(step.status==='blocked')return step;
      if((runtime.defaultContinuationSteps??1)>1) {
        const batch=await accountDefaultBatch(runtime,key,frozen,step,runtime.defaultContinuationSteps);
        if(!batch.steps.length)return {status:'blocked',reason:`default-batch-${batch.stop}`};
        return await submit(`${step.id}:batch:${batch.steps.length}`,batch.steps.map(value=>value.instruction),true)?
          {status:'queued',reason:`${step.reason}:batch:${batch.steps.length}`}:{status:'blocked',reason:'default-batch-presently-unavailable'};
      }
      return await submit(step.id,step.instruction,true)?{status:'queued',reason:step.reason}:
        {status:'blocked',reason:'default-step-presently-unavailable'};
    }
  }
  const {state}=await runtime.discovery(),snapshot=await runtime.snapshot();
  const continuation=await readAccountResolution(runtime.rpc,snapshot.venue),{header}=continuation;
  const common={...snapshot,...continuation,...accountRiskSources(snapshot)};
  if(snapshot.safetyState.mode===2) {
    if(header.stage===1)return await submit(`value:${header.epoch}`,sdk.getValueAccountResolutionInstruction({...common,epoch:header.epoch}),true)?
      {status:'queued',reason:'awaited-complete-cohort-valuation'}:{status:'blocked',reason:'closeout-sources-unavailable'};
    if([2,14].includes(header.stage))return {status:'blocked',reason:'default-candidate-binding-required'};
    return {status:'blocked',reason:'unsupported-frozen-stage'};
  }
  if(snapshot.safetyState.mode===3&&header.stage===11) {
    const safety=snapshot.safetyState;
    if(snapshot.now-safety.recoveryLast<2n)return {status:'idle',reason:'recovery-check-not-due'};
    if(safety.recoverySince>0n&&safety.recoveryLast-safety.recoverySince>=6n)return {status:'blocked',reason:'explicit-authority-resume-required'};
    const attempts=await runtime.store.pool.query('SELECT count(*)::int AS count FROM service_intents WHERE run_id=$1 AND starts_with(request_id,$2)',
      [runtime.runId,`risk:check:${header.epoch}:`]);
    if(attempts.rows[0].count>=8)return {status:'blocked',reason:'bounded-recovery-checks-exhausted'};
    return await submit(`check:${header.epoch}:${safety.recoveryLast}`,sdk.getRecoverAccountsInstruction({...common,caller:key,epoch:header.epoch,resume:false}),true)?
      {status:'queued',reason:'permissionless-account-recovery-check'}:{status:'blocked',reason:'fresh-recovery-sources-unavailable'};
  }
  if(snapshot.safetyState.mode!==1)return {status:'blocked',reason:'venue-mode'};
  const candidates=state.members.filter(member=>state.roots[member].positions.some(position=>BigInt(position.lots)!==0n||BigInt(position.virtualScaled)<0n));
  const probes=candidates.length?Array.from({length:Math.min(2,candidates.length)},(_,offset)=>address(candidates[(runtime.riskProbeCursor+offset)%candidates.length])):[];
  runtime.riskProbeCursor=candidates.length?(runtime.riskProbeCursor+probes.length)%candidates.length:0;
  for(const target of probes) {
    const instruction=sdk.getFreezeAccountsInstruction({...common,caller:key,target,members:(await sdk.deriveMemberPage(snapshot.venue,BigInt(state.roots[target].id)/64n))[0],safetyEpoch:snapshot.safetyState.epoch,
      resolutionEpoch:header.epoch,emergency:false});
    if(await submit(`freeze:${header.epoch}:${target}:${snapshot.custodyState.revision}`,instruction))return {status:'queued',reason:'authenticated-net-insolvency'};
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
      for(const lots of quantityCandidates(absolute)) {
        const instruction=sdk.getLiquidateAccountInstruction({...current,receiverOwner:key,target,receiver,
          ...sdk.accountMarketMetas(current.markets,[root,capital],1<<marketIndex),
          ...sdk.accountLiabilityMetas(current.ledgers,[root,capital]),
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
