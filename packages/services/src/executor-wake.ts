import type {Pool} from 'pg';

// Notifications only reduce scheduling delay. The durable queue and its periodic
// scan remain authoritative after missed notifications, restarts or disconnects.
export class WakeSignal {
  version = 0;
  private waiting?: () => void;
  notify() { this.version++; this.waiting?.(); }
  wait(observed: number, milliseconds = 250) {
    if (observed !== this.version) return Promise.resolve();
    return new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); this.waiting = undefined; resolve(); };
      const timer = setTimeout(finish, milliseconds);
      this.waiting = finish;
    });
  }
}
async function acquire(pool: Pool) { return pool.connect(); }
export class ExecutorWake extends WakeSignal {
  private client?: Awaited<ReturnType<typeof acquire>>;
  constructor(private pool: Pool, private runId: string) { super(); }
  async connect() {
    if (this.client) return;
    const client = await this.pool.connect();
    client.on('notification', message => { if (message.channel === 'rivalt_intents' && message.payload === this.runId) this.notify(); });
    client.on('error', () => {
      if (this.client === client) { this.client = undefined; client.release(true); this.notify(); }
    });
    this.client = client;
    try { await client.query('LISTEN rivalt_intents'); }
    catch (error) { if (this.client === client) { this.client = undefined; client.release(true); } throw error; }
  }
  async close() {
    const client = this.client; this.client = undefined; this.notify();
    if (client) { try { await client.query('UNLISTEN rivalt_intents'); } finally { client.release(); } }
  }
}
