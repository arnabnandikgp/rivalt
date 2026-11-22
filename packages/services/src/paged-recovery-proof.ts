import assert from 'node:assert/strict';
import type {Address,KeyPairSigner,Instruction} from '@solana/kit';
import * as paged from '@rivalt/sdk/paged-recovery';
import {excludedRecoveryEnd} from './recovery-coverage.js';
import {recoverySettlementCalculation,type readRecoveryWitnessBook} from './recovery-witness.js';

// One 24-byte rate round and two complete ordinal arrays are mandatory.
export function pagedSearchBytes(count:bigint,historyBytes=0n,pairs=0n,rateRounds=1n) {
  return 397n+24n*rateRounds+130n*count+historyBytes+25n*pairs;
}

export function compactHistoryBytes(history:ArrayLike<number>) {
  let length=history.length;
  while(length>0 && history[length-1]===0)length--;
  return BigInt(length);
}
export function pagedRateWitness(book:Parameters<typeof recoverySettlementCalculation>[0],edges:paged.SearchEdge[],rank:bigint) {
  const {rounds,orders}=recoverySettlementCalculation(book,edges,rank);
  assert(rounds.flat().every(value=>value>=0n && value<(1n<<64n)),'Paged recovery rate exceeds its wire width');
  assert(orders.every(order=>order.every(ordinal=>ordinal<=255n)),'Paged recovery order exceeds its wire width');
  return {rates:rounds,orders:orders.map(order=>Uint8Array.from(order,Number))};
}

type Book=Awaited<ReturnType<typeof readRecoveryWitnessBook>>;
type Schedule={rank:bigint;count:bigint;edges:paged.SearchEdge[]};

/** Each transaction is derived from the authenticated frozen rows and the
 * program’s landed cursor. Returning null means clearing has sealed the proof. */
export function nextPagedProofInstruction(book:Book,choice:Schedule,
  args:{payer:KeyPairSigner;resolution:Address;search:Address;epoch:bigint;revision:bigint;nonce:bigint},
  proof:paged.PagedRecoverySearch|null,programAddress:Address):{action:string;instruction:Instruction;computeUnitLimit?:1_350_000}|null {
  const {rank,count,edges}=choice;
  const accounts={...args,prepared:book.prepared},program={programAddress};
  const witness=(dimensions:paged.SearchEdge[],index:bigint)=>pagedRateWitness(book,dimensions,index);
  if(!proof)return {action:'open',instruction:paged.getOpenSearchInstruction({...accounts,rank,original:witness([],0n)},program)};
  assert(proof.prepared===book.prepared && proof.epoch===args.epoch && proof.revision===args.revision
    && proof.proposed===rank,'Foreign paged recovery proof');
  if(proof.stage===0){
    const ordinal=proof.rows.length;
    assert(ordinal<book.rows.length,'Invalid paged recovery capture cursor');
    return {action:'capture-'+ordinal,instruction:paged.getCaptureMemberInstruction({...accounts,ordinal,
      page:book.pages[Math.floor(ordinal/8)],margin:book.rows[ordinal].member},program)};
  }
  assert.deepEqual(proof.rows.map(row=>row.id),book.rows.map(row=>row.id),'Incomplete captured membership');
  if(proof.stage===1)return {action:'derive-pairs',instruction:paged.getDerivePairsInstruction(accounts,program)};
  assert.deepEqual(proof.edges,edges,'Paged clearing dimensions disagree with the native selector');
  assert(proof.count===count && proof.cursor<=count && proof.budgets.length===book.rows.length,'Invalid paged comparison cursor');
  // Only full schedule comparisons recompute both the original and adjusted payout.
  const compare=(index:bigint,incumbent:boolean)=>{
    const after=witness(edges,index);
    const computeUnitLimit=proof.original.rates.length>1 || after.rates.length>1 ? 1_350_000 as const : undefined;
    return incumbent
      ? {action:'verify-winner',computeUnitLimit,instruction:paged.getVerifyIncumbentInstruction({...accounts,after},program)}
      : {action:'rank-'+index,computeUnitLimit,instruction:paged.getCoverPlanInstruction({...accounts,rank:index,after},program)};
  };
  if(proof.stage===2)return compare(rank,true);
  if(proof.stage===4){assert.equal(proof.cursor,count);return null;}
  assert.equal(proof.stage,3,'Unknown paged comparison stage');
  if(proof.cursor===count)return {action:'seal',instruction:paged.getSealSearchInstruction(accounts,program)};
  const end=excludedRecoveryEnd(proof);
  if(end>=proof.cursor)return {action:'range-'+proof.cursor,instruction:paged.getCoverRangeInstruction({...accounts,first:proof.cursor,last:end},program)};
  return compare(proof.cursor,false);
}
