// Meter the unmodified general settlement and rounding kernel on a clearing-certified plan.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {AccountRole,address,type Address} from '@solana/kit';
import {Connection} from '@solana/web3.js';
import {deriveFrozenMarginPage,signCanonicalInstructions} from '@rivalt/sdk';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {payerKey} from './harness.js';

type Witness={rates:string[][];orders:string[][]};
const dir=process.env.RIVALT_RUN_DIR!,dest=dir+'/kernel-cost';
mkdirSync(dest);
const source=JSON.parse(readFileSync(dir+'/proof-kernel-input.json','utf8')) as {
  prepared:Address;resolution:Address;venue:Address;revision:string;epoch:string;members:Address[];
  comparison:{witnesses:Witness[];ordinaryCash:Record<string,string>;cash:Record<string,string>;insurance:string[]};
};
const program=address('92GA4Cm7NZq8GEwY5r7zLwdLeYLuQYa79Ut9f3gAQ8U7');
const url=process.env.RIVALT_RPC_URL!;
const {h,rpc,ws,checks}=await openCanonicalRpcHarness(url,process.env.RIVALT_WS_URL!,dest,{
  instructionConformance:()=>false,heapSize:()=>256*1024,computeUnitLimit:()=>1_400_000});
const payer=await payerKey(),connection=new Connection(url,'confirmed');
const u64=(value:string)=>{const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(BigInt(value));return bytes;};
const page=(await deriveFrozenMarginPage(source.venue,0n))[0];
const accounts=[source.prepared,source.resolution,page].map(address=>({address,role:AccountRole.READONLY}));
const witnesses=source.comparison.witnesses.map(witness=>{
  assert.equal(witness.rates.length,1);
  assert(witness.orders.every(order=>order.length===8));
  return Buffer.concat([...witness.rates[0].map(u64),...witness.orders.map(order=>Buffer.from(order.map(Number)))]);
});
const costs=[];
try{
  for(const [phase,name] of ['original rates','adjusted rates','original rounded cash','protected adjusted cash'].entries()){
    const instruction={programAddress:program,accounts,data:Buffer.concat([
      createHash('sha256').update('global:audit_settlement').digest().subarray(0,8),
      u64(source.epoch),u64(source.revision),Buffer.from([phase]),...witnesses])};
    const {transaction,wireBytes}=await signCanonicalInstructions(connection,payer,[instruction],{
      computeUnitLimit:1_400_000,heapSize:256*1024,loadedAccountsDataSizeLimit:8*1024*1024});
    const wire=Buffer.from(transaction.serialize()).toString('base64');
    const {value}=await rpc.call('simulateTransaction',[wire,{sigVerify:true,encoding:'base64',commitment:'confirmed'}]);
    writeFileSync(dest+'/simulation-kernel-'+phase+'.json',JSON.stringify({name,wire,value},null,2));
    const success=value.err===null;
    if(success){
      const expected=phase<2?[...source.comparison.insurance,...Array(6).fill(0)]:
        source.members.map(key=>(phase===2?source.comparison.ordinaryCash:source.comparison.cash)[key]);
      assert.equal(value.returnData.programId,program);
      const returned=Buffer.from(value.returnData.data[0],'base64');
      assert.equal(returned.length,64);
      assert.deepEqual(expected.map(String),Array.from({length:8},(_,i)=>String(returned.readBigUInt64LE(i*8))));
    }else{
      const failure=value.err?.InstructionError?.[1];
      assert(['ComputationalBudgetExceeded','ProgramFailedToComplete'].includes(failure),
        JSON.stringify({failure,logs:value.logs}));
      assert(value.logs.some((line:string)=>/compute units|allocation|memory/i.test(line)),name);
    }
    const landed=success && value.unitsConsumed<=1_120_000;
    if(landed) {
      await h.send(name,[instruction]);
      const receipt=await rpc.call('getTransaction',[checks.at(-1)!.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
      assert.deepEqual(receipt.meta.returnData,value.returnData);
    }
    costs.push({name,success,landed,units:value.unitsConsumed,bytes:wireBytes,error:value.err});
  }
  writeFileSync(dest+'/costs.json',JSON.stringify({costs,checks},null,2));console.log(JSON.stringify(costs));
}finally{ws.close();}
