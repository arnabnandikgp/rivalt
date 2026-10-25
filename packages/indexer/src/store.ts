import { readFileSync } from 'node:fs';
import pg, { type PoolClient } from 'pg';
import { empty, project, type State } from './projection.js';
import { hash, json, type Event, type JournalEvent } from './events.js';

export type JournalBinding = { genesis: string; domain: string; anchor: string; anchorHash: string; program: string; schema: number };
export type Binding = JournalBinding & {market: string; schema: 1};
export type Projection<State, Binding, Event> = {
  schema: number;
  empty(): State;
  project(state: State, event: Event, binding: Binding): void;
};
/** One journal implementation, with an explicit immutable protocol version.
 * SQL schema 1 is the journal format; binding.schema selects protocol accounts. */
export class JournalStore<State extends {sequence: string}, Binding extends JournalBinding, Event extends JournalEvent> {
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
  async commit(transactions: { signature: string; tx: any }[], events: Event[], head: { signature: string; slot: number } | null, expectedCheckpoint: string | null) {
    if (!this.lease) throw new Error('Indexer lease lost');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query('SELECT * FROM runs WHERE run_id=$1 FOR UPDATE', [this.runId])).rows[0];
      if (row.binding.schema !== this.projection.schema) throw new Error('Incompatible projection schema');
      if (row.checkpoint !== expectedCheckpoint) throw new Error('Concurrent checkpoint change');
      const state: State = row.state;
      for (const { signature, tx } of transactions) {
        await client.query('INSERT INTO transactions(run_id,signature,slot,failed,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
          [this.runId, signature, tx.slot, tx.meta.err !== null, json(tx)]);
        await client.query(`INSERT INTO jobs(run_id,signature,status) VALUES($1,$2,$3) ON CONFLICT (run_id,signature) DO UPDATE SET status=EXCLUDED.status`,
          [this.runId, signature, tx.meta.err === null ? 'finalized' : 'failed']);
      }
      for (const event of [...events].sort((a, b) => BigInt(a.data.sequence) < BigInt(b.data.sequence) ? -1 : 1)) {
        const result = await client.query(`INSERT INTO events(run_id,signature,outer_index,inner_index,ordinal,sequence,kind,payload,bytes,slot,block_time)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (run_id,signature,outer_index,inner_index,ordinal) DO NOTHING`,
          [this.runId,event.signature,event.outer,event.inner,event.ordinal,event.data.sequence,event.type,json(event.data),event.bytes,event.slot,event.blockTime]);
        if (result.rowCount === 0) {
          const old = (await client.query('SELECT bytes FROM events WHERE run_id=$1 AND signature=$2 AND outer_index=$3 AND inner_index=$4 AND ordinal=$5',
            [this.runId,event.signature,event.outer,event.inner,event.ordinal])).rows[0];
          if (old.bytes !== event.bytes) throw new Error('Conflicting finalized event');
          continue;
        }
        this.projection.project(state, event, row.binding);
        await client.query('INSERT INTO outbox VALUES($1,$2,$3)', [this.runId,event.data.sequence,json(event)]);
      }
      await client.query('UPDATE runs SET state=$2,checkpoint=COALESCE($3,checkpoint),checkpoint_slot=COALESCE($4,checkpoint_slot),synced_at=NULL,error=NULL WHERE run_id=$1',
        [this.runId,json(state),head?.signature ?? null,head?.slot ?? null]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
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
export class Store extends JournalStore<State, Binding, Event> {
  constructor(url: string, runId: string) {
    super(url, runId, {schema:1, empty, project:(state, event, binding) => project(state, event, binding.market, binding.domain)});
  }
}
const hashSorted = (v: Record<string, unknown>) => hash(Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b))));
