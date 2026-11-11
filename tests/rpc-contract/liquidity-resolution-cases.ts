/** Current schema-9 test-operator default driver. Independent Python Fraction /
 * graph expectations are checked against signed deployed effects in every stage.
 * This is not the P56 durable service or expanded-population acceptance. */
import assert from 'node:assert/strict';
import {AccountRole,type Address,type Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {recoveryKey} from './account-membership-setup.js';
import {scanMetas,financialRoots} from './membership-scan-helper.js';
import {denominatorPages} from './settlement-page-plan.js';
import {qualifySettlementRates} from './scalable-settlement-rates-rpc.js';
import {qualifySettlementPlan} from './scalable-settlement-plan-rpc.js';
import {qualifySettlementApplication} from './scalable-settlement-application-rpc.js';

export async function resolveLiquidityCohort(h:CanonicalHarness,setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>,
  roots:Address[],reject:(label:string,instruction:Instruction,error?:number)=>Promise<void>) {
  const initial=sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  assert.equal(initial.stage,2);assert.equal(initial.count,BigInt(roots.length));
  assert.deepEqual(roots,await financialRoots(h,setup.venue,setup.registry));
  const rows=await Promise.all(roots.map(async key=>{const root=sdk.getMarginAccountDecoder().decode((await h.read(key))!);
    return {key,root,cash:root.cash,claims:root.positions.map((position,index)=>
      position.lots*initial.prices[index]*1_000_000_000n+position.virtualScaled
      -position.lots*(initial.funding[index]-position.fundingCheckpointScaled))};}));
  const prepared=await recoveryKey(setup.venue,0),rowPages=await Promise.all(Array.from({length:Math.ceil(roots.length/8)},(_,index)=>recoveryKey(setup.venue,3,0,BigInt(index))));
  const limbPages=await Promise.all([0,1,2].map(register=>recoveryKey(setup.venue,4,register)));
  const common={...setup.safetyCommon,prepared,epoch:initial.epoch};
  const header=async()=>sdk.getPreparedSettlementDecoder().decode((await h.read(prepared))!);
  const send=(label:string,instruction:Instruction)=>h.send(`paged safety ${label}`,[instruction]);
  await send('initialize frozen membership',sdk.getInitializePreparedSettlementInstruction({...common,sourceRevision:initial.revision}));
  for(const [index,page] of rowPages.entries())await send('initialize frozen page',sdk.getInitializeFrozenMarginPageInstruction({...common,page,pageIndex:BigInt(index)}));
  for(const [register,page] of limbPages.entries())await send('initialize denominator page',sdk.getInitializeSettlementLimbPageInstruction({...common,page,register,pageIndex:0n}));
  while((await header()).stage<2) {
    const current=await header(),request=sdk.membershipRequest(current.state.membership,current.count);
    const metas=await scanMetas(h,setup.venue,request);
    if(request.kind==='member') {
      assert.equal(metas[1].address,roots[Number(request.ordinal)]);
      const instruction=sdk.getValuePreparedMemberInstruction({...common,revision:current.revision,members:metas[0].address,
        margin:metas[1].address,page:rowPages[Number(request.ordinal/8n)]});
      await send('value complete Financial member',instruction);
      const row=sdk.getFrozenMarginPageDecoder().decode((await h.read(rowPages[Number(request.ordinal/8n)]))!).rows[Number(request.ordinal%8n)];
      assert.equal(row.id,rows[Number(request.ordinal)].root.id);assert.deepEqual(row.claims,rows[Number(request.ordinal)].claims);
      assert.equal(row.activationGeneration,rows[Number(request.ordinal)].root.activationGeneration);
    }else {
      assert(request.kind==='node'||request.kind==='page');
      await send('advance authenticated membership',sdk.getAdvancePreparedMembershipInstruction({...common,revision:current.revision,index:metas[0].address}));
    }
  }
  const gcd=(left:bigint,right:bigint):bigint=>{while(right)[left,right]=[right,left%right];return left;};
  let expectedCommon=1n,accepted=0;
  for(let steps=0;(await header()).stage===2;steps++) {
    assert(steps<10000,'bounded denominator qualification');const current=await header(),checkpoint=Buffer.from(current.state.denominator);
    if(checkpoint[1]===1) {
      const ordinal=Number(checkpoint.readBigUInt64LE(16));assert.equal(ordinal,accepted++);
      const row=rows[ordinal],debts=row.claims.map(claim=>claim<0n?-claim:0n),debt=debts[0]+debts[1];
      const collected=row.cash<debt/1_000_000_000n?row.cash:debt/1_000_000_000n;
      const divisor=collected&&debts.every(value=>value>0n)?debt/gcd(debt,collected*1_000_000_000n*debts[0]):1n;
      expectedCommon=expectedCommon/gcd(expectedCommon,divisor)*divisor;
      await send('accept denominator member',sdk.getAcceptDenominatorRowInstruction({...common,revision:current.revision,page:rowPages[Math.floor(ordinal/8)]}));
    }else {
      const requests=denominatorPages(checkpoint);assert(requests.every(request=>request.index===0n),'this bounded harness uses at most 64 Financial accounts');
      const revisions=await Promise.all(requests.map(async request=>sdk.getSettlementLimbPageDecoder().decode((await h.read(limbPages[request.register]))!).revision));
      while(revisions.length<3)revisions.push(0n);
      const instruction=sdk.getContinueSettlementDenominatorInstruction({...common,revision:current.revision,steps:128,revisions});
      await send('continue checked denominator',{...instruction,accounts:[...instruction.accounts,...requests.map(request=>({address:limbPages[request.register],role:request.writable?AccountRole.WRITABLE:AccountRole.READONLY}))]});
    }
  }
  assert.equal(accepted,roots.length);
  const tracked=[...setup.tracked,...roots,prepared,...rowPages,...limbPages];
  const rejectCurrent=async(label:string,instruction:Instruction,error?:import('./instruction-errors.js').ExpectedInstructionError)=>{
    const before=await Promise.all(tracked.map(h.read));await h.send(`paged safety reject ${label}`,[instruction],[],error??sdk.CLEARING_ERROR__RESOLUTION);
    assert.deepEqual(await Promise.all(tracked.map(h.read)),before);
  };
  const rates=await qualifySettlementRates({h,setup,prepared,epoch:initial.epoch,rows,rowPages,limbPages,tracked,expectedCommon,hostileChecks:false,reject:rejectCurrent});
  const plan=await qualifySettlementPlan({h,setup,prepared,rates:rates.rates,epoch:initial.epoch,rows,rowPages,limbPages,tracked,reject:rejectCurrent});
  const applied=await qualifySettlementApplication({h,setup,prepared,rates:rates.rates,plan:plan.plan,epoch:initial.epoch,
    rowPages,rows,expected:plan.expected,tracked,reject:rejectCurrent,checkpoint:async()=>{},stopBeforeExitAndRecovery:true});
  assert.equal(applied.finalSource.stage,11);
  return {initial,verified:rates.state,rounded:plan.state,plannedCash:plan.expected.cash.map(BigInt),proofs:rates.reference,
    graph:plan.state,frozenInputs:rows,tracked,applied};
}
