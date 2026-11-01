import {isDeepStrictEqual} from 'node:util';
import {address,getProgramDerivedAddress} from '@solana/kit';
import {decodeAccountInvocations} from './account-events.js';
import { readFileSync } from 'node:fs';
import pg, { type PoolClient } from 'pg';
import {validateBlockChain,type FinalizedBlock,type BlockFence} from './finalized-block.js';
import type {ScopedInvocation} from './scoped-events.js';
import type {RevisionVector} from './scoped-history.js';
import { hash, json, type JournalEvent } from './events.js';

export type JournalBinding = { genesis: string; domain: string; anchor: string; anchorHash: string; program: string; schema: number; venue:string };
export type JournalInvocation<Event> = ScopedInvocation & {events:Event[]};
export type Projection<State, Binding, Event> = {
  schema: number;
  empty(): State;
  apply(state:State,invocations:readonly JournalInvocation<Event>[],binding:Binding):{state:State;invocations:JournalInvocation<Event>[]};
};
/** One journal implementation, with an explicit immutable protocol version.
 * SQL format 2 requires a fresh database; binding.schema selects protocol accounts. */
export class JournalStore<State extends {sequence:string;revisions:RevisionVector}, Binding extends JournalBinding, Event extends JournalEvent> {
  readonly pool: pg.Pool;
  private lease?: PoolClient;
  private closed = false;
  constructor(url: string, readonly runId: string, readonly projection: Projection<State, Binding, Event>) {
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(runId)) throw new Error('Invalid run identity');
    this.pool = new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 5000,
      statement_timeout: 15_000, idle_in_transaction_session_timeout: 15_000 });
    this.pool.on('error', () => { /* Request/cycle failures close readiness; never log credentials. */ });
  }
  async migrate() {
    const { rows } = await this.pool.query('SHOW server_version_num');
    if (rows[0].server_version_num !== '180006') throw new Error('PostgreSQL 18.6 required');
    await this.pool.query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  }
  async bind(binding: Binding) {
    if (binding.schema !== this.projection.schema) throw new Error('Incompatible projection schema');
    this.lease = await this.pool.connect();
    const lock = await this.lease.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [this.runId]);
    if (!lock.rows[0].locked) { this.lease.release(); this.lease = undefined; throw new Error('Run already has an indexer'); }
    this.lease.on('error', () => { const lost = this.lease; this.lease = undefined; lost?.release(true); });
    await this.pool.query('INSERT INTO runs(run_id,binding,state) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [this.runId, json(binding), json(this.projection.empty())]);
    const row = await this.snapshot();
    if (hashSorted(row.binding) !== hashSorted(binding)) throw new Error('Incompatible run binding');
  }
  async snapshot(): Promise<{ state: State; binding: Binding; checkpoint: string | null; checkpoint_slot: string | null; synced_at: Date | null; error: string | null }> {
    const { rows } = await this.pool.query('SELECT * FROM runs WHERE run_id=$1', [this.runId]);
    if (!rows[0]) throw new Error('Unknown run');
    if (rows[0].binding.schema !== this.projection.schema) throw new Error('Incompatible projection schema');
    return rows[0];
  }
  async observe(source: 'ws-confirmed' | 'rpc-finalized', signature: string, payload: any) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO observations(run_id,digest,signature,source,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [this.runId, hash({ source, signature, payload }), signature, source, json(payload)]);
      await client.query(`INSERT INTO jobs(run_id,signature,status) VALUES($1,$2,'pending') ON CONFLICT DO NOTHING`, [this.runId, signature]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async commit(blocks:FinalizedBlock[],invocations:JournalInvocation<Event>[],fence:BlockFence,expectedCheckpoint:string|null) {
    if(!this.lease)throw new Error('Indexer lease lost');
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row=(await client.query('SELECT * FROM runs WHERE run_id=$1 FOR UPDATE',[this.runId])).rows[0];
      if(row.binding.schema!==this.projection.schema)throw new Error('Incompatible projection schema');
      if(row.checkpoint!==expectedCheckpoint)throw new Error('Concurrent checkpoint change');
      const equal=(left:unknown,right:unknown)=>isDeepStrictEqual(JSON.parse(json(left)),JSON.parse(json(right)));
      // Recompute authenticated invocations from retained complete block bytes;
      // callers cannot supply invented financial data beside a valid footer.
      const [eventAuthority]=await getProgramDerivedAddress({programAddress:address(row.binding.program),seeds:[Buffer.from('__event_authority')]});
      const authenticated=blocks.flatMap(block=>block.transactions.flatMap(({signature,tx},index)=>{
        const keys=[...tx.transaction.message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
        return keys.includes(row.binding.program)?decodeAccountInvocations(signature,tx,index,{...row.binding,eventAuthority}):[];
      }));
      const identity=(value:ScopedInvocation)=>`${value.signature}/${value.outer}/${value.invocation}`;
      const canonical=new Map(authenticated.map(value=>[identity(value),value]));
      if(canonical.size!==authenticated.length||invocations.length!==canonical.size
        ||new Set(invocations.map(identity)).size!==invocations.length
        ||invocations.some(value=>!equal(value,canonical.get(identity(value))??null)))throw new Error('Conflicting authenticated invocation batch');
      const newBlocks:FinalizedBlock[]=[];
      for(const block of blocks) {
        if(row.checkpoint_slot!==null&&block.slot<=Number(row.checkpoint_slot)) {
          const old=(await client.query('SELECT * FROM blocks WHERE run_id=$1 AND slot=$2',[this.runId,block.slot])).rows[0];
          if(!old||old.blockhash!==block.blockhash||old.previous_blockhash!==block.previousBlockhash||Number(old.parent_slot)!==block.parentSlot
            ||old.signature_digest!==block.signatureDigest||!equal(old.signatures,block.signatures))throw new Error('Conflicting finalized block');
          for(const {signature,tx} of block.transactions) {
            const previous=(await client.query('SELECT payload FROM transactions WHERE run_id=$1 AND signature=$2',[this.runId,signature])).rows[0];
            if(!previous||!equal(previous.payload,tx))throw new Error('Conflicting finalized transaction');
          }
        } else newBlocks.push(block);
      }
      validateBlockChain(newBlocks,row.checkpoint?{slot:Number(row.checkpoint_slot),blockhash:row.checkpoint}:null,fence);
      const positions=new Map(newBlocks.flatMap(block=>block.transactions.map((entry,index)=>[entry.signature,{slot:block.slot,index,tx:entry.tx}] as const)));
      if(positions.size!==newBlocks.reduce((sum,block)=>sum+block.transactions.length,0))throw new Error('Duplicate finalized signature across blocks');
      if(!row.checkpoint&&(!positions.has(row.binding.anchor)||hash(positions.get(row.binding.anchor)!.tx.transaction)!==row.binding.anchorHash))
        throw new Error('Initialization anchor absent from first complete block batch');
      const pending=invocations.filter(value=>positions.has(value.signature));
      for(const invocation of pending) {
        const position=positions.get(invocation.signature)!;
        if(BigInt(position.slot)!==invocation.slot||position.index!==invocation.transactionIndex||position.tx.meta.err!==null)
          throw new Error('Envelope outside successful finalized block position');
      }
      const result=this.projection.apply(row.state,pending,row.binding);
      for(const block of newBlocks) {
        await client.query('INSERT INTO blocks VALUES($1,$2,$3,$4,$5,$6,$7)',
          [this.runId,block.slot,block.blockhash,block.parentSlot,block.previousBlockhash,block.signatureDigest,json(block.signatures)]);
        for(const [index,{signature,tx}] of block.transactions.entries()) {
          await client.query('INSERT INTO transactions(run_id,signature,slot,transaction_index,failed,payload) VALUES($1,$2,$3,$4,$5,$6)',
            [this.runId,signature,block.slot,index,tx.meta.err!==null,json(tx)]);
          await client.query(`INSERT INTO jobs(run_id,signature,status) VALUES($1,$2,$3) ON CONFLICT (run_id,signature) DO UPDATE SET status=EXCLUDED.status`,
            [this.runId,signature,tx.meta.err===null?'finalized':'failed']);
        }
      }
      let cursor=BigInt(row.state.sequence);
      for(const invocation of result.invocations) {
        await client.query('INSERT INTO envelopes VALUES($1,$2,$3,$4,$5,$6)',
          [this.runId,invocation.signature,invocation.outer,invocation.invocation,json(invocation),invocation.footerBytes]);
        for(const event of invocation.events) {
          const sequence=(++cursor).toString();
          await client.query(`INSERT INTO events(run_id,signature,outer_index,inner_index,invocation,ordinal,sequence,kind,payload,bytes,slot,block_time)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [this.runId,event.signature,event.outer,event.inner,invocation.invocation,event.ordinal,sequence,event.type,json(event.data),event.bytes,event.slot,event.blockTime]);
          // The cursor is assigned locally after causal ordering, never inserted
          // into the canonical on-chain payload or used as a completeness proof.
          await client.query('INSERT INTO outbox VALUES($1,$2,$3)',[this.runId,sequence,json({...event,cursor:sequence})]);
        }
      }
      if(result.state.sequence!==cursor.toString())throw new Error('Projection/outbox cursor mismatch');
      for(const [account,entity] of Object.entries(result.state.revisions))await client.query(`INSERT INTO entity_revisions VALUES($1,$2,$3,$4)
        ON CONFLICT(run_id,account) DO UPDATE SET kind=EXCLUDED.kind,revision=EXCLUDED.revision`,[this.runId,account,entity.kind,entity.revision]);
      await client.query('UPDATE runs SET state=$2,checkpoint=$3,checkpoint_slot=$4,synced_at=NULL,error=NULL WHERE run_id=$1',
        [this.runId,json(result.state),fence.blockhash,fence.slot]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async health(error: string | null) {
    await this.pool.query('UPDATE runs SET error=$2,synced_at=CASE WHEN $2::text IS NULL THEN now() ELSE NULL END WHERE run_id=$1', [this.runId,error]);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.lease) { await this.lease.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [this.runId]); this.lease.release(); this.lease = undefined; }
    await this.pool.end();
  }
}
const hashSorted = (v: Record<string, unknown>) => hash(Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b))));
