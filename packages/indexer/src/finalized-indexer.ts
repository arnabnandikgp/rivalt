import { getProgramDerivedAddress } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { Rpc, Subscription, integer } from './rpc.js';
import { hash, type JournalEvent } from './events.js';
import { JournalStore, type JournalBinding, type JournalInvocation } from './store.js';
import {decodeFinalizedBlock,validateBlockChain,type FinalizedBlock,type BlockFence} from './finalized-block.js';
import type {RevisionVector} from './scoped-history.js';
import {ReconciliationAhead} from './reconciliation-progress.js';

export const MAX_RECONCILIATION_CATCHUPS=3;
export type TransportConfig = { rpcUrl:string; wsUrl:string; databaseUrl:string; runId:string; anchor:string;
  pageSize?:number; maxRecoveryTransactions?:number; chain?:sdk.TestChain; maxTransactionVersion?:0|1 };

export abstract class FinalizedIndexer<State extends {sequence:string;revisions:RevisionVector}, Binding extends JournalBinding, Event extends JournalEvent> {
  readonly rpc: Rpc;
  readonly deployment: ReturnType<typeof sdk.testDeployment>;
  readonly options: { programAddress: ReturnType<typeof sdk.testDeployment>['clearing'] };
  readonly store: JournalStore<State, Binding, Event>;
  ws?: Subscription;
  eventAuthority = '';
  healthy = false;
  metrics = { cycles: 0, pages: 0, fetched: 0, notifications: 0, reconnects: 0, failures: 0, catchups: 0, historyRestarts: 0 };
  private busy = false;
  private anchorSlot=0;
  constructor(readonly config: TransportConfig, store: JournalStore<State, Binding, Event>) {
    this.deployment = sdk.testDeployment(config.chain);
    this.options = { programAddress: this.deployment.clearing };
    sdk.testRpcUrl(config.rpcUrl, this.deployment.chain);
    sdk.testRpcUrl(config.wsUrl, this.deployment.chain, true);
    if (!Number.isSafeInteger(config.maxRecoveryTransactions ?? 10_000) || (config.maxRecoveryTransactions ?? 10_000) < 1 || (config.maxRecoveryTransactions ?? 10_000) > 200_000) throw new Error('Invalid bounded history recovery limit');
    this.rpc = new Rpc(config.rpcUrl); this.store = store;
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
    this.busy = true; this.healthy = false;
    try {
      await this.ingest();
    } catch (error) {
      this.metrics.failures++;
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
    const blocks:FinalizedBlock[]=[],invocations:JournalInvocation<Event>[]=[];
    let candidate=structuredClone(row.state),fence:BlockFence|null=row.checkpoint?{slot:Number(row.checkpoint_slot),blockhash:row.checkpoint}:null;
    const previous=fence;
    let transactionCount=0;
    for(let attempt=0;;attempt++) {
      const finalized=integer(await this.rpc.call('getSlot',[{commitment:'finalized'}]));
      const start=fence?fence.slot+1:this.anchorSlot;
      if(finalized<start-1)throw new Error('Finalized block fence regressed');
      const added:JournalInvocation<Event>[]=[];
      for(let first=start;first<=finalized;first+=1000) {
        const last=Math.min(finalized,first+999);
        const slots=await this.rpc.call('getBlocks',[first,last,{commitment:'finalized'}]);this.metrics.pages++;
        if(!Array.isArray(slots)||slots.some((slot:unknown,index:number)=>integer(slot)<first||integer(slot)>last||(index>0&&integer(slot)<=slots[index-1])))
          throw new Error('Invalid finalized block range');
        for(const slot of slots) {
          const block=decodeFinalizedBlock(slot,await this.rpc.call('getBlock',[slot,{encoding:'json',commitment:'finalized',
            transactionDetails:'full',rewards:false,maxSupportedTransactionVersion:this.config.maxTransactionVersion??0}]));
          transactionCount+=block.transactions.length;
          if(transactionCount>(this.config.maxRecoveryTransactions??10_000))throw new Error('History recovery exceeds transaction bound');
          for(const [index,{signature,tx}] of block.transactions.entries()) {
            this.metrics.fetched++;
            const keys=[...tx.transaction.message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
            if(keys.includes(this.deployment.clearing)) {
              await this.store.observe('rpc-finalized',signature,tx);
              added.push(...this.decodeTransaction(signature,tx,index,row.binding));
            }
          }
          blocks.push(block);
        }
      }
      // getSlot identifies an actual finalized bank. Missing its full block, or
      // skipping any produced parent, is an incomplete fence even if no known
      // account revision happens to be missing.
      const head=blocks.at(-1)??fence;
      if(!head||head.slot!==finalized)throw new Error('Finalized head block unavailable');
      fence={slot:head.slot,blockhash:head.blockhash};
      validateBlockChain(blocks,previous,fence);
      invocations.push(...added);
      if(invocations.length>4096)throw new Error('Scoped history batch exceeds bound');
      candidate=this.store.projection.apply(row.state,invocations,row.binding).state;
      try {await this.reconcile({state:candidate,binding:row.binding});break;}
      catch(error) {
        if(!(error instanceof ReconciliationAhead)||attempt>=MAX_RECONCILIATION_CATCHUPS)throw error;
        this.metrics.catchups++;
      }
    }
    await this.store.commit(blocks,invocations,fence!,row.checkpoint);
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
    await this.store.health(null); this.healthy = true; this.metrics.cycles++;
  }
  protected get historyAddress(): string { return this.deployment.clearing; }
  protected abstract initializeBinding(anchor: any, genesis: string): Promise<Binding>;
  protected abstract decodeTransaction(signature:string,transaction:any,transactionIndex:number,binding:Binding):JournalInvocation<Event>[];
  abstract reconcile(snapshot?: {state:State;binding:Binding}): Promise<unknown>;
  async close() { this.healthy = false; this.ws?.close(); await this.store.close(); }
}
