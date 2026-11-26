import assert from 'node:assert/strict';
import {AccountRole,address,type Address} from '@solana/kit';
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

type MarketIndex = 0 | 1;
type WorkClass = 'collection' | 'payment' | 'maintenance';
type Candidate = { margin: Address; marketIndex: MarketIndex };
type WorkerSnapshot = Awaited<ReturnType<AccountRuntime['snapshot']>>;
export type SettlementSchedule = { next: WorkClass; collectionMarket: MarketIndex; lastPayment?: Candidate };
const workOrder = {
  collection: ['collection', 'payment', 'maintenance'],
  payment: ['payment', 'maintenance', 'collection'],
  maintenance: ['maintenance', 'collection', 'payment'],
} as const;

export async function settleAccounts(runtime: AccountRuntime, key: Keypair, allowBackgroundPage = true,
  schedule: SettlementSchedule = { next: 'collection', collectionMarket: 0 }): Promise<AccountWorkerOutcome> {
  const budget = await runtime.budget('settlement', key);
  if (await runtime.pendingBudget(budget)) return { status: 'blocked', reason: 'original-settlement-intent-pending' };
  const { binding, state } = await runtime.discovery();
  const directCredit = binding.artifactSet === sdk.DIRECT_CREDIT_ARTIFACT_SET;
  const gains: Candidate[] = [], losses: [Address[], Address[]] = [[], []];
  let paymentOffset = 0;
  for (const member of state.members) {
    const margin = address(member), snapshot = await runtime.snapshot([margin]);
    if (snapshot.safetyState.mode !== 1 || snapshot.safetyState.paused) return { status: 'blocked', reason: 'venue-mode' };
    for (const marketIndex of [0, 1] as const) {
      const amount = accountClaimAmount(snapshot, margin, marketIndex, false);
      if (amount > 0n) {
        // The common collection-first case can submit without scanning the rest of the venue.
        if (schedule.next === 'collection' && marketIndex === schedule.collectionMarket) {
          const result = await collect(snapshot, margin, marketIndex, amount);
          if (result) return result;
        } else losses[marketIndex].push(margin);
      }
      if (accountClaimAmount(snapshot, margin, marketIndex, true) > 0n) gains.push({ margin, marketIndex });
      // Resume in discovery order even if the previous payee no longer has a claim.
      if (schedule.lastPayment?.margin === margin && schedule.lastPayment.marketIndex === marketIndex) paymentOffset = gains.length;
    }
  }

  // A backing turn may atomically pay a claimant too, so use the same order for both.
  const orderedGains = paymentOffset > 0 ? gains.slice(paymentOffset).concat(gains.slice(0, paymentOffset)) : gains;
  let pageDeferred = false;
  for (const turn of workOrder[schedule.next]) {
    if (turn === 'collection') {
      for (const marketIndex of [schedule.collectionMarket, schedule.collectionMarket === 0 ? 1 : 0] as const) {
        for (const margin of losses[marketIndex]) {
          const snapshot = await runtime.snapshot([margin]);
          const amount = accountClaimAmount(snapshot, margin, marketIndex, false);
          if (amount > 0n) {
            const result = await collect(snapshot, margin, marketIndex, amount);
            if (result) return result;
          }
        }
      }
    } else {
      if (directCredit && turn === 'maintenance') continue;
      const visited = new Set<MarketIndex>();
      for (const gain of orderedGains) {
        if (visited.has(gain.marketIndex)) continue;
        const result = await scheduleGain(gain, turn);
        if (result === 'needs-backing-work' || turn === 'maintenance') visited.add(gain.marketIndex);
        if (!result || result === 'needs-backing-work') continue;
        if (result.reason === 'background-page-interval') { pageDeferred = true; continue; }
        if (result.reason === 'direct-market-gain' || result.reason === 'certified-market-gain' || result.reason === 'atomic-backing-page-and-gain') {
          schedule.lastPayment = gain;
        }
        schedule.next = result.reason === 'certified-market-gain' ? 'maintenance' : 'collection';
        return result;
      }
    }
  }
  if (pageDeferred) return { status: 'idle', reason: 'background-page-interval' };
  return { status: 'idle', reason: gains.length ? 'backing-or-current-source-unavailable' : 'no-admissible-whole-atom-claim' };

  async function collect(snapshot: WorkerSnapshot, margin: Address, marketIndex: MarketIndex, amount: bigint):
    Promise<AccountWorkerOutcome | undefined> {
    const root = snapshot.roots[margin];
    try {
      const collection = sdk.getCollectAccountLossInstruction({ ...snapshot,
        ...sdk.accountMarketMetas(snapshot.markets, [root], 1 << marketIndex),
        ...sdk.accountLiabilityMetas(snapshot.ledgers, [root], 1 << marketIndex), actor: key, margin, marketIndex, amount });
      const lane = directCredit ? (await sdk.deriveCoverageLanes(snapshot.venue))[Number(root.id % 8n)] : undefined;
      const instruction = lane ? {...collection, accounts:[...collection.accounts, {address:lane,role:AccountRole.WRITABLE}]} : collection;
      const queued = await runtime.enqueue(`keeper:loss:${root.id}:${marketIndex}:${root.stateVersion}`,
        await settlementInstructions(snapshot, sdk.routeComputeBudget(), instruction),
        key, budget, { kind: 'accountStateVersion', venue: snapshot.venue, account: margin, value: root.stateVersion.toString() }, true);
      if (!queued) return;
    } catch (error) {
      if (error instanceof Error && error.message === 'Risk action presently unavailable') return;
      throw error;
    }
    schedule.next = 'payment';
    schedule.collectionMarket = marketIndex === 0 ? 1 : 0;
    return { status: 'queued', reason: 'funded-account-loss' };
  }

  async function scheduleGain({margin,marketIndex}:Candidate,turn:'payment'|'maintenance'):
    Promise<AccountWorkerOutcome|'needs-backing-work'|undefined>{
    const snapshot=await runtime.snapshot([margin]);
    if (directCredit) {
      const amount = accountClaimAmount(snapshot, margin, marketIndex, true);
      if (!amount) return;
      const root = snapshot.roots[margin];
      const credit = await sdk.directClosedProfitCredit({artifactSet:binding.artifactSet, actor:key, margin:root, marketIndex, amount});
      try {
        const queued = await runtime.enqueue(`keeper:gain:${root.id}:${marketIndex}:${root.stateVersion}`,
          [sdk.routeComputeBudget(), ...credit], key, budget,
          {kind:'accountStateVersion',venue:snapshot.venue,account:margin,value:root.stateVersion.toString()}, true);
        if (queued) return {status:'queued',reason:'direct-market-gain'};
      } catch (error) {
        if (!(error instanceof Error && error.message === 'Risk action presently unavailable')) throw error;
      }
      return;
    }
    const [certificate,bump]=await sdk.deriveSettlementCertificate(snapshot.venue,marketIndex);
    const response=await runtime.rpc.call('getMultipleAccounts',[[snapshot.registry,certificate],{encoding:'base64',commitment:'confirmed'}]);
    const registry=decodeAccountWorker(response.value[0],sdk.VENUE_REGISTRY_DISCRIMINATOR,sdk.getVenueRegistryDecoder());
    const [,registryBump]=await sdk.deriveVenueComponent(snapshot.venue,'registry');
    assert(registry.schemaVersion===10&&registry.venue===snapshot.venue&&registry.bump===registryBump&&registry.financialCount>0n&&registry.financialCount<=registry.registeredCount&&registry.registeredCount<=registry.nextId&&
      registry.liveIndex===(await sdk.deriveMemberIndex(snapshot.venue,14,0n))[0],'Invalid backing registry');
    try {
      if(!response.value[1]) {
        if(turn==='payment')return 'needs-backing-work';
        if(!allowBackgroundPage)return {status:'idle',reason:'background-page-interval'};
        const queued=await runtime.enqueue(`keeper:certificate:${marketIndex}`,[sdk.routeComputeBudget(),
          sdk.getInitializeMarketBackingInstruction({...snapshot,payer:key,certificate,marketIndex})],key,budget,null,true);
        if(!queued)return;
        return {status:'queued',reason:'initialize-market-backing'};
      }
      const proof=decodeAccountWorker(response.value[1],sdk.SETTLEMENT_CERTIFICATE_DISCRIMINATOR,sdk.getSettlementCertificateDecoder());
      assert(proof.schemaVersion===10&&proof.venue===snapshot.venue&&proof.marketIndex===marketIndex&&proof.bump===bump,'Foreign backing certificate');
      const status=sdk.accountBackingStatus(snapshot,registry,proof);
      const complete=status.complete;
      if(status.current&&!status.sourcesCurrent)return;
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
        const queued=await runtime.enqueue(`keeper:proof:${marketIndex}:${proof.backingEpoch}:${registry.membershipEpoch}:${proof.revision}`,
          await settlementInstructions(snapshot,sdk.resolutionComputeBudget(),page,...(payment?[payment]:[])),key,budget,
          payment?{kind:'accountStateVersion',venue:snapshot.venue,account:margin,value:snapshot.roots[margin].stateVersion.toString()}:
            {kind:'backingRevision',venue:snapshot.venue,account:certificate,value:proof.revision.toString()},true);
        if(!queued)return;
        return {status:'queued',reason:payment?'atomic-backing-page-and-gain':'complete-market-backing-page'};
      }
      if(!status.payable||turn==='maintenance')return;
      const amount=accountClaimAmount(snapshot,margin,marketIndex,true);if(!amount)return;
      const queued=await runtime.enqueue(`keeper:gain:${snapshot.roots[margin].id}:${marketIndex}:${snapshot.roots[margin].stateVersion}`,
        await settlementInstructions(snapshot,sdk.routeComputeBudget(),sdk.getPayAccountGainInstruction({...snapshot,
          ...sdk.accountMarketMetas(snapshot.markets,[snapshot.roots[margin]],(1<<marketIndex)|status.requiredMask),
          ...sdk.accountLiabilityMetas(snapshot.ledgers,[snapshot.roots[margin]],1<<marketIndex),actor:key,margin,certificate,marketIndex,amount})),key,budget,
        {kind:'accountStateVersion',venue:snapshot.venue,account:margin,value:snapshot.roots[margin].stateVersion.toString()},true);
      if(!queued)return;
      return {status:'queued',reason:'certified-market-gain'};
    } catch(error) {if(!(error instanceof Error&&error.message==='Risk action presently unavailable'))throw error;}
  }
}
