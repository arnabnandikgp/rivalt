import assert from 'node:assert/strict';
import type {Address,Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {CanonicalHarness} from './canonical-maker-cases.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {initializeFixtureFeed,publishFixtureFeed,type SourceChange} from './oracle-fixture.js';
import type {ExpectedInstructionError} from './instruction-errors.js';

export async function qualifyListingIndex(h:CanonicalHarness,setup:Awaited<ReturnType<typeof liquidityExecutionSetup>>,
    listing:Address,primaryAsset:Address,financial:Address[]) {
  const {venue,safety,payer,primary,guard}=setup;
  const {feed:guardAsset,feedId}=await sdk.listingOracle('SOL',guard.address);
  await h.send('initialize guard SOL/USD',[initializeFixtureFeed(guardAsset,guard.address,feedId)],[guard]);
  const sources=[primaryAsset,setup.feeds[1].feed,guardAsset,setup.feeds[3].feed] as const;
  const [listingIndex]=await sdk.findListingIndexPda({listing});
  const common={venue,safety,listing,listingIndex,primaryCollateral:sources[1],guardCollateral:sources[3],
    program:sdk.CLEARING_PROGRAM_ADDRESS};
  const bind=(overrides:Partial<Parameters<typeof sdk.getBindListingIndexInstructionAsync>[0]>={})=>
    sdk.getBindListingIndexInstructionAsync({...common,authority:payer,market:setup.markets[0],...overrides});
  const observe=(overrides:Partial<Parameters<typeof sdk.getObserveListingIndexInstructionAsync>[0]>={})=>
    sdk.getObserveListingIndexInstructionAsync({...common,primaryAsset,guardAsset,...overrides});
  const watched=[listingIndex,listing,...financial];
  const balances=()=>Promise.all(watched.map(h.read));
  async function reject(label:string,instruction:Instruction,error:ExpectedInstructionError,signers:(typeof payer)[]=[]) {
    const before=await balances();
    await h.send(label,[instruction],signers,error);
    assert.deepEqual(await balances(),before,label);
  }
  const before=await Promise.all(financial.map(h.read));
  await reject('refuse substituted collateral guard at binding',await bind({guardCollateral:sources[1]}),sdk.CLEARING_ERROR__ORACLE_SOURCE);
  await reject('refuse trader binding SOL sources',await bind({authority:setup.traderOwner}),2001,[setup.traderOwner]);
  const binding=await bind(),sample=await observe();
  await h.send('bind SOL index',[binding]);
  await reject('refuse rebinding the SOL index',binding,0);
  const read=async()=>sdk.getListingIndexDecoder().decode((await h.read(listingIndex))!);
  const empty=await read();
  assert.equal(empty.revision,1n);
  assert.equal(empty.deadline,0n);
  assert.deepEqual(empty.sources,sources);
  const publishers=[primary.address,primary.address,guard.address,guard.address] as const;
  const publish=async(prices:bigint[],time:bigint,changes:SourceChange[] = [])=>{
    const instructions=sources.map((feed,i)=>publishFixtureFeed(feed,publishers[i],time,
      {price:prices[i],confidence:[300_000n,1_000n,100_000n,1_000n][i],...changes[i]}));
    await h.send('publish signed SOL and collateral fixture prices',instructions,[primary,guard]);
  };
  // Rounded independently in collateral atoms per one-millionth SOL.
  // Primary 150/.99, guard 151/.99. Confidence and 1% padding widen the union.
  const first=[150_000_000n,990_000n,151_000_000n,990_000n],time=await setup.now();
  await publish(first,time,[{},{},{published:time-12n}]);
  const financialBefore=await Promise.all(financial.map(h.read));
  await h.send('SOL sample at 99-cent collateral',[sample]);
  const initial=await read();
  assert.deepEqual([initial.reference,initial.lower,initial.upper,initial.deadline,initial.revision],
    [151n,149n,155n,time+8n,2n]);
  assert.deepEqual(await Promise.all(financial.map(h.read)),financialBefore);
  await setup.waitUntil(initial.sampledAt+2n);
  await reject('SOL sample unchanged sources',sample,sdk.CLEARING_ERROR__ORACLE_POLICY);
  await reject('SOL sample with BTC primary',await observe({primaryAsset:setup.feeds[0].feed}),sdk.CLEARING_ERROR__ORACLE_SOURCE);
  await reject('SOL sample with primary as guard',await observe({guardAsset:primaryAsset}),sdk.CLEARING_ERROR__ORACLE_SOURCE);
  await setup.waitUntil(initial.deadline);
  for(const [label,position,change,error] of [
    ['stale primary',0,{age:21n},sdk.CLEARING_ERROR__ORACLE_POLICY],
    ['stale collateral guard',3,{age:21n},sdk.CLEARING_ERROR__ORACLE_POLICY],
    ['divergent guard',2,{price:170_000_000n},sdk.CLEARING_ERROR__ORACLE_POLICY],
    ['excessive confidence',0,{confidence:750_001n},sdk.CLEARING_ERROR__ORACLE_POLICY],
    ['unverified guard',2,{level:1},sdk.CLEARING_ERROR__ORACLE_SOURCE],
  ] as const) {
    const now=await setup.now(),changes:SourceChange[]=[];
    changes[position]='age' in change ? {published:now-change.age} : change;
    await publish(first,now,changes);
    await reject('SOL sample '+label,sample,error);
  }
  assert.deepEqual(await read(),initial);
  const recoveryTime=await setup.now();
  await publish([149_500_000n,1_010_000n,150_000_000n,1_010_000n],recoveryTime);
  await h.send('SOL sample after source recovery',[sample]);
  const recovered=await read();
  assert.deepEqual([recovered.reference,recovered.lower,recovered.upper,recovered.deadline,recovered.revision],
    [148n,146n,151n,recoveryTime+20n,3n]);
  assert(recovered.sourceSequences.every((sequence,i)=>sequence>initial.sourceSequences[i]));
  assert.deepEqual(await Promise.all(financial.map(h.read)),before);
  return {listingIndex,binding,sample,initial,recovered};
}
