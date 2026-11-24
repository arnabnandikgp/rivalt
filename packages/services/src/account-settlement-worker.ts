import assert from 'node:assert/strict';
import {address,type Address} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import type {AccountRuntime,AccountWorkerOutcome} from './account-runtime.js';
import {settlementInstructions} from './settlement-checkpoints.js';
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
  const eligible=sdk.ordinaryGainAtoms(claim,root.positions[marketIndex].lots,snapshot.marketStates[marketIndex].referencePrice,
    snapshot.closedEntries[margin]?.[marketIndex]);
  const amount=minimum(eligible,snapshot.ledgerStates[marketIndex].settlement,1_000_000_000_000_000n-root.cash);
  if(amount<=0n)return 0n;
  const candidate=structuredClone(root);candidate.cash+=amount;candidate.positions[marketIndex].virtualScaled-=amount*SCALE;
  const after=sdk.accountBalanceView(candidate,snapshot.safetyState,snapshot.marketStates,snapshot.now,snapshot.slot);
  return after.riskEquityScaled!==null&&after.initialMargin!==null&&
    BigInt(after.riskEquityScaled)>=(BigInt(after.initialMargin)+BigInt(after.reserved))*SCALE?amount:0n;
}

export function accountBackingCurrent(snapshot:sdk.AccountSnapshot,registry:sdk.VenueRegistry,proof:sdk.SettlementCertificate) {
  const status=sdk.accountBackingStatus(snapshot,registry,proof);
  return status.current&&status.sourcesCurrent;
}

export async function settleAccounts(runtime:AccountRuntime,key:Keypair,allowBackgroundPage=true,offerMaintenanceTurn=false):Promise<AccountWorkerOutcome> {
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
            await settlementInstructions(snapshot,sdk.routeComputeBudget(),sdk.getCollectAccountLossInstruction({...snapshot,
              ...sdk.accountMarketMetas(snapshot.markets,[snapshot.roots[margin]],1<<marketIndex),
              ...sdk.accountLiabilityMetas(snapshot.ledgers,[snapshot.roots[margin]],1<<marketIndex),actor:key,margin,marketIndex,amount})),key,budget,
            {kind:'accountStateVersion',venue:snapshot.venue,account:margin,value:snapshot.roots[margin].stateVersion.toString()},true);
          return {status:'queued',reason:'funded-account-loss'};
        } catch(error) {if(!(error instanceof Error&&error.message==='Risk action presently unavailable'))throw error;}
      }
      if(accountClaimAmount(snapshot,margin,marketIndex,true)>0n)gains.push({margin,marketIndex});
    }
  }
  // Preserve collection priority and the discovery order within each market.
  // Only standalone work on another market's certificate can be postponed.
  if(offerMaintenanceTurn && allowBackgroundPage){
    const visited=new Set<0|1>();
    for(const gain of gains){
      if(visited.has(gain.marketIndex))continue;
      visited.add(gain.marketIndex);
      const outcome=await scheduleGain(gain,'maintenance');
      if(outcome && outcome!=='needs-backing-work')return outcome;
    }
  }
  const deferred=new Map<0|1, typeof gains[number]>();
  for(const gain of gains){
    if(deferred.has(gain.marketIndex))continue;
    const result=await scheduleGain(gain,'payment');
    if(result==='needs-backing-work')deferred.set(gain.marketIndex,gain);
    else if(result)return result;
  }
  let pageDeferred=false;
  for(const gain of deferred.values()){
    const result=await scheduleGain(gain,'any');
    if(result && result!=='needs-backing-work'){
      if(result.reason==='background-page-interval'){pageDeferred=true;continue;}
      return result;
    }
  }
  if(pageDeferred)return {status:'idle',reason:'background-page-interval'};
  return {status:'idle',reason:gains.length?'backing-or-current-source-unavailable':'no-admissible-whole-atom-claim'};

  async function scheduleGain({margin,marketIndex}:typeof gains[number],turn:'payment'|'maintenance'|'any'):
    Promise<AccountWorkerOutcome|'needs-backing-work'|undefined>{
    const snapshot=await runtime.snapshot([margin]),[certificate,bump]=await sdk.deriveSettlementCertificate(snapshot.venue,marketIndex);
    const response=await runtime.rpc.call('getMultipleAccounts',[[snapshot.registry,certificate],{encoding:'base64',commitment:'confirmed'}]);
    const registry=decodeAccountWorker(response.value[0],sdk.VENUE_REGISTRY_DISCRIMINATOR,sdk.getVenueRegistryDecoder());
    const [,registryBump]=await sdk.deriveVenueComponent(snapshot.venue,'registry');
    assert(registry.schemaVersion===10&&registry.venue===snapshot.venue&&registry.bump===registryBump&&registry.financialCount>0n&&registry.financialCount<=registry.registeredCount&&registry.registeredCount<=registry.nextId&&
      registry.liveIndex===(await sdk.deriveMemberIndex(snapshot.venue,14,0n))[0],'Invalid backing registry');
    if(!response.value[1]) {
      if(turn==='payment')return 'needs-backing-work';
      await runtime.enqueue(`keeper:certificate:${marketIndex}`,[sdk.routeComputeBudget(),
        sdk.getInitializeMarketBackingInstruction({...snapshot,payer:key,certificate,marketIndex})],key,budget,null,true);
      return {status:'queued',reason:'initialize-market-backing'};
    }
    const proof=decodeAccountWorker(response.value[1],sdk.SETTLEMENT_CERTIFICATE_DISCRIMINATOR,sdk.getSettlementCertificateDecoder());
    assert(proof.schemaVersion===10&&proof.venue===snapshot.venue&&proof.marketIndex===marketIndex&&proof.bump===bump,'Foreign backing certificate');
    const status=sdk.accountBackingStatus(snapshot,registry,proof);
    const complete=status.complete;
    if(status.current&&!status.sourcesCurrent)return;
    try {
      if(!complete) {
        // Ordinary in-region observations preserve coverage. A partial scan can
        // restart for a still-unseen dependency outside its conservative region.
        const restart=status.restart;
        const request=restart?sdk.initialMembershipRequest(registry.financialCount):
          sdk.membershipRequest(proof.membership.checkpoint,proof.count);
        assert(request.kind!=='done','Complete cursor without completed backing');
        const amount=accountClaimAmount(snapshot,margin,marketIndex,true);
        // Traversal closes its ancestor frames after the final root. The final
        // root alone is not a complete-cohort proof.
        const payOnCompletion=!restart&&status.arithmeticReady&&status.sourcesCurrent&&request.kind==='node'&&request.level===14&&proof.next===proof.count&&amount>0n;
        const payment=payOnCompletion?sdk.getPayAccountGainInstruction({...snapshot,actor:key,margin,certificate,marketIndex,amount,
          ...sdk.accountLiabilityMetas(snapshot.ledgers,[snapshot.roots[margin]],1<<marketIndex)}):undefined;
        if(!payment&&turn==='payment')return 'needs-backing-work';
        if(!payment&&!allowBackgroundPage)return {status:'idle',reason:'background-page-interval'};
        const remaining=await sdk.membershipRequestAccounts(runtime.rpc,snapshot.venue,request,true);
        const instruction=sdk.getCheckMarketBackingInstruction({...snapshot,certificate,ledger:snapshot.ledgers[marketIndex],
          revision:proof.revision,restart});
        const page={...instruction,accounts:[...instruction.accounts,...remaining]};
        await runtime.enqueue(`keeper:proof:${marketIndex}:${proof.backingEpoch}:${registry.membershipEpoch}:${proof.revision}`,
          await settlementInstructions(snapshot,sdk.resolutionComputeBudget(),page,...(payment?[payment]:[])),key,budget,
          payment?{kind:'accountStateVersion',venue:snapshot.venue,account:margin,value:snapshot.roots[margin].stateVersion.toString()}:
            {kind:'backingRevision',venue:snapshot.venue,account:certificate,value:proof.revision.toString()},true);
        return {status:'queued',reason:payment?'atomic-backing-page-and-gain':'complete-market-backing-page'};
      }
      if(!status.payable||turn==='maintenance')return;
      const amount=accountClaimAmount(snapshot,margin,marketIndex,true);if(!amount)return;
      await runtime.enqueue(`keeper:gain:${snapshot.roots[margin].id}:${marketIndex}:${snapshot.roots[margin].stateVersion}`,
        await settlementInstructions(snapshot,sdk.routeComputeBudget(),sdk.getPayAccountGainInstruction({...snapshot,
          ...sdk.accountMarketMetas(snapshot.markets,[snapshot.roots[margin]],(1<<marketIndex)|status.requiredMask),
          ...sdk.accountLiabilityMetas(snapshot.ledgers,[snapshot.roots[margin]],1<<marketIndex),actor:key,margin,certificate,marketIndex,amount})),key,budget,
        {kind:'accountStateVersion',venue:snapshot.venue,account:margin,value:snapshot.roots[margin].stateVersion.toString()},true);
      return {status:'queued',reason:'certified-market-gain'};
    } catch(error) {if(!(error instanceof Error&&error.message==='Risk action presently unavailable'))throw error;}
  }
}
