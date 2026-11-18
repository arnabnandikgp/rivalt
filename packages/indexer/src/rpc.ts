export class Rpc {
  private id = 0;
  readonly metrics={requests:0,responseBytes:0,peakResponseBytes:0};
  constructor(readonly url: string,readonly maxResponseBytes=64*1024*1024) {
    if(!Number.isSafeInteger(maxResponseBytes)||maxResponseBytes<1)throw new Error('Invalid RPC response byte budget');
  }
  async call(method: string, params: unknown[] = []): Promise<any> {
    const id = ++this.id;this.metrics.requests++;
    const response = await fetch(this.url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    // Bound each in-flight body before JSON decoding; never buffer the entire
    // historical backlog. An oversized block remains retryable with an explicit
    // larger operator budget, never silently skipped or marked covered.
    const reader=response.body?.getReader();if(!reader)throw new Error('Missing RPC response body');
    const parts:Uint8Array[]=[];let bytes=0;
    try {
      for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;
        if(bytes>this.maxResponseBytes)throw new Error('RPC response exceeds byte budget');parts.push(part.value);}
    }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
    this.metrics.responseBytes+=bytes;this.metrics.peakResponseBytes=Math.max(this.metrics.peakResponseBytes,bytes);
    const body = JSON.parse(Buffer.concat(parts,bytes).toString('utf8'));
    if (body.id !== id || body.error || !('result' in body)) throw new Error(`RPC ${method} failed`);
    return body.result;
  }
}

export function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Unsafe RPC integer');
  return value;
}

// Notifications are hints, never financial authority. Subscribe before backfill.
export class Subscription {
  readonly socket: WebSocket;
  readonly ready: Promise<void>;
  readonly buffer: any[] = [];
  error: Error | null = null;
  acknowledged = false;
  constructor(url: string, program: string) {
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('WS subscription timeout')); this.close(); }, 10_000);
      const fail = (error: Error) => { this.error = error; clearTimeout(timer); reject(error); };
      this.socket.addEventListener('open', () => this.socket.send(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [program] }, { commitment: 'confirmed' }],
      })));
      this.socket.addEventListener('message', ({ data }) => {
        try {
          const message = JSON.parse(String(data));
          if (message.id === 1) {
            if (message.error || !Number.isSafeInteger(message.result)) throw new Error('WS subscription rejected');
            this.acknowledged = true; clearTimeout(timer); resolve();
          } else if (message.method === 'logsNotification') {
            if (this.buffer.length >= 5000) throw new Error('WS buffer overflow; history recovery required');
            this.buffer.push(message.params.result);
          }
        } catch (error) { fail(error as Error); this.close(); }
      });
      this.socket.addEventListener('error', () => fail(new Error('WS connection error')));
      this.socket.addEventListener('close', () => fail(new Error('WS disconnected')));
    });
  }
  close() { this.socket.close(); }
}

export type AccountBatch = (keys:string[]) => Promise<{context:{slot:number};value:({owner:string;data:[string,string]}|null)[]}>;
