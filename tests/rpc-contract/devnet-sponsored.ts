import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { checkedGenesis, configuration, unsigned } from './devnet-preflight-support.js';
import { coreEligibility, decodeCore, sponsoredFeeds } from './pyth-core.js';

// Three real minutes of read-only RPC/WS observation, not a soak or A18 acceptance.
const directory = `.local/devnet/sponsored/${new Date().toISOString().replaceAll(':', '-')}`;
mkdirSync(directory, { recursive: true });
const encode = (v: unknown) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x, 2) + '\n';
const save = (name: string, v: unknown) => writeFileSync(`${directory}/${name}.json`, encode(v));
const report: Record<string, unknown> = {
  kind: 'read-only-sponsored-core-observation', startedUtc: new Date().toISOString(),
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
  a18Complete: false, rivaltDeployed: false,
};
let stage = 'configuration', id = 0, socket: WebSocket | undefined;
const notifications: unknown[] = [], samples: unknown[] = [];
let wsFailure = false;
try {
  const config = configuration(process.env); report.endpoint = config.endpointLabel;
  async function rpc(method: string, params: unknown[] = []) {
    const requestId = ++id;
    const response = await fetch(config.rpc, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('RPC HTTP failure');
    const b = await response.json();
    if (b.id !== requestId || b.error || !('result' in b)) throw new Error('RPC result failure');
    return b.result;
  }
  stage = 'genesis'; report.genesis = checkedGenesis(await rpc('getGenesisHash'));
  const feeds = await sponsoredFeeds(); report.feeds = feeds;
  stage = 'websocket';
  socket = new WebSocket(config.ws);
  const subscriptions = new Map<number, number>();
  socket.addEventListener('error', () => { wsFailure = true; });
  socket.addEventListener('message', ({ data }) => {
    try {
      const msg = JSON.parse(String(data));
      if (msg.error) { wsFailure = true; return; }
      if (Number.isSafeInteger(msg.id) && msg.id >= 1 && msg.id <= feeds.length) {
        unsigned(msg.result); subscriptions.set(msg.result, msg.id - 1);
      } else if (msg.method === 'accountNotification' && subscriptions.has(msg.params.subscription)) {
        const index = subscriptions.get(msg.params.subscription)!;
        const raw = msg.params.result;
        const decoded = decodeCore(raw.value, feeds[index]);
        notifications.push({ receivedUtc: new Date().toISOString(), index, slot: unsigned(raw.context.slot), decoded, raw });
      }
    } catch { wsFailure = true; }
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WS connection timeout')), 12_000);
    socket!.addEventListener('open', () => {
      clearTimeout(timeout);
      feeds.forEach((feed, i) => socket!.send(JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'accountSubscribe', params: [feed.account, { encoding: 'base64', commitment: 'confirmed' }] })));
      resolve();
    }, { once: true });
  });
  stage = 'account-observations';
  const start = performance.now();
  // No synthesized prices, transaction submission, fees or persistent background worker.
  for (let i = 0; i <= 36; i++) {
    if (i > 0) await delay(Math.max(0, start + i * 5_000 - performance.now()));
    for (const commitment of ['confirmed', 'finalized']) {
      const raw = await rpc('getMultipleAccounts', [[...feeds.map(f => f.account), 'SysvarC1ock11111111111111111111111111111111'], { encoding: 'base64', commitment }]);
      if (raw.value?.length !== 5) throw new Error('Account batch shape');
      const clock = raw.value[4];
      if (!clock || clock.owner !== 'Sysvar1111111111111111111111111111111111111' || clock.data[1] !== 'base64') throw new Error('Clock identity');
      const clockBytes = Buffer.from(clock.data[0], 'base64');
      if (clockBytes.length !== 40) throw new Error('Clock shape');
      const now = clockBytes.readBigInt64LE(32);
      const prices = feeds.map((feed, j) => {
        const decoded = decodeCore(raw.value[j], feed);
        if (decoded.postedSlot > BigInt(unsigned(raw.context.slot))) throw new Error('Price context mismatch');
        return { feed: `${feed.name}/${feed.feed}`, ...decoded, ...coreEligibility(decoded, now, feed.feed === 'collateral') };
      });
      samples.push({ observedUtc: new Date().toISOString(), commitment, chainTime: now, slot: unsigned(raw.context.slot), prices, raw });
    }
    save('samples', samples); save('notifications', notifications);
  }
  report.elapsedMilliseconds = Math.round(performance.now() - start).toString();
  report.wsSubscriptions = subscriptions.size.toString(); report.wsNotifications = notifications.length.toString();
  if (wsFailure || subscriptions.size !== feeds.length) throw new Error('WS subscription integrity');
  report.result = 'observed';
} catch {
  report.result = 'fail'; report.failedStage = stage; process.exitCode = 1;
} finally {
  socket?.close(); report.finishedUtc = new Date().toISOString();
  save('samples', samples); save('notifications', notifications); save('report', report);
  console.log(encode({ result: report.result, failedStage: report.failedStage, directory, a18Complete: false }));
}
