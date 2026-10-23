import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { Indexer } from '../../packages/indexer/src/index.js';
import { api as readApi } from '../../packages/indexer/src/api.js';
import { api as serviceApi } from '../../packages/services/src/api.js';
import { Runtime } from '../../packages/services/src/runtime.js';
import { configuration } from './devnet-preflight-support.js';
import { persist } from './devnet-rpc.js';

// Interactive test UI services only: no private signer or automated financial
// intent. The executor relays only already wallet-signed, durable submissions.
const directory = process.env.RIVALT_RUN_DIR!;
assert(directory && process.env.RIVALT_DATABASE_URL);
const provider = configuration(process.env);
const original = JSON.parse(readFileSync('docs/evidence/p13/acceptance/final-bundle.json', 'utf8')).files;
const m = original['report.json'].independentRoute.after.market;
const market = original['report.json'].independentRoute.after.trader.market;
const anchor = original['journal/initialize-market.json'].signature;
const runId = 'p14-demo-' + directory.split('/').at(-1);
const indexer = new Indexer({ chain: 'solana:devnet', rpcUrl: provider.rpc, wsUrl: provider.ws,
  databaseUrl: process.env.RIVALT_DATABASE_URL!, runId, market, anchor });
const runtime = new Runtime(process.env.RIVALT_DATABASE_URL!, runId, provider.rpc, 'smoke', 2n, 0n, 'solana:devnet');
const read = readApi(indexer), service = serviceApi(runtime);
let stopping = false;
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => { stopping = true; });
const deadline = Date.now() + 3_600_000;
try {
  await indexer.open(); await indexer.cycle(); await runtime.open();
  await read.listen({ host: '127.0.0.1', port: 18090 });
  await service.listen({ host: '127.0.0.1', port: 18091 });
  const config = { version: 1, chain: 'solana:devnet', rpcUrl: 'https://api.devnet.solana.com',
    wsUrl: 'wss://api.devnet.solana.com', genesis: indexer.deployment.genesis, anchor, market, mint: m.quoteMint, domain: m.domain };
  persist(`${directory}/trader-config.json`, config);
  writeFileSync(`${directory}/ready`, 'ready\n', { mode: 0o600 });
  console.log(JSON.stringify({ ready: true, url: 'http://127.0.0.1:18088', chain: config.chain, runId, signerLoaded: false }));
  const indexing = async () => {
    while (!stopping && Date.now() < deadline) {
      try { await indexer.cycle(); } catch { console.log(JSON.stringify({ role: 'indexer', status: 'recovery-required' })); }
      await delay(2000);
    }
  };
  const executor = async () => {
    while (!stopping && Date.now() < deadline) {
      try { await runtime.execute(); } catch { console.log(JSON.stringify({ role: 'executor', status: 'original-intent-unresolved' })); }
      await delay(500);
    }
  };
  await Promise.all([indexing(), executor()]);
} finally {
  await service.close(); await read.close(); await runtime.close(); await indexer.close();
}
