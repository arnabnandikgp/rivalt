import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

// Raw standard JSON-RPC is intentionally independent of the application's Connection.
export class WireRpc {
  private id = 0;
  constructor(readonly url: string) {}
  async call(method: string, params: unknown[] = []): Promise<any> {
    const id = ++this.id;
    const response = await fetch(this.url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.id, id);
    if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
    return body.result;
  }
}

export async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export class WireSubscriptions {
  private id = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  readonly notifications: any[] = [];
  readonly socket: WebSocket;
  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending?.reject(new Error(JSON.stringify(message.error)));
        else pending?.resolve(message.result);
      } else {
        this.notifications.push(message);
      }
    });
    this.socket.addEventListener('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('WebSocket closed'));
      this.pending.clear();
    });
  }
  async ready() {
    await eventually(async () => this.socket.readyState, state => state === WebSocket.OPEN, 'WS open');
  }
  async call(method: string, params: unknown[] = []): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`WS timeout: ${method}`)); }, 15_000);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timeout); resolve(value); },
        reject: error => { clearTimeout(timeout); reject(error); },
      });
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }
  async notification(subscription: number) {
    return eventually(async () => this.notifications.find(n => n.params?.subscription === subscription),
      value => Boolean(value), `notification for subscription ${subscription}`);
  }
  close() { this.socket.close(); }
}
