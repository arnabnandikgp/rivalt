import assert from 'node:assert/strict';
import { address, getProgramDerivedAddress } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { Rpc, Subscription, integer } from './rpc.js';
import { decode, hash, json, PROGRAM, type Event } from './events.js';
import { Store, type Binding } from './store.js';
import { project, type State } from './projection.js';

export { Store, Rpc };
export type Config = { rpcUrl: string; wsUrl: string; databaseUrl: string; runId: string; market: string; anchor: string; pageSize?: number };
export class Indexer {
  readonly rpc: Rpc;
  readonly store: Store;
  ws?: Subscription;
  eventAuthority = '';
  healthy = false;
  metrics = { cycles: 0, pages: 0, fetched: 0, notifications: 0, reconnects: 0, failures: 0 };
  private busy = false;
  constructor(readonly config: Config) {
    this.rpc = new Rpc(config.rpcUrl); this.store = new Store(config.databaseUrl, config.runId);
    if (!Number.isInteger(config.pageSize ?? 100) || (config.pageSize ?? 100) < 1 || (config.pageSize ?? 100) > 1000) throw new Error('Invalid history page size');
  }
  async transaction(signature: string) {
    const tx = await this.rpc.call('getTransaction', [signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]);
    if (!tx) throw new Error(`History gap: transaction ${signature} unavailable`); return tx;
  }
  async open() {
    this.eventAuthority = (await getProgramDerivedAddress({ programAddress: PROGRAM, seeds: [Buffer.from('__event_authority')] }))[0];
    await this.store.migrate();
    const anchor = await this.transaction(this.config.anchor);
    const init = decode(this.config.anchor, anchor, this.eventAuthority).find(e => e.type === 'custody' && e.data.kind === 0 && e.data.sequence === '1');
    if (!init || init.data.market !== this.config.market) throw new Error('Invalid initialization anchor');
    await this.store.bind({ genesis: await this.rpc.call('getGenesisHash'), market: this.config.market, domain: init.data.domain,
      anchor: this.config.anchor, anchorHash: hash(anchor.transaction), program: PROGRAM, schema: 1 });
    await this.connect();
  }
  async connect() {
    this.ws?.close(); this.healthy = false;
    this.ws = new Subscription(this.config.wsUrl, PROGRAM); await this.ws.ready; this.metrics.reconnects++;
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
        const batch = await this.rpc.call('getSignaturesForAddress', [PROGRAM,{commitment:'finalized',limit:this.config.pageSize ?? 100,...(before ? {before} : {})}]);
        this.metrics.pages++;
        if (!Array.isArray(batch) || !batch.length) break;
        for (const item of batch) {
          integer(item.slot);
          if (item.signature === boundary) { if (!row.checkpoint) signatures.push(item); found = true; break; }
          if (seen.has(item.signature)) throw new Error('History pagination failed to advance');
          seen.add(item.signature); signatures.push(item);
          if (signatures.length > 10_000) throw new Error('History recovery exceeds 10000-transaction local batch bound');
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
        txs.push({signature:item.signature,tx}); events.push(...decode(item.signature,tx,this.eventAuthority));
      }
      // Verify the entire candidate against one chain snapshot before advancing the
      // durable cursor. In particular, missing tail events must not strand it ahead
      // of an incomplete projection. Chain progress simply retries this batch.
      const candidate=structuredClone(row.state);
      for(const event of [...events].sort((a,b)=>BigInt(a.data.sequence)<BigInt(b.data.sequence)?-1:1))
        if(BigInt(event.data.sequence)>BigInt(row.state.sequence))project(candidate,event,row.binding.market,row.binding.domain);
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
  async reconcile(snapshot?: {state:State;binding:Binding}) {
    const {state,binding} = snapshot ?? await this.store.snapshot();
    const market = address(binding.market);
    const [registry] = await sdk.findRegistryPda({market});
    const [route] = await sdk.findRouteStatePda({market});
    const [vault] = await sdk.findVaultPda({market});
    const [resolution] = await sdk.findResolutionPda({market});
    const participants = Object.keys(state.participants), makers = Object.keys(state.makers);
    const keys = [market,registry,vault,...participants,...makers,...(state.risk ? [route] : []),...(state.resolution ? [resolution] : [])];
    const response = await this.rpc.call('getMultipleAccounts',[keys,{encoding:'base64',commitment:'finalized'}]);
    integer(response.context.slot);
    const data = (i:number, owner:string = PROGRAM) => {
      const a = response.value[i]; if (!a || a.owner !== owner) throw new Error('Reconciliation account missing/wrong owner');
      return Buffer.from(a.data[0],'base64');
    };
    const chain = sdk.getMarketStateDecoder().decode(data(0));
    if (chain.sequence !== BigInt(state.sequence)) throw new Error('Reconciliation sequence differs; backfill required');
    const m = state.market;
    assert.equal(Buffer.from(chain.domain).toString('hex'),binding.domain);
    for (const key of ['termsEpoch','configEpoch','totalCash','settlement','insurance','fees','allocatedVault','paused','mode','fundingIndexScaled','fundingTime'] as const)
      assert.equal(String(chain[key]),String(m[key]),`Market ${key}`);
    const reg = sdk.getParticipantRegistryDecoder().decode(data(1));
    assert.equal(reg.count,participants.length);
    assert.deepEqual(reg.members,[...participants].sort((a,b)=>state.participants[a].id-state.participants[b].id));
    participants.forEach((key,i) => {
      const p = sdk.getParticipantDecoder().decode(data(3+i));
      assert.equal(p.market,market); assert.equal(p.schemaVersion,1);
      for (const [field,value] of Object.entries(state.participants[key])) assert.deepEqual(JSON.parse(json((p as any)[field])),JSON.parse(json(value)),`Participant ${field}`);
    });
    const token = data(2,'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    assert.equal(token.length,165); const actualVault=token.readBigUInt64LE(64);
    assert(actualVault >= chain.allocatedVault,'Vault deficit');
    makers.forEach((key,i) => {
      const maker = sdk.getMakerRegistrationDecoder().decode(data(3+participants.length+i));
      for (const [field,value] of Object.entries(state.makers[key])) assert.equal(json((maker as any)[field]),json(value),`Maker ${field}`);
    });
    if (state.risk) {
      const risk = sdk.getTestRouteStateDecoder().decode(data(keys.indexOf(route)));
      for (const key of ['observationSequence','referencePrice','lower','upper','validFrom','validUntil'] as const) assert.equal(String(risk[key]),state.risk[key],`Risk ${key}`);
      assert.equal(String(risk.grossLots),m.grossLots);
      if(m.mode>=2) assert.deepEqual(JSON.parse(json(risk.oracle)),state.risk.oracle,'Oracle/funding state');
    }
    if(state.resolution){
      const value=sdk.getResolutionStateDecoder().decode(data(keys.indexOf(resolution)));
      assert.equal(value.version,1);assert.equal(value.market,market);
      assert.deepEqual(JSON.parse(json({header:value.header,rows:value.rows})),state.resolution,'Resolution ledger');
    }
    return {slot:response.context.slot.toString(),sequence:state.sequence,actualVault:actualVault.toString(),allocatedVault:chain.allocatedVault.toString(),unallocatedSurplus:(actualVault-chain.allocatedVault).toString(),participants:participants.length};
  }
  async close() { this.healthy = false; this.ws?.close(); await this.store.close(); }
}
