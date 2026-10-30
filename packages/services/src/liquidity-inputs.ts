import type {PoolClient,Pool} from 'pg';
import {address} from '@solana/kit';
import {VersionedTransaction} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {hash,json} from '../../indexer/src/events.js';

export type LiquidityInputs={contextSlot:bigint;accounts:sdk.LiquidityAccountMap;inputDigest:Uint8Array;calculation:unknown};
const blobDigest=(value:any)=>hash(value?[value.owner,value.executable,value.data]:null);
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export function assertLiquidityInputWire(wire:string,inputDigest:string,calculation:any) {
  const transaction=VersionedTransaction.deserialize(Buffer.from(wire,'base64')),keys=transaction.message.staticAccountKeys;
  const economic=transaction.message.compiledInstructions.filter(instruction=>keys[instruction.programIdIndex].address!=='ComputeBudget111111111111111111111111111111');
  if(economic.length!==1||keys[economic[0].programIdIndex].address!==sdk.CLEARING_PROGRAM_ADDRESS||
    sdk.hex(economic[0].data.slice(0,8))!==sdk.hex(sdk.PUBLISH_FUNDING_REPORT_DISCRIMINATOR))throw new Error('Publisher provenance requires its exact report instruction');
  const [value,end]=sdk.getPublishFundingReportInstructionDataDecoder().read(economic[0].data,0);
  if(end!==economic[0].data.length||sdk.hex(value.report.inputDigest)!==inputDigest||calculation?.kind!=='funding-report-v1'||
    JSON.stringify(canonical(JSON.parse(json(value.report))))!==JSON.stringify(canonical(JSON.parse(json(calculation.report)))))
    throw new Error('Publisher calculation differs from signed report');
}
/** Same SQL transaction as the signed original. Content-addressed inputs prevent
 * repeated ProgramData snapshots from multiplying disk usage every two seconds. */
export async function persistLiquidityInputs(client:PoolClient,runId:string,requestId:string,input:LiquidityInputs,wire:string) {
  assertLiquidityInputWire(wire,sdk.hex(input.inputDigest),input.calculation);
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
  const row=(await pool.query(`SELECT inputs.*,intent.wire FROM liquidity_intent_inputs inputs JOIN service_intents intent USING(run_id,request_id)
    WHERE inputs.run_id=$1 AND inputs.request_id=$2`,[runId,requestId])).rows[0];
  if(!row||!Array.isArray(row.account_refs)||row.account_refs.length>48)throw new Error('Missing publisher provenance');
  assertLiquidityInputWire(row.wire,row.input_digest,row.calculation);
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
