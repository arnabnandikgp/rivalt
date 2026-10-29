import type {PoolClient,Pool} from 'pg';
import {address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {hash,json} from '../../indexer/src/events.js';

export type LiquidityInputs={contextSlot:bigint;accounts:sdk.LiquidityAccountMap;inputDigest:Uint8Array;calculation:unknown};
const blobDigest=(value:any)=>hash(value?[value.owner,value.executable,value.data]:null);
/** Same SQL transaction as the signed original. Content-addressed inputs prevent
 * repeated ProgramData snapshots from multiplying disk usage every two seconds. */
export async function persistLiquidityInputs(client:PoolClient,runId:string,requestId:string,input:LiquidityInputs) {
  if(input.accounts.size>48||sdk.hex(await sdk.fundingSnapshotDigest(input.contextSlot,input.accounts))!==sdk.hex(input.inputDigest))
    throw new Error('Publisher input digest mismatch');
  const references=[];
  for(const [key,value] of [...input.accounts].sort(([left],[right])=>left<right?-1:left>right?1:0)) {
    const payload=value?{owner:value.owner,executable:value.executable,data:value.data}:null,digest=blobDigest(payload);
    await client.query('INSERT INTO liquidity_input_blobs(digest,payload) VALUES($1,$2) ON CONFLICT DO NOTHING',[digest,json(payload)]);
    references.push([key,digest]);
  }
  await client.query(`INSERT INTO liquidity_intent_inputs(run_id,request_id,input_digest,context_slot,account_refs,calculation)
    VALUES($1,$2,$3,$4,$5,$6)`,[runId,requestId,sdk.hex(input.inputDigest),input.contextSlot.toString(),json(references),json(input.calculation)]);
}

/** Authenticate retained bytes and reconstruct the input map without live RPC.
 * Replaying the SDK is reproducibility; independent price arithmetic is a
 * separate qualification assertion and must not be claimed from this alone. */
export async function readLiquidityInputs(pool:Pick<Pool,'query'>,runId:string,requestId:string) {
  const row=(await pool.query('SELECT * FROM liquidity_intent_inputs WHERE run_id=$1 AND request_id=$2',[runId,requestId])).rows[0];
  if(!row||!Array.isArray(row.account_refs)||row.account_refs.length>48)throw new Error('Missing publisher provenance');
  const blobs=(await pool.query('SELECT digest,payload FROM liquidity_input_blobs WHERE digest=ANY($1::text[])',[row.account_refs.map((entry:any)=>entry[1])])).rows;
  const values=new Map(blobs.map(value=>[value.digest,value.payload]));
  const accounts=new Map(row.account_refs.map(([key,digest]:[string,string])=>{
    if(!values.has(digest)||blobDigest(values.get(digest))!==digest)throw new Error('Corrupt publisher input blob');
    return [address(key),values.get(digest)] as const;
  })) as sdk.LiquidityAccountMap;
  if(accounts.size!==row.account_refs.length||sdk.hex(await sdk.fundingSnapshotDigest(BigInt(row.context_slot),accounts))!==row.input_digest)
    throw new Error('Corrupt publisher snapshot');
  return {contextSlot:BigInt(row.context_slot),accounts,calculation:row.calculation,inputDigest:row.input_digest as string};
}
