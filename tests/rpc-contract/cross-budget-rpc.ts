import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {address,getBase58Encoder,type Address,type Instruction,type ReadonlyUint8Array} from '@solana/kit';
import {Connection} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {payerKey,program,type Harness} from './custody-cases.js';
import type {GroupTradingHarness} from './group-trading-cases.js';
import {crossBudgetCases} from './cross-budget-cases.js';
import {decodeGroupEvent,groupLiveParity} from './group-live-parity.js';
import {WireRpc,WireSubscriptions,eventually} from './wire.js';

const url=process.env.RIVALT_RPC_URL!,directory=process.env.RIVALT_RUN_DIR!;
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const startedDirty=execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!=='';
assert.equal(new URL(url).hostname,'127.0.0.1');
const rpc=new WireRpc(url),connection=new Connection(url,'confirmed'),ws=new WireSubscriptions(process.env.RIVALT_WS_URL!);
const payer=await payerKey(),base58=getBase58Encoder();
const checks:Record<string,unknown>[]=[],eventBytes:string[]=[],events:ReturnType<typeof decodeGroupEvent>[]=[];
const confirmedHistories:unknown[]=[];
const captures:Record<string,Record<string,string|null>>={};
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
  const sampling=has(sdk.SAMPLE_GROUP_ORACLE_V2_DISCRIMINATOR),routing=has(sdk.EXECUTE_GROUP_ROUTE_V2_DISCRIMINATOR)||has(sdk.EXECUTE_MARGIN_ROUTE_V2_DISCRIMINATOR)||has(sdk.EXECUTE_MARGIN_ORDER_V2_DISCRIMINATOR);
  const resolving=has(sdk.ADVANCE_GROUP_RESOLUTION_V2_DISCRIMINATOR);
  const transferRoute=routing&&has(sdk.TRANSFER_TRADING_CASH_V2_DISCRIMINATOR);
  const declaredComputeUnits=transferRoute?sdk.GROUP_TRANSFER_ROUTE_COMPUTE_UNITS:sampling||resolving?1_200_000:routing?sdk.GROUP_ROUTE_COMPUTE_UNITS:400_000;
  const {transaction}=await sdk.signInstructions(connection,payer,[transferRoute?sdk.groupTransferRouteComputeBudget():sampling||resolving?sdk.fundingComputeBudget():routing?sdk.groupRouteComputeBudget():sdk.routeComputeBudget(),...instructions],signers);
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
      const bytes=Buffer.from(base58.encode(inner.data)).subarray(8),event=decodeGroupEvent(bytes);
      if(event){events.push(event);eventBytes.push(bytes.toString('base64'));}
    }
  } else assert.equal(history.meta.err?.InstructionError?.[1]?.Custom,expectedError,label);
  checks.push({label,signature,status:expectedError===undefined?'pass':'rejected',bytes:wire.length,accounts:history.transaction.message.accountKeys.length,
    computeUnits:String(history.meta.computeUnitsConsumed),declaredComputeUnits,feeLamports:String(history.meta.fee),error:history.meta.err,
    expectsNotification:history.transaction.message.accountKeys.includes(program)});
  confirmedHistories.push(history);
  writeFileSync(`${directory}/checks.json`,json(checks));
  if(checks.length%10===0)console.log(`P20 RPC: ${checks.length} signed outcomes independently fetched`);
  return history;
}
const h:GroupTradingHarness={
  async rent(size){return BigInt(await rpc.call('getMinimumBalanceForRentExemption',[size]));},read,
  async send(...args){await send(...args);},
  async now(){return (await read(clockAddress))!.readBigInt64LE(32);},
  async slot(){return (await read(clockAddress))!.readBigUInt64LE(0);},
  async advance(seconds){
    assert(seconds>=0n&&seconds<=60n,'bounded real-clock wait');
    const target=await this.now()+seconds,deadline=Date.now()+Number(seconds)*1_000+15_000;
    // Source-outage cases intentionally wait 21/30 real seconds. A 15-second
    // generic RPC retry deadline cannot represent that elapsed-time requirement.
    while(await this.now()<target){
      assert(Date.now()<deadline,'timed out waiting for actual clock advancement');
      await delay(100);
    }
  },
  async quote(label,instruction){const history=await send(label,[instruction]);assert.equal(history.meta.returnData?.programId,program);return Buffer.from(history.meta.returnData.data[0],'base64');},
};
try {
  const result=await crossBudgetCases(h,async(label,keys)=>{
    captures[label]=Object.fromEntries(await Promise.all(keys.map(async key=>[key,(await read(key))?.toString('base64')??null])));
    writeFileSync(`${directory}/captures.json`,json(captures));
  });
  // Keep the source sampling loop causal without waiting 32 slots per feed.
  // Acceptance still independently fetches every original signature finalized,
  // including rejected transactions, and compares it with the confirmed result.
  for(const [index,check] of checks.entries()) {
    await eventually(()=>rpc.call('getSignatureStatuses',[[check.signature],{searchTransactionHistory:true}]),
      response=>response.value[0]?.confirmationStatus==='finalized',`finalize ${check.label}`);
    const finalized=await rpc.call('getTransaction',[check.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    assert.deepEqual(finalized,confirmedHistories[index],`finalized parity ${check.label}`);
    writeFileSync(`${directory}/finalized-${index}.json`,json(finalized));
  }
  await ws.notification(subscription);
  const fixture=result.fixture;
  const accounts=await Promise.all([
    ['clearingGroupV2',fixture.group],['groupExitGuardV2',fixture.guard],['groupResolutionV2',fixture.resolution],
    ['marginAccountV2',fixture.roots[0]],['groupMarketV2',fixture.markets[1]],
  ].map(async([name,key])=>({name,bytes:(await read(key as Address))!.toString('base64')})));
  const parity=groupLiveParity(directory,accounts,eventBytes);
  const sequences=events.map(event=>{const data=event!.data as any;return BigInt(data.sequence??data.execution?.sequence??data.change?.sequence);});
  for(let index=1;index<sequences.length;index++)assert.equal(sequences[index],sequences[index-1]+1n,'committed event continuity');
  const observed=new Set(ws.notifications.map(entry=>entry.params?.result?.value?.signature));
  const expectedNotifications=checks.filter(check=>check.expectsNotification);
  const missed=expectedNotifications.filter(check=>!observed.has(check.signature)).map(check=>check.signature);
  assert.equal(missed.length,0,'all subscribed clearing outcomes observed over actual WS');
  writeFileSync(`${directory}/ws-notifications.json`,json(ws.notifications));
  const finishedRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  writeFileSync(`${directory}/summary.json`,json({revision,finishedRevision,qualificationVersion:result.qualificationVersion,
    trackedDirty:startedDirty||finishedRevision!==revision||execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()!=='',
    runtime:await rpc.call('getVersion'),genesis:await rpc.call('getGenesisHash'),checks,parity,
    wsNotifications:ws.notifications.length,expectedNotifications:expectedNotifications.length,missedNotifications:missed,
    hashes:Object.fromEntries(['clearing','maker_a','maker_b','oracle_fixture'].map(name=>[name,createHash('sha256').update(readFileSync(`.local/successor-p20/${name==='clearing'?'clearing-cross-qualification':name}.so`)).digest('hex')])),
    keys:{group:fixture.group,registry:fixture.registry,vault:fixture.vault,markets:fixture.markets,roots:fixture.roots,
      liquidationTarget:result.liquidationTarget,guard:fixture.guard,resolution:fixture.resolution,tokens:fixture.operators.map(operator=>operator.token.address)},captures:Object.keys(captures)}));
  console.log(`P20 RPC: ${checks.length} finalized scenarios; ${events.length} events; ${ws.notifications.length} WS notifications; legacy parity passed.`);
} finally {ws.close();}
