import {excludedRecoveryEnd} from './recovery-coverage.js';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as paged from '@rivalt/sdk/paged-recovery';
import {nextPagedProofInstruction} from './paged-recovery-proof.js';
import {AccountRole,getAddressEncoder,type Address,type Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import type {AccountRuntime} from './account-runtime.js';
import {accountDefaultContext,decodeAccountWorker} from './account-worker-state.js';
import {loadRecoverySelection,recoveryBudget} from './recovery-selection.js';
import {recoveryRateWitness} from './recovery-witness.js';

type Context=Awaited<ReturnType<typeof accountDefaultContext>>;
type Selection=Awaited<ReturnType<typeof loadRecoverySelection>>;
const loaded=new WeakMap<AccountRuntime,{identity:string;selection:Selection}>();

function searchNonce(venue:Address,epoch:bigint,revision:bigint,rank:bigint){
  return createHash('sha256').update('Rivalt/recovery-keeper/v1\0')
    .update(Buffer.from(getAddressEncoder().encode(venue))).update([epoch,revision,rank].join(':')).digest().readBigUInt64LE();
}

export async function recoveryProofStep(runtime:AccountRuntime,key:Keypair,context:Context,
  selection:'paged-recovery-candidate'|'integrated-recovery-candidate'|'recovery-search-candidate') {
  const {venue,prepared,preparedState,header}=context;
  const epoch=header.epoch,revision=preparedState.revision;
  const blocked=(reason:string)=>({status:'blocked' as const,reason});
  if(header.count!==preparedState.count || (selection!=='paged-recovery-candidate' && header.count!==8n))return blocked('recovery-unsupported-cohort');
  const budget=recoveryBudget(process.env.RIVALT_RECOVERY_SCHEDULE_BUDGET);
  if(!budget)return blocked('recovery-search-pending');
  const identity=[venue,epoch,revision,budget,selection].join(':');
  let cache=loaded.get(runtime);
  if(cache?.identity!==identity){
    try {
      cache={identity,selection:await loadRecoverySelection(runtime.rpc,venue,selection,epoch,revision,budget,selection==='paged-recovery-candidate'?{format:'paged',count:header.count}:undefined)};
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
  if(selection==='paged-recovery-candidate') {
    const proof=response.value?decodeAccountWorker(response.value,paged.PAGED_RECOVERY_SEARCH_DISCRIMINATOR,paged.getPagedRecoverySearchDecoder()):null;
    const next=nextPagedProofInstruction(book,outcome,{...args,payer:key,nonce},proof,sdk.CLEARING_PROGRAM_ADDRESS);
    if(next)return {...ready(next.action,next.instruction),computeUnitLimit:next.computeUnitLimit};
    const bind=paged.getBindRecoverySelectionInstruction(args);
    return ready('bind-selection',{...bind,accounts:[...bind.accounts,...book.pages.map(address=>({address,role:AccountRole.WRITABLE}))]});
  }
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
