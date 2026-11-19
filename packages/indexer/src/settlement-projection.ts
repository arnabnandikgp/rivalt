/** Financial effects of the authenticated paged settlement, separate from its
 * readonly arithmetic scratch. IDs stay decimal strings on this boundary. */
import type {AccountEvent} from './account-events.js';
import {accountCheck, present, type AccountState} from './account-projection.js';
import {isDeepStrictEqual} from 'node:util';
export type PagedSettlement = {
  plan:string; epoch:string; stage:number; cursor:string; count:string; adoptionRevision:string;
  remainingCash:string; appliedCash:string; marketMovements:string[]; insuranceSpent:string[];
};
const scale=1_000_000_000n;
const eq=(left:unknown,right:unknown,label:string)=>accountCheck(isDeepStrictEqual(left,right),`paged ${label}`);
const claims=(root:AccountState['roots'][string],prices:string[],funding:string[])=>root.positions.map((position,index)=>
  (BigInt(position.virtualScaled)+BigInt(position.lots)*(BigInt(prices[index])*scale-BigInt(funding[index])+BigInt(position.fundingCheckpointScaled))).toString());
export function projectSettlement(state:AccountState,event:AccountEvent,root:(value:any,key?:string)=>void) {
  const change=event.data,current=present(state.resolution,'paged source'),safety=present(state.safety,'paged safety');
  eq(change.epoch,current.epoch,'epoch');
  if(event.type==='FrozenPairVerified'||event.type==='FrozenBtcReductionVerified') {
    eq(current.stage,2,'pair at freeze');eq(current.prices[0],change.mark,'frozen BTC price');
    accountCheck(!current.pair&&change.debtorId!==change.winnerId,'unique frozen pair');
    const debtor=present(state.roots[state.identities[change.debtorId]],'paired debtor');
    const winner=present(state.roots[state.identities[change.winnerId]],'paired winner');
    const gain=BigInt(change.charge),mark=BigInt(change.mark),lots=BigInt(winner.positions[0].lots);
    const quantity=lots<0n?-lots:lots,direction=lots<0n?-1n:1n;
    const residual=event.type==='FrozenBtcReductionVerified';
    const matched=residual?BigInt(change.matchedLots):gain===0n?0n:1n;
    const extra=residual?BigInt(change.extraTickLots):0n;
    const price=residual?change.basePrice:change.price;
    eq(current.remainingGross,[(2n*quantity).toString(),'0'],'unique open pair');
    eq(BigInt(debtor.positions[0].lots),-lots,'opposite lots');
    accountCheck(quantity>0n&&(residual||quantity===1n)&&gain>=0n&&gain<=BigInt(change.unpaidGainCap),'eligible charge');
    accountCheck(matched>=0n&&matched<=quantity&&(matched===0n)===(gain===0n),'matched lots');
    eq(extra,matched===0n?0n:gain%matched,'extra tick lots');
    eq(BigInt(price),matched===0n?0n:mark-direction*(gain/matched),'paired execution price');
    current.pair={debtorId:change.debtorId,winnerId:change.winnerId,charge:change.charge,price,unpaidGainCap:change.unpaidGainCap,
      ...(residual?{matchedLots:change.matchedLots,extraTickLots:change.extraTickLots}:{})};
    return;
  }
  if(event.type==='SettlementMarginApplied') {
    const plan=present(state.pagedSettlement,'adopted plan'),id=BigInt(change.id),ordinal=BigInt(change.ordinal);
    accountCheck(current.stage===14&&plan.stage===9&&ordinal===BigInt(plan.cursor)&&ordinal<BigInt(plan.count),'paged next Apply');
    // Financial ordinal and stable identity are distinct after empty-account churn.
    const member=state.members.find(key=>BigInt(state.roots[key].id)===id);
    eq(member,change.member,'member');
    const previous=present(state.roots[change.member],'original margin');
    const frozen=present(current.rows[previous.id],'frozen row');
    accountCheck(!frozen.applied,'paged once-only root');
    eq(change.cashBefore,previous.cash,'original cash');
    const economic=claims(previous,current.prices,current.funding),pair=current.pair;
    eq(economic,frozen.claimsScaled,'original frozen claims');
    if(pair) {
      const delta=previous.id===pair.debtorId?BigInt(pair.charge):previous.id===pair.winnerId?-BigInt(pair.charge):0n;
      economic[0]=(BigInt(economic[0])+delta*scale).toString();
    }
    eq(change.claims,economic,'claims');
    eq(change.lots,previous.positions.map(position=>position.lots),'lots');
    const movements=change.claims.map((claim:string,index:number)=>BigInt(claim)===0n?0n:(BigInt(claim)<0n?-1n:1n)*BigInt(change.flows[index]));
    eq(BigInt(change.state.cash),BigInt(previous.cash)+movements[0]+movements[1],'payout conservation');
    accountCheck(BigInt(change.state.cash)>=BigInt(frozen.cashBefore)-BigInt(frozen.collected),'retained own cash');
    for(const counter of ['nonce','stateVersion','delegateEpoch'] as const)
      eq(BigInt(change.state[counter]),BigInt(previous[counter])+1n,counter);
    eq(change.state.book.lastOrderId,previous.book.lastOrderId,'order ID');
    eq(change.state.book.lastGroupId,previous.book.lastGroupId,'protection ID');
    eq(change.state.revision,previous.revision,'root predecessor');
    for(let market=0;market<2;market++) {
      current.remainingLots[market]=(BigInt(current.remainingLots[market])-BigInt(change.lots[market])).toString();
      // Unapplied margin accounts still store their original positions. Their
      // running sum differs from the payout basis between the two paired rows.
      current.remainingClaims[market]=(BigInt(current.remainingClaims[market])-BigInt(frozen.claimsScaled[market])).toString();
      const lots=BigInt(change.lots[market]);
      current.remainingGross[market]=(BigInt(current.remainingGross[market])-(lots<0n?-lots:lots)).toString();
      plan.marketMovements[market]=(BigInt(plan.marketMovements[market])+movements[market]).toString();
      state.markets[state.venue!.markets[market]].grossLots=current.remainingGross[market];
    }
    plan.remainingCash=(BigInt(plan.remainingCash)-BigInt(previous.cash)).toString();
    plan.appliedCash=(BigInt(plan.appliedCash)+BigInt(change.state.cash)).toString();
    current.remainingCash=plan.remainingCash;current.appliedCash=plan.appliedCash;
    plan.cursor=(ordinal+1n).toString();
    Object.assign(frozen,{applied:true,flows:change.flows,cashAfter:change.state.cash});
    root(change.state,change.member);
    return;
  }
  accountCheck(event.type==='SettlementPlanProgress','paged event kind');
  let plan=state.pagedSettlement;
  if(!plan) {
    accountCheck(current.stage===2&&current.cursor==='0'&&change.stage===9&&change.cursor==='0','paged adoption transition');
    eq(change.count,String(state.members.length),'complete count');
    eq(change.remainingCash,current.cashBefore,'original total');eq(change.appliedCash,'0','initial payout');
    eq(change.marketMovements,['0','0'],'initial movements');
    accountCheck(BigInt(change.adoptionRevision)>0n,'adoption revision');
    const sourceEntry=Object.values(state.revisions).filter(entry=>entry.kind===10);
    accountCheck(sourceEntry.length===1&&BigInt(sourceEntry[0].revision)+1n===BigInt(change.adoptionRevision),'source revision handover');
    for(let market=0;market<2;market++)accountCheck(BigInt(change.insuranceSpent[market])<=BigInt(current.insuranceBefore[market]),'insurance bound');
    for(const [id,key] of state.members.entries()) {
      const source=state.roots[key],values=claims(source,current.prices,current.funding);
      const debt=values.reduce((sum,value)=>sum+(BigInt(value)<0n?-BigInt(value):0n),0n)/scale;
      const cash=BigInt(source.cash);
      current.rows[source.id]={member:key,originalRevision:source.revision,activationGeneration:source.activationGeneration,cashBefore:source.cash,lots:source.positions.map(position=>position.lots),
        generations:source.positions.map(position=>position.generation),claimsScaled:values,collected:(cash<debt?cash:debt).toString()};
    }
    plan=state.pagedSettlement={plan:change.plan,epoch:change.epoch,stage:9,cursor:'0',count:change.count,
      adoptionRevision:change.adoptionRevision,remainingCash:change.remainingCash,appliedCash:'0',marketMovements:['0','0'],insuranceSpent:change.insuranceSpent};
  } else {
    eq(change.plan,plan.plan,'plan key');eq(change.count,plan.count,'count');eq(change.adoptionRevision,plan.adoptionRevision,'adoption binding');
    eq(change.insuranceSpent,plan.insuranceSpent,'immutable expenditure');
    const transition=plan.stage===9&&(change.stage===9&&change.cursor===plan.cursor
      ||change.stage===10&&plan.cursor===plan.count&&change.cursor==='0')
      ||plan.stage===10&&BigInt(change.cursor)===BigInt(plan.cursor)+1n
        &&change.stage===(change.cursor===plan.count?11:10)
      ||plan.stage===11&&change.stage===12&&change.cursor===plan.count;
    accountCheck(transition,'paged stage/cursor transition');
    eq(change.remainingCash,plan.remainingCash,'remaining original cash');eq(change.appliedCash,plan.appliedCash,'applied cash');
    eq(change.marketMovements,plan.marketMovements,'market movements');
  }
  eq(change.gross,current.remainingGross,'remaining gross');
  eq(change.allocated,state.custody!.allocatedVault,'allocated vault');
  accountCheck(BigInt(change.actualVault)>=BigInt(change.allocated),'vault deficit');
  eq(change.fees,current.feesBefore,'protected fees');
  const distributed=change.stage>=10,completed=change.stage===12;
  for(const ledger of Object.values(state.ledgers)) {
    const market=ledger.marketIndex;
    eq(change.pools[market],distributed?'0':current.poolsBefore[market],'settlement bucket');
    eq(change.insurance[market],(BigInt(current.insuranceBefore[market])-(distributed?BigInt(plan.insuranceSpent[market]):0n)).toString(),'insurance ownership');
    const distributing=plan.stage===9&&change.stage===10;
    eq(BigInt(change.ledgerVersions[market]),BigInt(ledger.version)+(distributing?1n:0n),'ledger version');
    eq(BigInt(change.liabilityVersions[market]),BigInt(ledger.liabilityVersion)+(distributing?1n:0n),'liability version');
    accountCheck(typeof change.insuranceFeeRemainders==='string'&&/^[0-9a-f]{4}$/.test(change.insuranceFeeRemainders),'carry encoding');
    eq(Buffer.from(change.insuranceFeeRemainders,'hex')[market],ledger.insuranceFeeRemainder,'protected fee carry');
    Object.assign(ledger,{settlement:change.pools[market],insurance:change.insurance[market],version:change.ledgerVersions[market],liabilityVersion:change.liabilityVersions[market]});
  }
  if(distributed) {
    eq(plan.remainingCash,'0','all original cash processed');
    eq(plan.marketMovements,current.poolsBefore.map((pool,index)=>(BigInt(pool)+BigInt(plan!.insuranceSpent[index])).toString()),'complete market conservation');
    eq(plan.appliedCash,(BigInt(current.cashBefore)+plan.marketMovements.reduce((sum,value)=>sum+BigInt(value),0n)).toString(),'complete cash conservation');
  }
  eq(change.resolutionStage,completed?11:14,'source stage');
  eq(change.mode,completed?3:2,'safety mode');eq(change.paused,!completed,'paused');
  eq(BigInt(change.safetyEpoch),BigInt(safety.epoch)+(completed?1n:0n),'safety epoch');
  current.stage=change.resolutionStage;
  if(completed) {
    current.cursor=current.count;current.safetyEpoch=change.safetyEpoch;
    current.insuranceSpent=plan.insuranceSpent;current.budgets=plan.marketMovements;
  }
  Object.assign(safety,{mode:change.mode,paused:change.paused,epoch:change.safetyEpoch});
  plan.stage=change.stage;plan.cursor=change.cursor;
}
