import { getProgramDerivedAddress } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { Rpc, Subscription, integer } from './rpc.js';
import { hash, json, type JournalEvent } from './events.js';
import { JournalStore, type JournalBinding } from './store.js';

export type TransportConfig = { rpcUrl:string; wsUrl:string; databaseUrl:string; runId:string; anchor:string;
  pageSize?:number; maxRecoveryTransactions?:number; chain?:sdk.TestChain };

export abstract class FinalizedIndexer<State extends {sequence:string}, Binding extends JournalBinding, Event extends JournalEvent> {
  readonly rpc: Rpc;
  readonly deployment: ReturnType<typeof sdk.testDeployment>;
  readonly options: { programAddress: ReturnType<typeof sdk.testDeployment>['clearing'] };
  readonly store: JournalStore<State, Binding, Event>;
  ws?: Subscription;
  eventAuthority = '';
  healthy = false;
  metrics = { cycles: 0, pages: 0, fetched: 0, notifications: 0, reconnects: 0, failures: 0 };
  private busy = false;
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
    const tx = await this.rpc.call('getTransaction', [signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    if (!tx) throw new Error(`History gap: transaction ${signature} unavailable`); return tx;
  }
  async open() {
    this.eventAuthority = (await getProgramDerivedAddress({ programAddress: this.deployment.clearing, seeds: [Buffer.from('__event_authority')] }))[0];
    await this.store.migrate();
    const anchor = await this.transaction(this.config.anchor);
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
      if (!this.ws || this.ws.error) await this.connect();
      while (this.ws!.buffer.length) {
        const notice = this.ws!.buffer.shift();
        await this.store.observe('ws-confirmed', notice.value.signature, notice); this.metrics.notifications++;
      }
      const row = await this.store.snapshot();
      if (row.binding.genesis !== await this.rpc.call('getGenesisHash') ||
          row.binding.anchorHash !== hash((await this.transaction(this.config.anchor)).transaction)) throw new Error('Chain identity changed');
      const boundary = row.checkpoint ?? this.config.anchor;
      const signatures: any[] = [], seen = new Set<string>();
      let before: string | undefined, found = false;
      for (let page = 0; page < 10_000; page++) {
        const batch = await this.rpc.call('getSignaturesForAddress', [this.historyAddress,{commitment:'finalized',limit:this.config.pageSize ?? 100,...(before ? {before} : {})}]);
        this.metrics.pages++;
        if (!Array.isArray(batch) || !batch.length) break;
        for (const item of batch) {
          integer(item.slot);
          if (item.signature === boundary) { if (!row.checkpoint) signatures.push(item); found = true; break; }
          if (seen.has(item.signature)) throw new Error('History pagination failed to advance');
          seen.add(item.signature); signatures.push(item);
          if (signatures.length > (this.config.maxRecoveryTransactions ?? 10_000)) throw new Error(`History recovery exceeds ${this.config.maxRecoveryTransactions ?? 10_000}-transaction local batch bound`);
        }
        if (found) break;
        before = batch.at(-1).signature;
      }
      if (!found) throw new Error('History gap: checkpoint/initialization not reachable');
      const txs: {signature:string;tx:any}[] = [], events: Event[] = [];
      for (const item of signatures) {
        const tx = await this.transaction(item.signature); this.metrics.fetched++;
        if (tx.slot !== item.slot || json(tx.meta.err) !== json(item.err)) throw new Error('Finalized history conflict');
        await this.store.observe('rpc-finalized',item.signature,tx);
        txs.push({signature:item.signature,tx}); events.push(...this.decodeTransaction(item.signature,tx));
      }
      // Verify the entire candidate against one chain snapshot before advancing the
      // durable cursor. In particular, missing tail events must not strand it ahead
      // of an incomplete projection. Chain progress simply retries this batch.
      const candidate=structuredClone(row.state);
      for(const event of [...events].sort((a,b)=>BigInt(a.data.sequence)<BigInt(b.data.sequence)?-1:1))
        if(BigInt(event.data.sequence)>BigInt(row.state.sequence))this.store.projection.project(candidate,event,row.binding);
      await this.reconcile({state:candidate,binding:row.binding});
      await this.store.commit(txs,events,signatures[0] ?? null,row.checkpoint);
      // A missing status is not proof of a fork or nonexecution. Keep it retryable.
      const jobs=(await this.store.pool.query(`SELECT signature FROM jobs WHERE run_id=$1 AND status IN ('pending','unresolved')
        AND next_attempt<=now() ORDER BY next_attempt LIMIT 100`,[this.config.runId])).rows;
      if(jobs.length){
        const statuses=await this.rpc.call('getSignatureStatuses',[jobs.map(j=>j.signature),{searchTransactionHistory:true}]);
        for(const [i,job] of jobs.entries()){
          if(statuses.value[i]?.confirmationStatus==='finalized') throw new Error('History gap: finalized WS observation absent from canonical scan');
          await this.store.pool.query(`UPDATE jobs SET attempts=attempts+1,status='unresolved',next_attempt=now()+interval '5 seconds' WHERE run_id=$1 AND signature=$2`,[this.config.runId,job.signature]);
        }
      }
      if (this.ws!.error) throw this.ws!.error;
      await this.store.health(null); this.healthy = true; this.metrics.cycles++;
    } catch (error) {
      this.metrics.failures++;
      await this.store.health(error instanceof Error ? error.message : 'Indexer failure').catch(() => {});
      throw error;
    } finally { this.busy = false; }
  }
  protected get historyAddress(): string { return this.deployment.clearing; }
  protected abstract initializeBinding(anchor: any, genesis: string): Promise<Binding>;
  protected abstract decodeTransaction(signature: string, transaction: any): Event[];
  abstract reconcile(snapshot?: {state:State;binding:Binding}): Promise<unknown>;
  async close() { this.healthy = false; this.ws?.close(); await this.store.close(); }
}
