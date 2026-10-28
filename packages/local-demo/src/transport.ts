import assert from 'node:assert/strict';
import {appendFileSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {address,getBase58Decoder,type Instruction} from '@solana/kit';
import {Connection,type Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {Rpc} from '../../indexer/src/rpc.js';
import {payerKey} from '../../../tests/rpc-contract/custody-cases.js';
import type {AccountTradingHarness} from '../../../tests/rpc-contract/account-trading-setup.js';

export async function until<Value>(read:()=>Promise<Value>,accept:(value:Value)=>boolean,label:string,timeout=30000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){const value=await read();if(accept(value))return value;await delay(150);}
  throw new Error(`Timed out: ${label}`);
}
/** Fresh signed deployment/provisioning, without qualification fault scenarios.
 * A saved original is never silently rebuilt after uncertain submission. */
export async function demoTransport(url:string,journal:string){
  assert.equal(new URL(url).hostname,'127.0.0.1');
  const rpc=new Rpc(url),connection=new Connection(url,'confirmed'),payer=await payerKey();
  let anchor='',recording=true;
  const read=async(key:sdk.Participant['owner'])=>{
    const result=await rpc.call('getAccountInfo',[key,{encoding:'base64',commitment:'confirmed'}]);
    return result.value?Buffer.from(result.value.data[0],'base64'):null;
  };
  async function send(label:string,instructions:Instruction[],signers:Keypair[]=[]){
    const {transaction}=await sdk.signInstructions(connection,payer,[sdk.fundingComputeBudget(),...instructions],signers);
    const wire=Buffer.from(transaction.serialize()).toString('base64');
    const signature=getBase58Decoder().decode(transaction.signatures[0]);
    if(recording)appendFileSync(journal,JSON.stringify({label,signature,wire})+'\n',{mode:0o600});
    else writeFileSync(journal+'.'+label.replaceAll(/[^a-z0-9]+/gi,'-')+'.pending.json',JSON.stringify({label,signature,wire}),{mode:0o600});
    // Retry only the exact signed bytes; fetch final history independently.
    await rpc.call('sendTransaction',[wire,{encoding:'base64',skipPreflight:false,maxRetries:3}]);
    const history=await until<any>(()=>rpc.call('getTransaction',[signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:0}]),Boolean,label);
    assert.equal(history.meta.err,null,`${label}: ${JSON.stringify(history.meta.err)}`);
    if(label==='setup fresh clearing venue')anchor=signature;
    return history;
  }
  const clock=async()=>{const bytes=await read(address('SysvarC1ock11111111111111111111111111111111'));assert(bytes);return bytes;};
  const h:AccountTradingHarness={clockMode:'realtime',rent:async size=>BigInt(await rpc.call('getMinimumBalanceForRentExemption',[size])),read,
    send:async(label,instructions,signers,expectedError)=>{assert.equal(expectedError,undefined,'Demo does not run rejection suites');await send(label,instructions,signers);},
    now:async()=>(await clock()).readBigInt64LE(32),slot:async()=>(await clock()).readBigUInt64LE(0),
    advance:async(seconds)=>{const target=await h.now()+seconds;await until(()=>h.now(),now=>now>=target,'source qualification',Number(seconds)*1000+10000);},
    quote:async(label,instruction)=>{const history=await send(label,[instruction]);return Buffer.from(history.meta.returnData.data[0],'base64');}};
  return {h,rpc,payer,send,anchor:()=>anchor,finishProvisioning:()=>{recording=false;}};
}
