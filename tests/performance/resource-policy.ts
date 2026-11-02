/** Explicit signed resource requests; absence is not a measured runtime value. */
import assert from 'node:assert/strict';
import type {VersionedTransaction} from '@solana/web3.js';
export function signedResourcePolicy(message:VersionedTransaction['message']) {
  let heapBytes:number|null=null,loadedDataLimitBytes:number|null=null;
  if(message.version===1){
    heapBytes=message.transactionConfig?.heapSize??null;
    loadedDataLimitBytes=message.transactionConfig?.loadedAccountsDataSizeLimit??null;
  }else{
    assert.equal(message.version,0,'Qualified v0/v1 only');
    for(const instruction of message.compiledInstructions){
      if(message.staticAccountKeys[instruction.programIdIndex].toBase58()!=='ComputeBudget111111111111111111111111111111')continue;
      const data=Buffer.from(instruction.data);
      if(data[0]===1){assert.equal(data.length,5);assert.equal(heapBytes,null,'Duplicate heap request');heapBytes=data.readUInt32LE(1);}
      if(data[0]===4){assert.equal(data.length,5);assert.equal(loadedDataLimitBytes,null,'Duplicate data limit');loadedDataLimitBytes=data.readUInt32LE(1);}
    }
  }
  return {heapBytes,loadedDataLimitBytes};
}
