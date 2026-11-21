import {address,type Address,type Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import type {AccountRuntime,AccountWorkerOutcome} from './account-runtime.js';
import {quantityCandidates} from './quantity-candidates.js';
import {settlementInstructions} from './settlement-checkpoints.js';

type Snapshot = Awaited<ReturnType<AccountRuntime['snapshot']>>;
const scale = 1_000_000_000n;
const absolute = (value:bigint) => value < 0n ? -value : value;
const minimum = (left:bigint,right:bigint) => left < right ? left : right;

// Cap a reference-price transfer at the first size that restores the target.
// Removing a lot at reference cannot worsen the adverse market claim.
// Compare sizes a full maintenance atom apart so fee rounding at low prices
// cannot hide an earlier restoring size. Clearing rechecks the transfer.
function receiverSize(snapshot:Snapshot,target:Address,marketIndex:0|1) {
  const root=snapshot.roots[target],position=root.positions[marketIndex],market=snapshot.marketStates[marketIndex];
  const maxLots=absolute(position.lots);
  const healthy=(lots:bigint)=>{
    const delta=position.lots>0n?-lots:lots;
    const funding=sdk.effectiveAccountFunding(snapshot.safetyState,market,snapshot.now,snapshot.slot);
    const adjusted={...position,lots:position.lots+delta,fundingCheckpointScaled:funding,
      virtualScaled:position.virtualScaled-position.lots*(funding-position.fundingCheckpointScaled)-delta*market.referencePrice*scale};
    const fee=minimum(root.cash,minimum(10_000n,(lots*market.referencePrice+1999n)/2000n));
    const after={...root,cash:root.cash-fee,positions:root.positions.map((entry,index)=>index===marketIndex?adjusted:entry)};
    const view=sdk.accountBalanceView(after,snapshot.safetyState,snapshot.marketStates,snapshot.now,snapshot.slot);
    return view.maintenanceDeficitScaled==='0';
  };
  // For stride s = ceil(20 / upper), maintenance falls by at least
  // floor(s * upper / 20), covering ceil(s * reference / 2000) extra fee.
  // Deficit therefore never increases along any one residue class.
  const stride=(20n+market.upper-1n)/market.upper;
  let result=maxLots;
  for(let first=1n;first<=stride&&first<=result;first++){
    let low=0n,high=(result-first)/stride;
    if(!healthy(first+high*stride))continue;
    while(low<high){
      const middle=(low+high)/2n;
      if(healthy(first+middle*stride))high=middle;else low=middle+1n;
    }
    result=first+low*stride;
  }
  return result;
}

function makerSizes(snapshot:Snapshot,marketIndex:0|1,position:bigint) {
  const limit=absolute(position),side=position>0n?1:0;
  const sizes=new Set(quantityCandidates(limit));
  const books=snapshot.liquidity!.adapters.filter(maker=>!maker.unavailable).map(maker=>maker.depthHints(side));
  for(const [index,depths] of books.entries())for(const depth of depths){
    sizes.add(minimum(depth,limit));
    for(const other of books.slice(index+1))for(const otherDepth of other)sizes.add(minimum(depth+otherDepth,limit));
  }
  return [...sizes].filter(size=>size>0n).sort((left,right)=>left===right?0:left>right?-1:1);
}

async function liquidationCandidates(runtime:AccountRuntime) {
  const {state}=await runtime.discovery();
  const members=state.members.filter(member=>state.roots[member].positions.some(position=>BigInt(position.lots)!==0n));
  const count=Math.min(2,members.length),offset=runtime.riskProbeCursor;
  runtime.riskProbeCursor=members.length?(offset+count)%members.length:0;
  return Array.from({length:count},(_,index)=>address(members[(offset+index)%members.length]));
}

export async function automaticLiquidation(runtime:AccountRuntime,payer:Keypair,budget:string,receiver?:Address,targets?:Address[]):Promise<AccountWorkerOutcome> {
  const candidates=targets??await liquidationCandidates(runtime);
  async function submit(snapshot:Snapshot,id:string,instruction:Instruction,guarded:Address) {
    const before=snapshot.roots[guarded];
    try {
      const instructions=await settlementInstructions(snapshot,sdk.liquidationComputeBudget(),instruction);
      const original=await runtime.enqueue('risk:'+id,instructions,payer,budget,
        {kind:'accountStateVersion',venue:snapshot.venue,account:guarded,value:before.stateVersion.toString()},true);
      return Boolean(original);
    } catch(error) {
      if(error instanceof Error&&error.message==='Risk action presently unavailable')return false;
      throw error;
    }
  }
  let reason='no-under-maintenance-target-in-probe';
  for(const target of candidates){
    const initial=await runtime.snapshot([target]),root=initial.roots[target];
    if(initial.safetyState.mode!==1||initial.safetyState.paused)return {status:'blocked',reason:'venue-mode'};
    const health=sdk.accountBalanceView(root,initial.safetyState,initial.marketStates,initial.now,initial.slot);
    if(health.maintenanceDeficitScaled===null||health.riskEquityScaled===null){reason='liquidation-source-unavailable';continue;}
    if(health.maintenanceDeficitScaled==='0')continue;
    if(BigInt(health.riskEquityScaled)<0n){reason='negative-equity-requires-default-evaluation';continue;}
    const markets=([0,1] as const).filter(market=>root.positions[market].lots!==0n);
    if(root.role===0)for(const marketIndex of markets){
      const live=await runtime.snapshot([target],marketIndex);
      if(live.roots[target].stateVersion!==root.stateVersion)return {status:'blocked',reason:'liquidation-target-changed'};
      const modes=live.marketStates.map(market=>sdk.accountSourceMode(live.safetyState,market,live.now,live.slot));
      if(markets.some(index=>!['Normal','Degraded'].includes(modes[index])))return {status:'blocked',reason:'liquidation-source-unavailable'};
      for(const lots of makerSizes(live,marketIndex,root.positions[marketIndex].lots)) {
        let route:Awaited<ReturnType<typeof sdk.buildMakerLiquidation>>;
        try { route=await sdk.buildMakerLiquidation(live,target,marketIndex,lots,payer.address); }
        catch(error){if(error instanceof sdk.LiquiditySearchLimitError)return {status:'blocked',reason:error.code};throw error;}
        if(route&&await submit(live,`maker-liquidation:${root.id}:${root.stateVersion}:${marketIndex}:${lots}`,route.instructions[0],target))
          return {status:'queued',reason:'admitted-maker-liquidation'};
      }
    }
    reason='no-admissible-maker-or-funded-receiver';
    if(!receiver||receiver===target)continue;
    const current=await runtime.snapshot([target,receiver]),capital=current.roots[receiver];
    if(current.roots[target].stateVersion!==root.stateVersion)return {status:'blocked',reason:'liquidation-target-changed'};
    if(capital.owner!==payer.address||capital.role===1||capital.cash===0n)continue;
    for(const marketIndex of markets){
      if(capital.mode===1&&capital.isolatedMarketIndex!==marketIndex)continue;
      for(const lots of quantityCandidates(receiverSize(current,target,marketIndex))){
        const instruction=sdk.getLiquidateAccountInstruction({...current,receiverOwner:payer,target,receiver,
          ...sdk.accountMarketMetas(current.markets,[root,capital],1<<marketIndex),
          ...sdk.accountLiabilityMetas(current.ledgers,[root,capital],1<<marketIndex),
          targetGuard:sdk.accountGuard(current,target),receiverGuard:sdk.accountGuard(current,receiver),
          marketIndex,lots,price:current.marketStates[marketIndex].referencePrice});
        if(await submit(current,`receiver-liquidation:${root.id}:${root.stateVersion}:${marketIndex}:${capital.id}:${capital.stateVersion}:${lots}`,instruction,receiver))
          return {status:'queued',reason:'funded-whole-account-liquidation'};
      }
    }
  }
  return {status:'idle',reason};
}
