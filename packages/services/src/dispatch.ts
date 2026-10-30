import type {Pool, PoolClient} from 'pg';
import {VersionedTransaction} from '@solana/web3.js';

/** Full signed-message privileges, including payer and readonly program keys.
 * Static v0/v1 only, matching signedWire's admitted transport contract. */
export function dispatchAccess(wire:string) {
  const transaction=VersionedTransaction.deserialize(Buffer.from(wire,'base64'));
  if(transaction.message.version!==0&&transaction.message.version!==1)
    throw new Error('Unsupported dispatch message');
  if(transaction.message.version===0&&transaction.message.addressTableLookups.length)
    throw new Error('Unresolved dispatch lookup accounts');
  const access=new Map<string,boolean>();
  transaction.message.staticAccountKeys.forEach((key,index)=>{
    const address=key.toString();
    access.set(address,(access.get(address)??false)||transaction.message.isAccountWritable(index));
  });
  return [...access].map(([address,writable])=>({address,writable}))
    .sort((left,right)=>left.address.localeCompare(right.address));
}

/** Existing ambiguous originals must be drained by their original executor.
 * Never bootstrap a new conflict contract by assuming they were not sent. */
export async function prepareDispatch(pool:Pool,runId:string) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${runId}/dispatch-contract`]);
    const existing=await client.query('SELECT version FROM service_dispatch_contract WHERE run_id=$1',[runId]);
    if(!existing.rows.length) {
      const pending=await client.query("SELECT 1 FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved') LIMIT 1",[runId]);
      if(pending.rows.length)throw new Error('Drain existing ambiguous originals with the previous executor before enabling dispatch');
      await client.query('INSERT INTO service_dispatch_contract(run_id,version) VALUES($1,1)',[runId]);
    } else if(existing.rows[0].version!==1)throw new Error('Unsupported dispatch contract');
    await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
}

/** Called in the row owner's SQL transaction. Persist before any network send.
 * Short advisory locks make conflict-check plus reservation atomic across workers;
 * durable rows, rather than connection locks, protect originals across crashes. */
export async function reserveDispatch(client:PoolClient,runId:string,id:string,wire:string) {
  const access=dispatchAccess(wire);
  const locked=await client.query(`SELECT bool_and(CASE WHEN writable THEN
    pg_try_advisory_xact_lock(hashtextextended($1||'/dispatch/'||address,0)) ELSE
    pg_try_advisory_xact_lock_shared(hashtextextended($1||'/dispatch/'||address,0)) END) AS acquired
    FROM unnest($2::text[],$3::boolean[]) AS access(address,writable)`,
    [runId,access.map(item=>item.address),access.map(item=>item.writable)]);
  if(locked.rows[0]?.acquired!==true)return false;
  const conflict=await client.query(`SELECT 1 FROM service_dispatch_access
    WHERE run_id=$1 AND request_id<>$2 AND
    (address=ANY($3::text[]) OR (writable AND address=ANY($4::text[]))) LIMIT 1`,
    [runId,id,access.filter(item=>item.writable).map(item=>item.address),access.filter(item=>!item.writable).map(item=>item.address)]);
  if(conflict.rows.length)return false;
  await client.query(`INSERT INTO service_dispatch_access(run_id,request_id,address,writable)
    SELECT $1,$2,address,writable FROM unnest($3::text[],$4::boolean[]) AS access(address,writable)
    ON CONFLICT DO NOTHING`,[runId,id,access.map(item=>item.address),access.map(item=>item.writable)]);
  return true;
}

/** Two RPC lanes leave capacity in the four-connection pool for wake/ingress.
 * A broken original cannot cancel already-started independent work. */
export async function boundedDispatch(ids:readonly string[],step:(id:string)=>Promise<unknown>) {
  let cursor=0;
  const errors:unknown[]=[];
  await Promise.all(Array.from({length:Math.min(2,ids.length)},async()=>{
    while(cursor<ids.length) {
      const id=ids[cursor++];
      try {await step(id);} catch(error) {errors.push(error);}
    }
  }));
  if(errors.length)throw new AggregateError(errors,'Some durable originals could not progress');
}
