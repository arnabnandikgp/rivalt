import assert from 'node:assert/strict';
import {AccountRole,address,type Address} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import type {AccountRuntime,AccountWorkerOutcome} from './account-runtime.js';
import {decodeAccountWorker} from './account-worker-state.js';

const SCALE=1_000_000_000n;
const minimum=(...values:bigint[])=>values.reduce((left,right)=>left<right?left:right);

/** Unsigned hints only. Whole-account gross debt coverage is mandatory for
 * collection; opposite positive claims never fund it or silently net it. */
export function accountClaimAmount(snapshot:sdk.AccountSnapshot,margin:Address,marketIndex:0|1,gain:boolean) {
  const root=snapshot.roots[margin];
  if(!root||snapshot.safetyState.mode!==1||snapshot.safetyState.paused||root.mode===1&&root.isolatedMarketIndex!==marketIndex)return 0n;
  const view=sdk.accountBalanceView(root,snapshot.safetyState,snapshot.marketStates,snapshot.now,snapshot.slot);
  if(view.positions.some(position=>position.unpaidClaimScaled===null))return 0n;
  const claims=view.positions.map(position=>BigInt(position.unpaidClaimScaled!)),claim=claims[marketIndex];
  if(!gain) {
    const debt=claims.reduce((total,value)=>total+(value<0n?-value:0n),0n);
    return root.cash*SCALE>=debt&&claim<=-SCALE?-claim/SCALE:0n;
  }
  const amount=minimum(claim/SCALE,snapshot.ledgerStates[marketIndex].settlement,1_000_000_000_000_000n-root.cash);
  if(amount<=0n)return 0n;
  const candidate=structuredClone(root);candidate.cash+=amount;candidate.positions[marketIndex].virtualScaled-=amount*SCALE;
  const after=sdk.accountBalanceView(candidate,snapshot.safetyState,snapshot.marketStates,snapshot.now,snapshot.slot);
  return after.riskEquityScaled!==null&&after.initialMargin!==null&&
    BigInt(after.riskEquityScaled)>=(BigInt(after.initialMargin)+BigInt(after.reserved))*SCALE?amount:0n;
}

export function accountBackingCurrent(snapshot:sdk.AccountSnapshot,registry:sdk.VenueRegistry,proof:sdk.SettlementCertificate) {
  const selected=proof.marketIndex;
  if(proof.safetyEpoch!==snapshot.safetyState.epoch||proof.membershipVersion!==registry.membershipVersion||proof.count!==registry.count||
    proof.liabilityVersions[selected]!==snapshot.custodyState.liabilityVersions[selected])return false;
  return snapshot.marketStates.every((market,index)=>{
    if(!(proof.requiredMarketMask&(1<<index)))return true;
    const funding=sdk.effectiveAccountFunding(snapshot.safetyState,market,snapshot.now,snapshot.slot);
    return proof.observations[index]===market.observationSequence&&snapshot.now<proof.sourceDeadlines[index]&&
      proof.fundingBounds[index][0]<=funding&&funding<=proof.fundingBounds[index][1]&&
      ['Normal','Degraded'].includes(sdk.accountSourceMode(snapshot.safetyState,market,snapshot.now,snapshot.slot));
  });
}

export async function settleAccounts(runtime:AccountRuntime,key:Keypair):Promise<AccountWorkerOutcome> {
  const budget=await runtime.budget('settlement',key);
  if(await runtime.pendingBudget(budget))return {status:'blocked',reason:'original-settlement-intent-pending'};
  const {state}=await runtime.discovery();
  const gains:{margin:Address;marketIndex:0|1}[]=[];
  for(const member of state.members) {
    const margin=address(member),snapshot=await runtime.snapshot([margin]);
    if(snapshot.safetyState.mode!==1||snapshot.safetyState.paused)return {status:'blocked',reason:'venue-mode'};
    for(const marketIndex of [0,1] as const) {
      const amount=accountClaimAmount(snapshot,margin,marketIndex,false);
      if(amount>0n) {
        try {
          await runtime.enqueue(`keeper:loss:${snapshot.roots[margin].id}:${marketIndex}:${snapshot.roots[margin].stateVersion}`,
            [sdk.routeComputeBudget(),sdk.getCollectAccountLossInstruction({...snapshot,
              ...sdk.accountMarketMetas(snapshot.markets,[snapshot.roots[margin]],1<<marketIndex),actor:key,margin,marketIndex,amount})],key,budget,
            {kind:'accountStateVersion',venue:snapshot.venue,account:margin,value:snapshot.roots[margin].stateVersion.toString()},true);
          return {status:'queued',reason:'funded-account-loss'};
        } catch(error) {if(!(error instanceof Error&&error.message==='Risk action presently unavailable'))throw error;}
      }
      if(accountClaimAmount(snapshot,margin,marketIndex,true)>0n)gains.push({margin,marketIndex});
    }
  }
  for(const {margin,marketIndex} of gains) {
    const snapshot=await runtime.snapshot([margin]),[certificate,bump]=await sdk.deriveSettlementCertificate(snapshot.venue,marketIndex);
    const response=await runtime.rpc.call('getMultipleAccounts',[[snapshot.registry,certificate],{encoding:'base64',commitment:'confirmed'}]);
    const registry=decodeAccountWorker(response.value[0],sdk.VENUE_REGISTRY_DISCRIMINATOR,sdk.getVenueRegistryDecoder());
    const [,registryBump]=await sdk.deriveVenueComponent(snapshot.venue,'registry');
    assert(registry.schemaVersion===6&&registry.venue===snapshot.venue&&registry.bump===registryBump&&registry.count>0&&registry.count<=64&&
      registry.members.length===registry.count&&new Set(registry.members).size===registry.count,'Invalid backing registry');
    if(!response.value[1]) {
      await runtime.enqueue(`keeper:certificate:${marketIndex}`,[sdk.routeComputeBudget(),
        sdk.getInitializeMarketBackingInstruction({...snapshot,payer:key,certificate,marketIndex})],key,budget,null,true);
      return {status:'queued',reason:'initialize-market-backing'};
    }
    const proof=decodeAccountWorker(response.value[1],sdk.SETTLEMENT_CERTIFICATE_DISCRIMINATOR,sdk.getSettlementCertificateDecoder());
    assert(proof.schemaVersion===6&&proof.venue===snapshot.venue&&proof.marketIndex===marketIndex&&proof.bump===bump,'Foreign backing certificate');
    const current=accountBackingCurrent(snapshot,registry,proof);
    const complete=current&&proof.complete&&proof.next===proof.count;
    try {
      if(!complete) {
        const start=current&&!proof.complete?proof.next:0,members=registry.members.slice(start,start+2);
        assert(members.length>0,'Empty backing page');
        const instruction=sdk.getCheckMarketBackingInstruction({...snapshot,certificate,ledger:snapshot.ledgers[marketIndex],start});
        await runtime.enqueue(`keeper:proof:${marketIndex}:${snapshot.custodyState.liabilityVersions[marketIndex]}:${registry.membershipVersion}:${snapshot.marketStates.map(market=>market.observationSequence).join(':')}:${start}`,
          [sdk.resolutionComputeBudget(),{...instruction,accounts:[...instruction.accounts,...members.map(address=>({address,role:AccountRole.READONLY}))]}],key,budget,null,true);
        return {status:'queued',reason:'complete-market-backing-page'};
      }
      const amount=accountClaimAmount(snapshot,margin,marketIndex,true);if(!amount)continue;
      await runtime.enqueue(`keeper:gain:${snapshot.roots[margin].id}:${marketIndex}:${snapshot.roots[margin].stateVersion}`,
        [sdk.routeComputeBudget(),sdk.getPayAccountGainInstruction({...snapshot,
          ...sdk.accountMarketMetas(snapshot.markets,[snapshot.roots[margin]],(1<<marketIndex)|proof.requiredMarketMask),actor:key,margin,certificate,marketIndex,amount})],key,budget,
        {kind:'accountStateVersion',venue:snapshot.venue,account:margin,value:snapshot.roots[margin].stateVersion.toString()},true);
      return {status:'queued',reason:'certified-market-gain'};
    } catch(error) {if(!(error instanceof Error&&error.message==='Risk action presently unavailable'))throw error;}
  }
  return {status:'idle',reason:gains.length?'backing-or-current-source-unavailable':'no-admissible-whole-atom-claim'};
}
