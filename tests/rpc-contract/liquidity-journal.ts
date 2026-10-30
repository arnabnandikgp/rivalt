// Current scoped journal harness. Initialization address lookup locates the
// anchor only; complete finalized blocks prove subsequent history coverage.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as sdk from '@rivalt/sdk';
import {decodeAccountInvocations,type AccountInvocation} from '../../packages/indexer/src/account-events.js';
import {eventPayloads,hash,type JournalEvent} from '../../packages/indexer/src/events.js';
import {readFinalizedBlock,validateBlockChain,type FinalizedBlock} from '../../packages/indexer/src/finalized-block.js';
import {orderScopedTransactions} from '../../packages/indexer/src/scoped-history.js';
import type {LiquidityBinding} from '../../packages/indexer/src/liquidity-store.js';
import type {WireRpc} from './wire.js';

export const digestEvents=(events:Pick<JournalEvent,'bytes'>[])=>events.reduce((digest,event)=>createHash('sha256')
  .update(Buffer.from(digest,'hex')).update(Buffer.from(event.bytes,'base64')).digest('hex'),'0'.repeat(64));
export async function fetchScopedHistory(rpc:WireRpc,anchor:string,authority:string,venue:string,domain:string) {
  const original=await rpc.call('getTransaction',[anchor,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
  assert(original,'Actual initialization receipt');
  const end=await rpc.call('getSlot',[{commitment:'finalized'}]),blocks:FinalizedBlock[]=[],invocations:AccountInvocation[]=[];
  for(let start=original.slot;start<=end;start+=1000) {
    const slots=await rpc.call('getBlocks',[start,Math.min(end,start+999),{commitment:'finalized'}]);
    for(const slot of slots) {
      const block=await readFinalizedBlock(rpc,slot,1);
      blocks.push(block);
      for(const [index,{signature,tx}] of block.transactions.entries()) {
        const keys=[...tx.transaction.message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
        if(keys.includes(sdk.CLEARING_PROGRAM_ADDRESS))invocations.push(...decodeAccountInvocations(signature,tx,index,
          {program:sdk.CLEARING_PROGRAM_ADDRESS,eventAuthority:authority,venue,domain}));
      }
    }
  }
  const head={slot:end,blockhash:blocks.at(-1)!.blockhash};validateBlockChain(blocks,null,head);
  const order=orderScopedTransactions(invocations,{}),byIdentity=new Map(invocations.map(value=>[`${value.signature}/${value.outer}/${value.invocation}`,value]));
  const events=order.transactions.flatMap(transaction=>transaction.envelopes.flatMap(value=>byIdentity.get(`${value.signature}/${value.outer}/${value.invocation}`)!.events));
  return {blocks,invocations,events,head,transactions:blocks.flatMap(block=>block.transactions),digest:digestEvents(events),original};
}
export async function journalBinding(rpc:WireRpc,anchor:string,history:Awaited<ReturnType<typeof fetchScopedHistory>>,
  venue:string,domain:string):Promise<LiquidityBinding> {
  const first=history.events.find(event=>event.signature===anchor&&event.type==='AccountCustodyChangedV3'&&event.data.kind===0);
  assert(first);assert.equal(first.data.schemaVersion,6);assert.equal(first.data.profileVersion,4);
  return {schema:6,profile:'liquidity-execution-qualification',artifactSet:sdk.LIQUIDITY_ARTIFACT_SET,
    genesis:await rpc.call('getGenesisHash',[]),domain,anchor,anchorHash:hash(history.original.transaction),program:sdk.CLEARING_PROGRAM_ADDRESS,venue};
}
export async function initializationSignature(rpc:WireRpc,signatures:string[],authority:string) {
  for(const signature of signatures) {
    const tx=await rpc.call('getTransaction',[signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    if(!tx||tx.meta.err!==null)continue;
    if(eventPayloads(signature,tx,authority).some(({payload})=>payload.subarray(0,8).equals(Buffer.from(sdk.ACCOUNT_CUSTODY_CHANGED_EVENT_DISCRIMINATOR))
      &&sdk.getAccountCustodyChangedEventDecoder().decode(payload).kind===0))return signature;
  }
  throw new Error('Missing actual initialization signature');
}
