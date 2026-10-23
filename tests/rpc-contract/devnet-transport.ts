import { Rpc } from '../../packages/indexer/src/rpc.js';

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// Only this bounded acceptance client is paced. Financial validity never depends
// on the delay, and callers still reconcile the original signed transaction.
export class DevnetTransport {
  private nextRequest = 0;
  readonly interruptions: Array<{ method: string; attempt: number; backoffMs: number }> = [];
  constructor(private readonly upstream: Pick<Rpc, 'call'>) {}
  async call(method: string, params: unknown[] = []): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      await delay(Math.max(0, this.nextRequest - Date.now()));
      this.nextRequest = Date.now() + 200;
      try { return await this.upstream.call(method, params); }
      catch (error) {
        // A transport timeout is ambiguous, especially for sendTransaction.
        // Only explicit rate rejection retries; the exact params remain intact.
        if (!(error instanceof Error) || error.message !== 'RPC HTTP 429' || attempt === 5) throw error;
        const backoffMs = 1000 * 2 ** attempt;
        this.interruptions.push({ method, attempt: attempt + 1, backoffMs });
        this.nextRequest = Date.now() + backoffMs;
      }
    }
  }
}
