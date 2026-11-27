import {isDeepStrictEqual} from 'node:util';
import * as sdk from '@rivalt/sdk';
import type {AccountInvocation} from './account-events.js';
import {accountCheck, projectAccounts, type AccountState} from './account-projection.js';
import {orderScopedTransactions} from './scoped-history.js';

/** Views reconstructed from payloads. Storage-only entities are still tracked
 * in the revision vector and checked against authenticated account headers. */
export function projectedEntities(state:AccountState) {
  const values=new Map<string,{revision:string}>();
  for(const [kind,value] of [[0,state.venue],[1,state.custody],[2,state.safety],[13,state.retirement]] as const) {
    if(!value)continue;
    const keys=Object.keys(state.revisions).filter(key=>state.revisions[key].kind===kind);
    accountCheck(keys.length===1,`singleton revision coverage ${kind}`);values.set(keys[0],value);
  }
  for(const [kind,collection] of [[4,state.portfolios],[5,state.roots],[6,state.markets],[7,state.ledgers],[9,state.backing],
    [28,state.listings??{}],[29,state.listedSymbols??{}],[30,state.listingIndices??{}],[31,state.listedFunding??{}],[32,state.listedVenues??{}],[33,state.listedBooks??{}],[26,state.tombstones],[27,state.storageTombstones],[14,state.liquidity?.registries??{}],[15,state.liquidity?.makers??{}],[16,state.liquidity?.publishers??{}]] as const)
    for(const [account,value] of Object.entries(collection)) {
      accountCheck(state.revisions[account]?.kind===kind,`snapshot entity kind ${account}`);values.set(account,value);
    }
  return values;
}

// Revision ownership follows physical account bytes. The three aggregate
// fields in the public market view can advance on a maker-registration write.
function storedFields(state:AccountState,key:string,logical:{revision:string}){
  const cached=state.liquidity?.marketCheckpoints?.[key]??state.liquidity?.ledgerCheckpoints?.[key];
  return cached?{...logical,...cached}:logical;
}

/** Apply a complete causal batch to a clone. Neither missing history nor a
 * later failing instruction can leak a partially projected financial effect. */
export function projectScopedBatch(initial:AccountState,invocations:readonly AccountInvocation[],
  binding:{venue:string;domain:string;artifactSet?:string}) {
  const ordered=orderScopedTransactions(invocations,initial.revisions),state=structuredClone(initial);
  const byIdentity=new Map(invocations.map(value=>[`${value.signature}/${value.outer}/${value.invocation}`,value]));
  const applied:AccountInvocation[]=[];
  for(const transaction of ordered.transactions)for(const envelope of transaction.envelopes) {
    const invocation=byIdentity.get(`${envelope.signature}/${envelope.outer}/${envelope.invocation}`)!;
    // JSONB may reorder object keys between journal commits. Compare complete
    // immutable values, preserving array order and all financial fields.
    const before=new Map([...projectedEntities(state)].map(([key,value])=>[key,structuredClone(storedFields(state,key,value))]));
    for(const write of invocation.writes)state.revisions[write.account]={kind:write.kind,revision:write.before};
    const cash=invocation.events.at(-1);
    if(state.venue?.profileVersion===7 && cash?.type==='AccountFinancialChangedV3' && [0,1].includes(cash.data.kind)) {
      const accrual=invocation.events[0];
      accountCheck(binding.artifactSet===sdk.LISTED_CASH_ARTIFACT_SET && accrual.type==='ListedCashAccrued','wider cash accrual');
      const occupied=cash.data.roots.filter((key:string)=>{
        const payload=state.listedPositions?.[key];
        return payload && sdk.decodeListedRecords(Buffer.from(payload,'hex'),sdk.listedMarginCapacity(state.roots[key]),true).records.length>0;
      });
      accountCheck(isDeepStrictEqual(occupied,accrual.data.roots.map((row:{margin:string})=>row.margin)),'complete cash position directories');
      const amount=BigInt(cash.data.amount);
      accountCheck(amount>0n && cash.data.rootStates.length===cash.data.roots.length &&
        cash.data.roots.every((key:string,i:number)=>state.roots[key].owner===cash.data.actor &&
          BigInt(cash.data.rootStates[i].cash)===BigInt(state.roots[key].cash)+(i===0?-amount:amount)),'funded cash movement');
    }
    for(const event of invocation.events)projectAccounts(state,event,binding.venue,binding.domain,4,binding.artifactSet,
      event.type==='ListedMarginChanged' && invocation.events.at(-1)?.type==='ListedRouteFilled');
    const represented=projectedEntities(state),writes=new Map(invocation.writes.map(write=>[write.account,write]));
    for(const [key,value] of represented) {
      const expected=state.revisions[key];
      accountCheck(expected&&value.revision===expected.revision,`snapshot predecessor ${key}`);
      accountCheck(isDeepStrictEqual(before.get(key),storedFields(state,key,value))||writes.has(key),`payload changed readonly entity ${key}`);
    }
    for(const write of invocation.writes) {
      state.revisions[write.account]={kind:write.kind,revision:write.after};
      const value=represented.get(write.account);if(value)value.revision=write.after;
    }
    applied.push(invocation);
  }
  accountCheck(isDeepStrictEqual(state.revisions,ordered.revisions),'complete revision projection');
  return {state,invocations:applied};
}
