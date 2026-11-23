import assert from 'node:assert/strict';
import {isMultiLotDeployment,isBookInventoryDeployment,usesUnifiedRecovery} from '@rivalt/sdk';
import {createHash} from 'node:crypto';
import type {AccountRuntime} from './account-runtime.js';
import {readAccountRateProposal} from './account-frozen-proposal.js';
import type {readAccountResolution} from './account-worker-state.js';

type Frozen=Awaited<ReturnType<typeof readAccountRateProposal>>;
const cache=new WeakMap<AccountRuntime,{key:string;value:Frozen}>();

/** A rejected rate is immutable within its attempt. Compare the actual uploaded
 * words, since corrected proposals can have the same factor and lengths. */
export async function matchesRejectedRate(
  rates: {attempt:bigint; factor:readonly bigint[]; lengths:readonly bigint[]; uploaded:readonly bigint[]},
  proposal: Pick<Frozen['proposal'],'factorWords'|'numeratorWords'>,
  readPage:(market:number,index:bigint)=>Promise<{attempt:bigint;wordCount:number;payload:{words:readonly bigint[]}}>,
) {
  if (!rates.factor.every((word,index)=>word===proposal.factorWords[index]) ||
      !rates.lengths.every((length,index)=>length===BigInt(proposal.numeratorWords[index].length))) return false;
  assert(rates.uploaded.every((length,index)=>length===rates.lengths[index]),'Rejected rate has an incomplete upload');
  for (const [market,words] of proposal.numeratorWords.entries()) {
    for (let offset=0;offset<words.length;offset+=256) {
      const page=await readPage(market,BigInt(offset/256));
      const length=Math.min(256,words.length-offset);
      assert(page.attempt===rates.attempt && page.wordCount>=length && page.payload.words.length>=length,
        'Rejected rate page changed during comparison');
      for (let index=0;index<length;index++) {
        if (page.payload.words[index]!==words[offset+index]) return false;
      }
    }
  }
  return true;
}
export async function defaultProposal(runtime:AccountRuntime,state:Awaited<ReturnType<typeof readAccountResolution>>) {
  const key=[state.preparedState.venue,state.header.epoch,state.preparedState.revision,
    createHash('sha256').update(Buffer.from(state.ratesState.state.insurance)).digest('hex')].join(':');
  const prior=cache.get(runtime);if(prior?.key===key)return prior.value;
  const value=await readAccountRateProposal(runtime.rpc,state.preparedState.venue,state.header.epoch,6,usesUnifiedRecovery(runtime.deploymentSelection)?'unified':runtime.deploymentSelection==='local-successor-candidate'?'local-successor':runtime.deploymentSelection==='paged-recovery-candidate'?'paged':isMultiLotDeployment(runtime.deploymentSelection)?'multi':isBookInventoryDeployment(runtime.deploymentSelection)?'book':runtime.deploymentSelection==='linked-allocation-candidate'?'linked':runtime.deploymentSelection==='btc-allocation-candidate');
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
