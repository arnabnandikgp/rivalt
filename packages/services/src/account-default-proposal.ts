import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {AccountRuntime} from './account-runtime.js';
import {readAccountRateProposal} from './account-frozen-proposal.js';
import type {readAccountResolution} from './account-worker-state.js';

type Frozen=Awaited<ReturnType<typeof readAccountRateProposal>>;
const cache=new WeakMap<AccountRuntime,{key:string;value:Frozen}>();
export async function defaultProposal(runtime:AccountRuntime,state:Awaited<ReturnType<typeof readAccountResolution>>) {
  const key=[state.preparedState.venue,state.header.epoch,state.preparedState.revision,
    createHash('sha256').update(Buffer.from(state.ratesState.state.insurance)).digest('hex')].join(':');
  const prior=cache.get(runtime);if(prior?.key===key)return prior.value;
  const value=await readAccountRateProposal(runtime.rpc,state.preparedState.venue,state.header.epoch);
  assert(value.prepared.revision===state.preparedState.revision
,'Frozen proposal changed');
  cache.set(runtime,{key,value});return value;
}
/** Untrusted complete permutation: positive payout remainder descending, stable
 * identity ascending for ties. Nonpositive rows still occur exactly once. */
export function proposeMarketOrder(rows:{id:bigint;claims:readonly bigint[]}[],market:number,
  rate:{numerator:bigint;denominator:bigint}):bigint[] {
  assert((market===0||market===1)&&rate.denominator>0n&&rate.numerator>=0n&&rate.numerator<=rate.denominator);
  const denominator=rate.denominator*1_000_000_000n;
  const ordered=rows.map((row,ordinal)=>({ordinal:BigInt(ordinal),id:row.id,positive:row.claims[market]>0n,
    remainder:row.claims[market]>0n?row.claims[market]*rate.numerator%denominator:0n}));
  assert(new Set(ordered.map(row=>row.id.toString())).size===rows.length,'Duplicate frozen identity');
  ordered.sort((left,right)=>{
    if(left.positive!==right.positive)return left.positive?-1:1;
    if(left.remainder!==right.remainder)return left.remainder>right.remainder?-1:1;
    return left.id<right.id?-1:left.id>right.id?1:0;
  });
  return ordered.map(row=>row.ordinal);
}
