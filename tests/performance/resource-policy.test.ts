import {expect,it} from 'vitest';
import {ComputeBudgetProgram,Keypair,TransactionMessage,VersionedTransaction,TransactionInstruction} from '@solana/web3.js';
import {blockhash} from '@solana/kit';
import {signedResourcePolicy} from './resource-policy.js';
const payer=await Keypair.fromSeed(new Uint8Array(32).fill(1));
const base={payerKey:payer.publicKey,recentBlockhash:blockhash(payer.publicKey.toBase58())};
it('distinguishes absent heap/data requests from observed runtime consumption',()=>{
  for(const message of [new TransactionMessage({...base,instructions:[]}).compileToV0Message(),
    new TransactionMessage({...base,instructions:[]}).compileToV1Message()])
    expect(signedResourcePolicy(message)).toEqual({heapBytes:null,loadedDataLimitBytes:null});
});
it.each([0,1] as const)('reads exact signed v%s heap and loaded-data limits',async version=>{
  const data=Buffer.alloc(5);data[0]=4;data.writeUInt32LE(8*1024*1024,1);
  const message=version===0?new TransactionMessage({...base,instructions:[ComputeBudgetProgram.requestHeapFrame({bytes:256*1024}),
    new TransactionInstruction({programId:ComputeBudgetProgram.programId,keys:[],data})]}).compileToV0Message():
    new TransactionMessage({...base,instructions:[]}).compileToV1Message({heapSize:256*1024,loadedAccountsDataSizeLimit:8*1024*1024});
  const transaction=new VersionedTransaction(message);await transaction.sign([payer]);
  expect(signedResourcePolicy(VersionedTransaction.deserialize(transaction.serialize()).message))
    .toEqual({heapBytes:262144,loadedDataLimitBytes:8388608});
});
it('rejects duplicated resource requests instead of reporting a misleading value',()=>{
  const request=ComputeBudgetProgram.requestHeapFrame({bytes:256*1024});
  const message=new TransactionMessage({...base,instructions:[request,request]}).compileToV0Message();
  expect(()=>signedResourcePolicy(message)).toThrow(/Duplicate heap request/);
});
