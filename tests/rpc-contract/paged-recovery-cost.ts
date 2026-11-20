import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {AccountRole,address,getAddressEncoder,type Address} from '@solana/kit';
import type {SearchEdge} from '@rivalt/sdk';
import {recoverySettlementCalculation,type readRecoveryWitnessBook} from '../../packages/services/src/recovery-witness.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';

const program = address('92GA4Cm7NZq8GEwY5r7zLwdLeYLuQYa79Ut9f3gAQ8U7');
const hash = (...values:(string|Uint8Array)[]) => {
  const state=createHash('sha256');
  for (const value of values) state.update(value);
  return state.digest();
};
function u64(value:bigint) { const bytes=Buffer.alloc(8); bytes.writeBigUInt64LE(value); return bytes; }
function i64(value:string) { const bytes=Buffer.alloc(8); bytes.writeBigInt64LE(BigInt(value)); return bytes; }
function length(count:number) { const bytes=Buffer.alloc(4); bytes.writeUInt32LE(count); return bytes; }

export async function measurePagedRecovery(venue:Address,resolution:Address,epoch:bigint,revision:bigint,
  book:Awaited<ReturnType<typeof readRecoveryWitnessBook>>,choice:{edges:SearchEdge[];rank:bigint},
  expected:{cash:Record<string,string>;terminal:{movements:string[][];remainingInsurance:string[]}}) {
  const encode=(edges:SearchEdge[],rank:bigint)=>{
    const {rounds,orders}=recoverySettlementCalculation(book,edges,rank);
    return Buffer.concat([length(rounds.length),...rounds.flat().map(u64),
      ...orders.flatMap(order=>[length(order.length),Buffer.from(order.map(Number))])]);
  };
  let remaining=choice.rank;
  const charges:bigint[][]=[];
  for (const edge of [...choice.edges].reverse()) {
    const radix=edge.maximum+1n, atoms=remaining%radix;
    remaining/=radix;
    if (atoms) charges.unshift([BigInt(edge.market),edge.debtor,edge.winner,atoms]);
  }
  assert.equal(remaining,0n);
  const directory=process.env.RIVALT_RUN_DIR!+'/paged-proof-cost';
  mkdirSync(directory);
  const {h,rpc,ws,checks,flush}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,
    {instructionConformance:()=>false,heapSize:()=>256*1024,computeUnitLimit:()=>1_400_000});
  const instruction=(pages:Address[])=>({programAddress:program,
    accounts:[book.prepared,resolution,...pages,...book.rows.map(row=>row.member)].map(address=>({address,role:AccountRole.READONLY})),
    data:Buffer.concat([hash('global:audit_paged_recovery').subarray(0,8),u64(epoch),u64(revision),
      encode([],0n),encode(choice.edges,choice.rank),length(charges.length),...charges.flat().map(u64)])});
  try {
    await h.send('duplicate first page cannot replace the flat creditor',[instruction([book.pages[0],book.pages[0]])],[],6000);
    await h.send('complete two-page protected cash calculation',[instruction(book.pages)]);
    const landed=checks.at(-1)!;
    const receipt=await rpc.call('getTransaction',[landed.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    assert.equal(receipt.meta.err,null);
    assert.equal(receipt.meta.returnData.programId,program);
    let digest=hash('Rivalt/paged-recovery-measurement/v1',Buffer.from(getAddressEncoder().encode(venue)),u64(epoch),u64(revision),
      u64(BigInt(book.rows.length)),...expected.terminal.remainingInsurance.map(value=>u64(BigInt(value))));
    for (const [index,row] of book.rows.entries()) {
      digest=hash(digest,u64(row.id),u64(BigInt(expected.cash[row.member])),...expected.terminal.movements[index].map(i64));
    }
    assert.deepEqual(Buffer.from(receipt.meta.returnData.data[0],'base64'),digest);
    const cost={signature:landed.signature,units:receipt.meta.computeUnitsConsumed,
      bytes:Buffer.from(receipt.transaction[0],'base64').length,fee:receipt.meta.fee,payoutDigest:digest.toString('hex')};
    assert(Number.isSafeInteger(cost.units) && cost.units>0);
    writeFileSync(directory+'/cost.json',JSON.stringify(cost,null,2));
    return cost;
  } finally {try{await flush();}finally{ws.close();}}
}
