import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getAddressEncoder,type Address,type Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import type {AccountRuntime} from './account-runtime.js';
import {accountDefaultContext,decodeAccountWorker} from './account-worker-state.js';
import {loadRecoverySelection,recoveryBudget} from './recovery-selection.js';
import {recoveryRateWitness} from './recovery-witness.js';

type Context=Awaited<ReturnType<typeof accountDefaultContext>>;
type Selection=Awaited<ReturnType<typeof loadRecoverySelection>>;
const loaded=new WeakMap<AccountRuntime,{identity:string;selection:Selection}>();

/** Find the longest prefix that clearing can exclude by charge ceilings or
 * debtor budgets. Widening an interval only relaxes its min/max bounds. Equal
 * recovery still needs the full financial comparison. */
export function excludedRecoveryEnd(search:Pick<sdk.RecoverySearch,'cursor'|'count'|'edges'|'budgets'|'scoreNum'|'scoreDen'> & {rows:readonly {id:bigint}[]}) {
  const {cursor,count,edges,rows,budgets,scoreNum,scoreDen}=search;
  assert(cursor>=0n && cursor<count && scoreDen>0n,'Invalid recovery cursor');
  const ordinals=new Map(rows.map((row,index)=>[row.id,index]));
  const excluded=(last:bigint)=>{
    const lower=rows.map(()=>[0n,0n]),upper=rows.map(()=>[0n,0n]);
    let stride=1n;
    for(let index=edges.length-1;index>=0;index--){
      const {maximum,debtor,market}=edges[index];
      const ordinal=ordinals.get(debtor);
      assert(ordinal!==undefined && (market===0||market===1),'Foreign recovery dimension');
      const cycle=stride*(maximum+1n), wraps=cursor/cycle!==last/cycle;
      lower[ordinal][market]+=wraps?0n:(cursor%cycle)/stride;
      upper[ordinal][market]+=wraps?maximum:(last%cycle)/stride;
      stride=cycle;
    }
    let total=0n;
    for(const [index,row] of budgets.entries())for(const [market,budget] of row.entries()){
      if(lower[index][market]>budget)return true;
      total+=upper[index][market]<budget?upper[index][market]:budget;
    }
    return total*scoreDen<scoreNum;
  };
  let end=cursor-1n, high=count-1n;
  while(end<high){
    const middle=(end+high+1n)/2n;
    if(excluded(middle))end=middle;
    else high=middle-1n;
  }
  return end;
}
function searchNonce(venue:Address,epoch:bigint,revision:bigint,rank:bigint){
  return createHash('sha256').update('Rivalt/recovery-keeper/v1\0')
    .update(Buffer.from(getAddressEncoder().encode(venue))).update([epoch,revision,rank].join(':')).digest().readBigUInt64LE();
}

export async function recoveryProofStep(runtime:AccountRuntime,key:Keypair,context:Context,
  selection:'integrated-recovery-candidate'|'recovery-search-candidate') {
  const {venue,prepared,preparedState,header}=context;
  const epoch=header.epoch,revision=preparedState.revision;
  const blocked=(reason:string)=>({status:'blocked' as const,reason});
  if(header.count!==8n || preparedState.count!==8n)return blocked('recovery-unsupported-cohort');
  const budget=recoveryBudget(process.env.RIVALT_RECOVERY_SCHEDULE_BUDGET);
  if(!budget)return blocked('recovery-search-pending');
  const identity=[venue,epoch,revision,budget,selection].join(':');
  let cache=loaded.get(runtime);
  if(cache?.identity!==identity){
    try {
      cache={identity,selection:await loadRecoverySelection(runtime.rpc,venue,selection,epoch,revision,budget)};
    }catch(error){
      if(error instanceof Error && /another insurance pass|exceeds its wire width/.test(error.message))
        return blocked('recovery-unsupported-rate-witness');
      throw error;
    }
    loaded.set(runtime,cache);
  }
  const {book,outcome}=cache.selection;
  if('blocked' in outcome)return blocked(outcome.blocked);
  const {rank,count,edges}=outcome;
  const nonce=searchNonce(venue,epoch,revision,rank);
  const [search]=await sdk.findSearchPda({payer:key.address,nonce});
  const args={...context,search,epoch,revision};
  const ready=(reason:string,instruction:Instruction)=>({status:'ready' as const,reason,
    id:`recovery:${search}:${reason}`,instruction});
  const response=await runtime.rpc.call('getAccountInfo',[search,{encoding:'base64',commitment:'confirmed',minContextSlot:Number(context.contextSlot)}]);
  assert(response.context.slot>=Number(context.contextSlot),'Recovery checkpoint moved backwards');
  if(!response.value)return ready('open-proof',sdk.getOpenSearchInstruction({...args,payer:key,nonce,rank,original:recoveryRateWitness(book,[],0n)}));
  const proof=decodeAccountWorker(response.value,sdk.RECOVERY_SEARCH_DISCRIMINATOR,sdk.getRecoverySearchDecoder());
  assert(proof.prepared===prepared && proof.epoch===epoch && proof.revision===revision && proof.proposed===rank,'Foreign recovery checkpoint');
  if(proof.stage===0){
    const ordinal=proof.rows.length;
    assert(ordinal<book.rows.length,'Invalid recovery capture cursor');
    return ready('capture-'+ordinal,sdk.getCaptureMemberInstruction({...args,page:book.pages[Math.floor(ordinal/8)],margin:book.rows[ordinal].member,ordinal}));
  }
  if(proof.stage===1)return ready('derive-pairs',sdk.getDerivePairsInstruction(args));
  assert.deepEqual(proof.edges,edges,'Native and clearing recovery dimensions disagree');
  assert(proof.count===count && proof.cursor<=count,'Recovery schedule count mismatch');
  if(proof.stage===2)return ready('verify-incumbent',sdk.getVerifyIncumbentInstruction({...args,after:recoveryRateWitness(book,edges,rank)}));
  if(proof.stage===3){
    if(proof.cursor===count)return ready('seal-proof',sdk.getSealSearchInstruction(args));
    const end=excludedRecoveryEnd(proof);
    if(end>=proof.cursor)return ready('cover-range-'+proof.cursor,sdk.getCoverRangeInstruction({...args,first:proof.cursor,last:end}));
    try {
      return ready('cover-plan-'+proof.cursor,sdk.getCoverPlanInstruction({...args,rank:proof.cursor,after:recoveryRateWitness(book,edges,proof.cursor)}));
    }catch(error){
      if(error instanceof Error && /another insurance pass|wire width|frozen collection basis|consumed frozen cash/.test(error.message))
        return blocked('recovery-unsupported-leaf-witness');
      throw error;
    }
  }
  assert.equal(proof.stage,4,'Unknown recovery stage');
  return ready('bind-proof',sdk.getBindRecoverySelectionInstruction(args));
}
