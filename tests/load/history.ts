import assert from 'node:assert/strict';
import {appendFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {getMintToInstruction} from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import {decode,json} from '../../packages/indexer/src/events.js';
import type {environment} from './environment.js';
import {resources} from './resources.js';

/** Build actual clearing history; unique signed amounts prevent deduplication. No fabricated events. */
export async function largeHistory(e:Awaited<ReturnType<typeof environment>>){
  const count=10_001,concurrency=24,actor=e.actors[2],total=BigInt(count)*(BigInt(count)+1n)/2n;
  const before=sdk.getParticipantDecoder().decode((await e.read(actor.participant))!).cash;
  const solBefore=BigInt((await e.rpc.call('getBalance',[actor.owner.address,{commitment:'finalized'}])).value);
  await e.send('mint exact history-test collateral',[getMintToInstruction({mint:e.setup.mint.address,token:actor.token.address,mintAuthority:e.payer,amount:total})]);
  const tokenBefore=(await e.read(actor.token.address))!.readBigUInt64LE(64),signatures=new Set<string>();let next=1,fees=0n,completed=0;
  const start=performance.now();
  await Promise.all(Array.from({length:concurrency},async()=>{
    for(;;){const number=next++;if(number>count)return;
      const amount=BigInt(number),signature=await e.send(`history-deposit:${number}`,[await sdk.getDepositInstructionAsync({...e.a,owner:actor.owner,participant:actor.participant,quoteMint:e.setup.mint.address,userToken:actor.token.address,amount})],[],actor.owner);
      assert(!signatures.has(signature));signatures.add(signature);
      const tx=await e.rpc.call('getTransaction',[signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
      assert.equal(tx.meta.err,null);const events=decode(signature,tx,e.a.eventAuthority);assert.equal(events.length,1);
      assert.equal(events[0].type,'custody');assert.equal(events[0].data.participant,actor.participant);assert.equal(events[0].data.amount,String(amount));
      fees+=BigInt(tx.meta.fee);completed++;
      appendFileSync(`${e.dir}/history-deposits.jsonl`,json({number,signature,amount,fee:tx.meta.fee,sequence:events[0].data.sequence})+'\n');
      if(completed%500===0){console.log(`Actual history deposits finalized: ${completed}/${count}`);const r=await resources(e);appendFileSync(`${e.dir}/history-resources.jsonl`,json(r)+'\n');assert(r.diskFreeBytes>512*1024**2,'History disk reserve');}
    }
  }));
  const cashAfter=sdk.getParticipantDecoder().decode((await e.read(actor.participant))!).cash;
  assert.equal(cashAfter-before,total);assert.equal(tokenBefore-(await e.read(actor.token.address))!.readBigUInt64LE(64),total);
  const solAfter=BigInt((await e.rpc.call('getBalance',[actor.owner.address,{commitment:'finalized'}])).value);assert.equal(solBefore-solAfter,fees);
  const result={count,concurrency,actualUniqueSignatures:signatures.size,totalAtoms:total,cashBefore:before,cashAfter,tokenDelta:-total,networkFees:fees,elapsedSeconds:(performance.now()-start)/1000,
    scope:'Actual signed custody deposits, each independently fetched and decoded. Separate from offered trading load; replay acceptance follows.'};
  writeFileSync(`${e.dir}/history.json`,json(result));return result;
}
