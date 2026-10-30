import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {address,getBase58Encoder,type Address,type Instruction,type ReadonlyUint8Array} from '@solana/kit';
import {Connection} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {payerKey,program,type Harness} from './custody-cases.js';
import type {AccountTradingHarness} from './account-trading-setup.js';
import {decodeAccountEvent} from './account-live-parity.js';
import {WireRpc,WireSubscriptions,eventually} from './wire.js';


/** P27 transport: signed originals, independently fetched RPC outcomes and real WS.
 * Inputs are deployment endpoints; no retained acceptance dump provisions state. */
export async function accountRuntimeHarness(url:string,wsUrl:string,directory:string) {
assert.equal(new URL(url).hostname,'127.0.0.1');
const rpc=new WireRpc(url),connection=new Connection(url,'confirmed'),ws=new WireSubscriptions(wsUrl);
const payer=await payerKey(),base58=getBase58Encoder();
const checks:Record<string,unknown>[]=[],eventBytes:string[]=[],events:ReturnType<typeof decodeAccountEvent>[]=[];
const confirmedHistories:unknown[]=[];
const json=(value:unknown)=>JSON.stringify(value,(_,item)=>typeof item==='bigint'?item.toString():item,2)+'\n';
await ws.ready();const subscription=await ws.call('logsSubscribe',[{mentions:[program]},{commitment:'confirmed'}]);
const clockAddress=address('SysvarC1ock11111111111111111111111111111111');
async function read(key:Address) {
  const account=await rpc.call('getAccountInfo',[key,{encoding:'base64',commitment:'confirmed'}]);
  return account.value?Buffer.from(account.value.data[0],'base64'):null;
}
async function send(label:string,instructions:Instruction[],signers:Parameters<Harness['send']>[2]=[],expectedError?:number) {
  const has=(discriminator:ReadonlyUint8Array)=>instructions.some(instruction=>instruction.programAddress===program
    &&Buffer.from(instruction.data??[]).subarray(0,8).equals(Buffer.from(discriminator)));
  const sampling=has(sdk.SAMPLE_ACCOUNT_ORACLE_DISCRIMINATOR),routing=has(sdk.EXECUTE_ACCOUNT_ROUTE_DISCRIMINATOR)||has(sdk.EXECUTE_ACCOUNT_ORDER_DISCRIMINATOR);
  const resolution=[sdk.INITIALIZE_ACCOUNT_RESOLUTION_DISCRIMINATOR,sdk.INITIALIZE_ACCOUNT_RESOLUTION_PAGE_DISCRIMINATOR,
    sdk.FREEZE_ACCOUNTS_DISCRIMINATOR,sdk.VALUE_ACCOUNT_RESOLUTION_DISCRIMINATOR,sdk.ADVANCE_ACCOUNT_RESOLUTION_DISCRIMINATOR,
    sdk.PROPOSE_ACCOUNT_RESOLUTION_DISCRIMINATOR,sdk.ORDER_ACCOUNT_RESOLUTION_DISCRIMINATOR,
    sdk.CHECK_ACCOUNT_RESOLUTION_ORDER_DISCRIMINATOR,sdk.ROUND_ACCOUNT_RESOLUTION_DISCRIMINATOR,
    sdk.RECOVER_ACCOUNTS_DISCRIMINATOR,sdk.REACTIVATE_ACCOUNTS_DISCRIMINATOR,
    sdk.CHECK_ACCOUNT_RETIREMENT_DISCRIMINATOR,sdk.RETIRE_ACCOUNTS_DISCRIMINATOR,
    sdk.FINALIZE_ACCOUNT_RESOLUTION_RATES_DISCRIMINATOR].some(has);
  const declaredComputeUnits=sampling||resolution?1_200_000:routing?sdk.GROUP_ROUTE_COMPUTE_UNITS:400_000;
  const {transaction}=await sdk.signInstructions(connection,payer,[(sampling||resolution)?sdk.fundingComputeBudget():routing?sdk.groupRouteComputeBudget():sdk.routeComputeBudget(),...instructions],signers);
  const wire=transaction.serialize();assert(wire.length<=1232,`${label}: packet`);
  const encoded=Buffer.from(wire).toString('base64');writeFileSync(`${directory}/wire-${checks.length}.json`,json({label,wireBase64:encoded}));
  const simulation=await rpc.call('simulateTransaction',[encoded,{encoding:'base64',sigVerify:true,commitment:'confirmed'}]);
  writeFileSync(`${directory}/simulation-${checks.length}.json`,json(simulation));
  if(expectedError===undefined)assert.equal(simulation.value.err,null,`${label}: ${simulation.value.logs?.join('\n')}`);
  else assert.equal(simulation.value.err?.InstructionError?.[1]?.Custom,expectedError,`${label}: ${simulation.value.logs?.join('\n')}`);
  const signature=await rpc.call('sendTransaction',[encoded,{encoding:'base64',skipPreflight:true}]);
  await eventually(()=>rpc.call('getSignatureStatuses',[[signature],{searchTransactionHistory:true}]),
    response=>['confirmed','finalized'].includes(response.value[0]?.confirmationStatus),label);
  const history=await eventually(()=>rpc.call('getTransaction',[signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:0}]),value=>Boolean(value),`fetch ${label}`);
  writeFileSync(`${directory}/transaction-${checks.length}.json`,json(history));assert.equal(history.transaction.signatures[0],signature);
  if(expectedError===undefined) {
    assert.equal(history.meta.err,null,label);assert(history.meta.computeUnitsConsumed*5<=declaredComputeUnits*4,`${label}: CU headroom`);
    for(const inner of (history.meta.innerInstructions??[]).flatMap((outer:any)=>outer.instructions)) {
      if(history.transaction.message.accountKeys[inner.programIdIndex]!==program)continue;
      const bytes=Buffer.from(base58.encode(inner.data)).subarray(8),event=decodeAccountEvent(bytes);
      if(event){events.push(event);eventBytes.push(bytes.toString('base64'));}
    }
  } else {
    assert.equal(history.meta.err?.InstructionError?.[1]?.Custom,expectedError,label);
    if(label.startsWith('valid route followed'))assert((history.meta.innerInstructions??[]).flatMap((outer:any)=>outer.instructions)
      .some((inner:any)=>history.transaction.message.accountKeys[inner.programIdIndex]===program
        &&decodeAccountEvent(Buffer.from(base58.encode(inner.data)).subarray(8))), 'failed route event retained but excluded');
  }
  checks.push({label,signature,status:expectedError===undefined?'pass':'rejected',bytes:wire.length,accounts:history.transaction.message.accountKeys.length,
    computeUnits:String(history.meta.computeUnitsConsumed),declaredComputeUnits,feeLamports:String(history.meta.fee),error:history.meta.err,
    expectsNotification:history.transaction.message.accountKeys.includes(program)});
  confirmedHistories.push(history);
  writeFileSync(`${directory}/checks.json`,json(checks));
  if(checks.length%25===0)console.log(`P27 RPC: ${checks.length} signed outcomes independently fetched`);
  return history;
}
const h:AccountTradingHarness={
  clockMode:'realtime',
  async rent(size){return BigInt(await rpc.call('getMinimumBalanceForRentExemption',[size]));},read,
  async send(...args){await send(...args);},
  async now(){return (await read(clockAddress))!.readBigInt64LE(32);},
  async slot(){return (await read(clockAddress))!.readBigUInt64LE(0);},
  async advance(seconds){const target=await this.now()+seconds;while(await this.now()<target){const step=(await this.now()+10n)<target?await this.now()+10n:target;await eventually(async()=>{await delay(100);return this.now();},now=>now>=step,'actual clock advancement');}},
  async quote(label,instruction){const history=await send(label,[instruction]);assert.equal(history.meta.returnData?.programId,program);return Buffer.from(history.meta.returnData.data[0],'base64');},
};
let finalizedCount=0;
async function finalize() {
  for(;finalizedCount<checks.length;finalizedCount++) {
    const check=checks[finalizedCount];
    await eventually(()=>rpc.call('getSignatureStatuses',[[check.signature],{searchTransactionHistory:true}]),
      response=>response.value[0]?.confirmationStatus==='finalized',`finalize ${check.label}`);
    const finalized=await rpc.call('getTransaction',[check.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    assert.deepEqual(finalized,confirmedHistories[finalizedCount],`finalized parity ${check.label}`);
    writeFileSync(`${directory}/finalized-${finalizedCount}.json`,json(finalized));
  }
  writeFileSync(`${directory}/ws-notifications.json`,json(ws.notifications));
}
return {h,rpc,checks,send,finalize,close:()=>ws.close(),events,notifications:()=>ws.notifications,
  eventBytes,subscription};
}
