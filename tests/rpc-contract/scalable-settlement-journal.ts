import assert from 'node:assert/strict';
import {BACKING_ARTIFACT_SET,BACKING_ARTIFACTS} from './backing-artifacts.js';
import {writeFileSync} from 'node:fs';
import * as sdk from '@rivalt/sdk';
import {LiquidityStore} from '../../packages/indexer/src/liquidity-store.js';
import {reconcileAccountSnapshot} from '../../packages/indexer/src/account-reconcile.js';
import {fetchScopedHistory,journalBinding,initializationSignature} from './liquidity-journal.js';
import {json} from '../../packages/indexer/src/events.js';
import type {AccountInvocation} from '../../packages/indexer/src/account-events.js';
import type {FinalizedBlock} from '../../packages/indexer/src/finalized-block.js';
import type {WireRpc} from './wire.js';
import type {liquidityExecutionSetup} from './liquidity-execution-setup.js';

export async function openSettlementJournal(rpc:WireRpc,setup:Pick<Awaited<ReturnType<typeof liquidityExecutionSetup>>,'payer'|'deployment'|'venue'|'domain'>,signatures:string[],
  build = { artifactSet: BACKING_ARTIFACT_SET, artifacts: BACKING_ARTIFACTS }) {
  const databaseUrl=process.env.RIVALT_DATABASE_URL!;assert(databaseUrl,'Actual owned PostgreSQL is required');
  // Candidate-specific hash binding is test-only. Normal runtime allowlists stay unchanged.
  const {artifactSet, artifacts: candidates} = build;
  await new sdk.ArtifactVerifier(rpc,sdk.LIQUIDITY_ARTIFACTS.map(artifact=>({...artifact,...candidates[artifact.name]}))).verify(setup.payer.address);
  const anchor=await initializationSignature(rpc,signatures,setup.deployment.eventAuthority);
  const history=()=>fetchScopedHistory(rpc,anchor,setup.deployment.eventAuthority,setup.venue,setup.domain.toString('hex'),artifactSet);
  const initial=await history(),binding={...await journalBinding(rpc,anchor,initial,setup.venue,setup.domain.toString('hex')),artifactSet};
  let store:LiquidityStore|undefined;const captures:any[]=[];
  const open=async()=>{const result=new LiquidityStore(databaseUrl,'p55b2-application');await result.migrate();await result.bind(binding);return result;};
  const read=(keys:string[])=>rpc.call('getMultipleAccounts',[keys,{encoding:'base64',commitment:'finalized'}]);
  const checkpoint=async(name:string,publish=false)=>{
    store=await open();
    try {
      const prior=await store.snapshot(),current=await history();
      await store.commit(current.blocks,current.invocations,current.head,prior.checkpoint);
      const snapshot=await store.snapshot();
      const capturedAt=new Date();
      const reads:{keys:string[];response:unknown}[]=[];
      let reconciliation;
      try {reconciliation=await reconcileAccountSnapshot(snapshot.state,binding,async keys=>{
        const response=await read(keys);reads.push({keys,response});return response;
      });} finally {writeFileSync(`${process.env.RIVALT_RUN_DIR}/sql-${name}-snapshot.json`,json({state:snapshot.state,binding,reads}));}
      if(publish)await store.publish(snapshot,capturedAt);
      captures.push({name,state:snapshot.state,reconciliation});
      writeFileSync(`${process.env.RIVALT_RUN_DIR}/application-sql-checkpoints.json`,json(captures));
    } finally {await store.close();store=undefined;}
  };
  const finish=async(auditTransactions?: (blocks: FinalizedBlock[], invocations: AccountInvocation[]) => void, maxBlocksPerCommit?:number)=>{
    const commit=async(target:LiquidityStore, fetched:Awaited<ReturnType<typeof history>>, checkpoint:string|null) => {
      if (maxBlocksPerCommit === undefined) return target.commit(fetched.blocks,fetched.invocations,fetched.head,checkpoint);
      // A live worker may have already indexed a verified prefix of this very chain.
      const previous=checkpoint===null ? -1 : fetched.blocks.findIndex(block=>block.blockhash===checkpoint);
      assert(checkpoint===null || previous>=0,'Prior journal fence missing from refetched chain');
      assert(Number.isSafeInteger(maxBlocksPerCommit) && maxBlocksPerCommit>0);
      for (let start=previous+1; start<fetched.blocks.length; start+=maxBlocksPerCommit) {
        const blocks=fetched.blocks.slice(start,start+maxBlocksPerCommit);
        const firstSlot=blocks[0].slot, last=blocks[blocks.length-1];
        const invocations=fetched.invocations.filter(row=>Number(row.slot)>=firstSlot && Number(row.slot)<=last.slot);
        await target.commit(blocks,invocations,{slot:last.slot,blockhash:last.blockhash},checkpoint);
        checkpoint=last.blockhash;
      }
      assert.equal(checkpoint,fetched.head.blockhash);
    };
    store=await open();let replay:LiquidityStore|undefined;
    try {
      const snapshot=await store.snapshot(),current=await history();
      // Final replay refetches all original RPC bytes into a fresh database.
      await commit(store,current,snapshot.checkpoint);
      const final=await store.snapshot();await store.pool.query('CREATE DATABASE rivalt_p55b2_replay');
      const replayUrl=new URL(databaseUrl);replayUrl.pathname='/rivalt_p55b2_replay';
      replay=new LiquidityStore(replayUrl.toString(),'p55b2-replay');await replay.migrate();await replay.bind(binding);
      const refetched=await history();auditTransactions?.(refetched.blocks, refetched.invocations);await commit(replay,refetched,null);
      const reproduced=await replay.snapshot();assert.deepEqual(reproduced.state,final.state);
      const rows=async(value:LiquidityStore)=>(await value.pool.query('SELECT sequence::text,signature,bytes FROM events WHERE run_id=$1 ORDER BY sequence',[value.runId])).rows;
      const events=await rows(store);assert.deepEqual(await rows(replay),events);
      const reconciliation=await reconcileAccountSnapshot(reproduced.state,binding,read);
      assert.equal((await store.pool.query("SELECT count(*) FROM jobs WHERE run_id=$1 AND status IN ('pending','unresolved')",[store.runId])).rows[0].count,'0');
      return {binding,events:events.length,checkpoints:captures,reconciliation,state:final.state};
    } finally {await replay?.close();await store.close();store=undefined;}
  };
  return {initialEvents:initial.events,checkpoint,finish,close:async()=>{await store?.close();}};
}
