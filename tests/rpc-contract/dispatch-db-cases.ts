import assert from 'node:assert/strict';
import type {LiquidityStore} from '../../packages/indexer/src/liquidity-store.js';
import {AccountRole,address,type Instruction} from '@solana/kit';
import {PublicKey,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {prepareDispatch,reserveDispatch} from '../../packages/services/src/dispatch.js';

/** SQL scheduling tests only. Encoded readonly variants are never broadcast or
 * treated as financial effects; economic receipts come from the separate RPC run. */
export async function dispatchDatabaseCases(pool:LiquidityStore['pool'],sourceRun:string) {
  const originals=(await pool.query(`SELECT * FROM service_intents WHERE run_id=$1
    AND request_id IN ('maker:independent-0','maker:independent-1') ORDER BY request_id`,[sourceRun])).rows;
  assert.equal(originals.length,2);assert(originals.every(original=>original.status==='finalized'));
  const runId=`${sourceRun}-access`;
  await pool.query(`INSERT INTO runs(run_id,binding,state) SELECT $2,binding,state FROM runs WHERE run_id=$1`,[sourceRun,runId]);
  for(const original of originals)await pool.query(`INSERT INTO service_intents(run_id,request_id,signature,wire,blockhash,status,result)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[runId,original.request_id,original.signature,original.wire,original.blockhash,original.status,original.result]);
  const first=VersionedTransaction.deserialize(Buffer.from(originals[0].wire,'base64'));
  const second=VersionedTransaction.deserialize(Buffer.from(originals[1].wire,'base64'));
  const keys=first.message.staticAccountKeys;
  const target=keys.find((_,index)=>index!==0&&first.message.isAccountWritable(index))!;assert(target);
  const read=(payer:PublicKey)=>{
    const instruction:Instruction={programAddress:address('11111111111111111111111111111111'),data:new Uint8Array(),
      accounts:[{address:target.address,role:AccountRole.READONLY}]};
    return Buffer.from(new VersionedTransaction(new TransactionMessage({payerKey:payer,
      recentBlockhash:first.message.recentBlockhash,instructions:[instruction]}).compileToV0Message()).serialize()).toString('base64');
  };
  const cases=[
    {label:'read/read',left:read(keys[0]),right:read(second.message.staticAccountKeys[0]),allowed:true},
    {label:'write/read',left:originals[0].wire,right:read(second.message.staticAccountKeys[0]),allowed:false},
    {label:'read/write',left:read(second.message.staticAccountKeys[0]),right:originals[0].wire,allowed:false},
    {label:'write/write',left:originals[0].wire,right:originals[0].wire,allowed:false},
  ];
  for(const test of cases) {
    const left=await pool.connect(),right=await pool.connect();
    try {
      await left.query('BEGIN');await right.query('BEGIN');
      assert(await reserveDispatch(left,runId,originals[0].request_id,test.left));
      assert.equal(await reserveDispatch(right,runId,originals[1].request_id,test.right),test.allowed,test.label);
    }finally{await left.query('ROLLBACK');await right.query('ROLLBACK');left.release();right.release();}
  }
  const writer=await pool.connect();
  try {
    await writer.query('BEGIN');assert(await reserveDispatch(writer,runId,originals[0].request_id,originals[0].wire));await writer.query('COMMIT');
  }finally{writer.release();}
  const reader=await pool.connect();
  try {
    await reader.query('BEGIN');
    assert.equal(await reserveDispatch(reader,runId,originals[1].request_id,read(second.message.staticAccountKeys[0])),false,'Durable writer blocks reader after connection release');
  }finally{await reader.query('ROLLBACK');reader.release();}
  await pool.query('DELETE FROM service_dispatch_access WHERE run_id=$1',[runId]);

  // Recreate a legacy pending journal row from an actual known original, without
  // giving it a dispatcher marker. Startup must refuse ambiguity. Drain it using
  // the already fetched original receipt, then activate; never invent a receipt.
  const legacy=`${sourceRun}-legacy`;
  await pool.query(`INSERT INTO runs(run_id,binding,state) SELECT $2,binding,state FROM runs WHERE run_id=$1`,[sourceRun,legacy]);
  const original=originals[0];
  await pool.query(`INSERT INTO service_intents(run_id,request_id,signature,wire,blockhash) VALUES($1,$2,$3,$4,$5)`,
    [legacy,original.request_id,original.signature,original.wire,original.blockhash]);
  await assert.rejects(()=>prepareDispatch(pool,legacy),/Drain existing ambiguous originals/);
  assert.equal((await pool.query('SELECT count(*) FROM service_dispatch_contract WHERE run_id=$1',[legacy])).rows[0].count,'0');
  await pool.query('UPDATE service_intents SET status=$3,result=$4 WHERE run_id=$1 AND request_id=$2',
    [legacy,original.request_id,original.status,original.result]);
  await prepareDispatch(pool,legacy);await prepareDispatch(pool,legacy);
  assert.equal((await pool.query('SELECT version FROM service_dispatch_contract WHERE run_id=$1',[legacy])).rows[0].version,1);
  return {readWriteCases:cases.map(({label,allowed})=>({label,allowed})),committedLeaseSurvivesConnection:true,
    legacyAmbiguityRejected:true,drainedActivationIdempotent:true,scope:'SQL access fixtures, no additional economic execution'};
}
