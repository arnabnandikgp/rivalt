import {AccountRole,address,blockhash,type Instruction} from '@solana/kit';
import {PublicKey,TransactionMessage,VersionedTransaction} from '@solana/web3.js';

export const dispatchKey=(byte:number)=>new PublicKey(new Uint8Array(32).fill(byte));
/** Encoding fixture only: these unit tests do not claim signature admission. */
export function dispatchWire(payer=1,write=2,read=3,version:0|1=0) {
  const instructions:Instruction[]=[{programAddress:address(dispatchKey(9).toBase58()),data:new Uint8Array([1]),accounts:[
    {address:address(dispatchKey(write).toBase58()),role:AccountRole.WRITABLE},
    {address:address(dispatchKey(read).toBase58()),role:AccountRole.READONLY},
  ]}];
  const message=new TransactionMessage({payerKey:dispatchKey(payer),recentBlockhash:blockhash(dispatchKey(10).toBase58()),instructions});
  return Buffer.from(new VersionedTransaction(version===0?message.compileToV0Message():message.compileToV1Message({
    computeUnitLimit:200_000,loadedAccountsDataSizeLimit:8*1024*1024,priorityFeeLamports:0n,
  })).serialize()).toString('base64');
}

/** Financial expiry tests stub SQL only; dispatch concurrency is additionally
 * exercised against actual PostgreSQL by the scoped integration driver. */
export function dispatchMockRows(sql:string,intent:unknown) {
  if(sql.includes('FOR UPDATE SKIP LOCKED'))return [intent];
  if(sql.includes(' AS acquired'))return [{acquired:true}];
  return [];
}
