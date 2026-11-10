import { getProgramDerivedAddress } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { Rpc, Subscription, integer } from './rpc.js';
import { hash, type JournalEvent } from './events.js';
import { JournalStore, PUBLICATION_MAX_AGE_MS, type JournalSnapshot, type JournalBinding, type JournalInvocation } from './store.js';
import {readFinalizedBlock,validateBlockChain,type FinalizedBlock,type BlockFence} from './finalized-block.js';
import type {RevisionVector} from './scoped-history.js';


export type ReconciliationWitness<State>={maxSlot:number;matches(state:State):boolean;verify(state:State):Promise<unknown>};
// Each block has two authenticated reads (body + signature manifest). Bound
// network concurrency while retaining canonical slot/transaction application.
export const FINALIZED_BLOCK_READ_WIDTH=8;
export type TransportConfig = { rpcUrl:string; wsUrl:string; databaseUrl:string; runId:string; anchor:string;
  pageSize?:number; maxRecoveryTransactions?:number; maxRpcResponseBytes?:number; chain?:sdk.TestChain; maxTransactionVersion?:0|1 };

export abstract class FinalizedIndexer<State extends {sequence:string;revisions:RevisionVector}, Binding extends JournalBinding, Event extends JournalEvent> {
  readonly rpc: Rpc;
  readonly deployment: ReturnType<typeof sdk.testDeployment>;
  readonly options: { programAddress: ReturnType<typeof sdk.testDeployment>['clearing'] };
  readonly store: JournalStore<State, Binding, Event>;
  ws?: Subscription;
  eventAuthority = '';
  healthy = false;
  metrics = { cycles: 0, pages: 0, fetched: 0, notifications: 0, reconnects: 0, failures: 0, catchups: 0, historyRestarts: 0, chunks: 0, pending: 0, peakBlockTransactions: 0, peakCommitMs: 0 };
  private busy = false;
  private anchorSlot=0;
  constructor(readonly config: TransportConfig, store: JournalStore<State, Binding, Event>) {
    this.deployment = sdk.testDeployment(config.chain);
    this.options = { programAddress: this.deployment.clearing };
    sdk.testRpcUrl(config.rpcUrl, this.deployment.chain);
    sdk.testRpcUrl(config.wsUrl, this.deployment.chain, true);
    if (!Number.isSafeInteger(config.maxRecoveryTransactions ?? 10_000) || (config.maxRecoveryTransactions ?? 10_000) < 1 || (config.maxRecoveryTransactions ?? 10_000) > 200_000) throw new Error('Invalid bounded history recovery limit');
    this.rpc = new Rpc(config.rpcUrl,config.maxRpcResponseBytes); this.store = store;
    if (!Number.isInteger(config.pageSize ?? 100) || (config.pageSize ?? 100) < 1 || (config.pageSize ?? 100) > 1000) throw new Error('Invalid history page size');
  }
  async transaction(signature: string) {
    const tx = await this.rpc.call('getTransaction', [signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:this.config.maxTransactionVersion??0}]);
    if (!tx) throw new Error(`History gap: transaction ${signature} unavailable`); return tx;
  }
  async open() {
    this.eventAuthority = (await getProgramDerivedAddress({ programAddress: this.deployment.clearing, seeds: [Buffer.from('__event_authority')] }))[0];
    await this.store.migrate();
    const anchor = await this.transaction(this.config.anchor);
    this.anchorSlot=integer(anchor.slot);
    const genesis = await this.rpc.call('getGenesisHash');
    if (this.deployment.genesis && genesis !== this.deployment.genesis) throw new Error('Devnet genesis mismatch');
    await this.store.bind(await this.initializeBinding(anchor, genesis));
    await this.connect();
  }
  async connect() {
    this.ws?.close(); this.healthy = false;
    this.ws = new Subscription(this.config.wsUrl, this.historyAddress); await this.ws.ready; this.metrics.reconnects++;
  }
  async cycle() {
    if (this.busy) throw new Error('Concurrent indexing cycle');
    this.busy = true;
    try {
      await this.ingest();
    } catch (error) {
      this.healthy=false;this.metrics.failures++;
      await this.store.health(error instanceof Error ? error.message : 'Indexer failure').catch(() => {});
      throw error;
    } finally { this.busy = false; }
  }
  private async ingest() {
    if (!this.ws || this.ws.error) await this.connect();
    while (this.ws!.buffer.length) {
      const notice = this.ws!.buffer.shift();
      await this.store.observe('ws-confirmed', notice.value.signature, notice); this.metrics.notifications++;
    }
    const row = await this.store.snapshot();
    if (row.binding.genesis !== await this.rpc.call('getGenesisHash') ||
        row.binding.anchorHash !== hash((await this.transaction(this.config.anchor)).transaction)) throw new Error('Chain identity changed');
    const capturedAt=new Date(),target=integer(await this.rpc.call('getSlot',[{commitment:'finalized'}]));
    const budget={transactions:this.config.maxRecoveryTransactions??10_000};
    const covered=await this.cover(target,budget);
    if(!covered||Date.now()-capturedAt.getTime()>=PUBLICATION_MAX_AGE_MS){this.healthy=false;this.metrics.pending++;return;}
    const candidate=await this.store.snapshot();
    const witness=await this.capture(candidate,target);
    if(!await this.cover(witness.maxSlot,budget)){this.healthy=false;this.metrics.pending++;return;}
    // Every published entity must match the captured bytes at the SAME complete
    // historical revision fence. Forward-overwriting an old bad snapshot is not
    // proof of that old snapshot. Search only this finite captured interval.
    let replay=candidate,best=witness.matches(candidate.state)?candidate:null;
    for await(const block of this.store.blocksAfter(target,witness.maxSlot)) {
      validateBlockChain([block],{slot:Number(replay.checkpoint_slot),blockhash:replay.checkpoint!},{slot:block.slot,blockhash:block.blockhash});
      const state=this.store.projection.apply(replay.state,this.decodeBlock(block,row.binding),row.binding).state;
      replay={...replay,state,checkpoint:block.blockhash,checkpoint_slot:String(block.slot)};
      if(witness.matches(state))best=replay;
    }
    if(!best||Date.now()-capturedAt.getTime()>=PUBLICATION_MAX_AGE_MS){this.healthy=false;this.metrics.pending++;return;}
    await witness.verify(best.state);
    const fence={slot:Number(replay.checkpoint_slot),blockhash:replay.checkpoint!};
    // A missing status is not proof of a fork or nonexecution. Keep it retryable.
    const jobs=(await this.store.pool.query(`SELECT signature FROM jobs WHERE run_id=$1 AND status IN ('pending','unresolved')
      AND next_attempt<=now() ORDER BY next_attempt LIMIT 100`,[this.config.runId])).rows;
    if(jobs.length){
      const statuses=await this.rpc.call('getSignatureStatuses',[jobs.map(j=>j.signature),{searchTransactionHistory:true}]);
      for(const [i,job] of jobs.entries()){
        if(statuses.value[i]?.confirmationStatus==='finalized'&&integer(statuses.value[i].slot)<=fence!.slot)
          throw new Error('History gap: finalized WS observation absent from complete block fence');
        await this.store.pool.query(`UPDATE jobs SET attempts=attempts+1,status='unresolved',next_attempt=now()+interval '5 seconds' WHERE run_id=$1 AND signature=$2`,[this.config.runId,job.signature]);
      }
    }
    if (this.ws!.error) throw this.ws!.error;
    await this.store.publish(best,capturedAt); this.healthy = true; this.metrics.cycles++;
  }
  private decodeBlock(block:FinalizedBlock,binding:Binding):JournalInvocation<Event>[] {
    return block.transactions.flatMap(({signature,tx},index)=>{
      const keys=[...tx.transaction.message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
      return keys.includes(this.deployment.clearing)?this.decodeTransaction(signature,tx,index,binding):[];
    });
  }
  /** One complete block per SQL transaction; at most one bounded RPC batch in
   * memory. The work budget may overshoot by one indivisible block, never reject
   * an otherwise valid historical prefix because the whole backlog is large. */
  private async cover(target:number,budget:{transactions:number}) {
    let row=await this.store.snapshot();
    let fence:BlockFence|null=row.checkpoint?{slot:Number(row.checkpoint_slot),blockhash:row.checkpoint}:null;
    const start=fence?fence.slot+1:this.anchorSlot;
    if(target<start-1)throw new Error('Finalized block fence regressed');
    const pageSize=this.config.pageSize??100;
    for(let first=start;first<=target;first+=pageSize) {
      if(budget.transactions<=0)return false;
      const last=Math.min(target,first+pageSize-1);
      const slots=await this.rpc.call('getBlocks',[first,last,{commitment:'finalized'}]);this.metrics.pages++;
      if(!Array.isArray(slots)||slots.some((slot:unknown,index:number)=>integer(slot)<first||integer(slot)>last||(index>0&&integer(slot)<=slots[index-1])))
        throw new Error('Invalid finalized block range');
      for(let offset=0;offset<slots.length;offset+=FINALIZED_BLOCK_READ_WIDTH) {
        if(budget.transactions<=0)return false;
        const responses=await Promise.allSettled(slots.slice(offset,offset+FINALIZED_BLOCK_READ_WIDTH).map((slot:number)=>
          readFinalizedBlock(this.rpc,slot,this.config.maxTransactionVersion??0)));
        // Drain all reads even on error, preserving the network concurrency bound.
        const batch=responses.map(response=>{if(response.status==='rejected')throw response.reason;return response.value;});
        for(const block of batch) {
          if(budget.transactions<=0)return false;
          const next={slot:block.slot,blockhash:block.blockhash};
          validateBlockChain([block],fence,next);
          this.metrics.peakBlockTransactions=Math.max(this.metrics.peakBlockTransactions,block.transactions.length);
          this.metrics.fetched+=block.transactions.length;
          const commitStarted=performance.now();
          await this.store.commit([block],this.decodeBlock(block,row.binding),next,fence?.blockhash??null);
          this.metrics.peakCommitMs=Math.max(this.metrics.peakCommitMs,performance.now()-commitStarted);
          this.metrics.chunks++;budget.transactions-=block.transactions.length;fence=next;
        }
      }
    }
    if(!fence||fence.slot!==target)throw new Error('Finalized head block unavailable');
    return true;
  }
  protected abstract capture(snapshot:JournalSnapshot<State,Binding>,minimumSlot:number):Promise<ReconciliationWitness<State>>;
  protected get historyAddress(): string { return this.deployment.clearing; }
  protected abstract initializeBinding(anchor: any, genesis: string): Promise<Binding>;
  protected abstract decodeTransaction(signature:string,transaction:any,transactionIndex:number,binding:Binding):JournalInvocation<Event>[];
  abstract reconcile(snapshot?: {state:State;binding:Binding}): Promise<unknown>;
  async close() { this.healthy = false; this.ws?.close(); await this.store.close(); }
}
