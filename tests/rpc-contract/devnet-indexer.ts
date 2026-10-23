import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Indexer } from '../../packages/indexer/src/index.js';
import { api as indexApi } from '../../packages/indexer/src/api.js';
import { api as serviceApi } from '../../packages/services/src/api.js';
import { Runtime } from '../../packages/services/src/runtime.js';
import { configuration } from './devnet-preflight-support.js';
import { persist } from './devnet-rpc.js';

// Read-only chain acceptance: actual finalized RPC/WS -> fresh PostgreSQL -> HTTP.
// No private signer, injected event/projection, source wait or transaction submit.
const config = configuration(process.env);
const directory = process.env.RIVALT_RUN_DIR!;
assert(directory && process.env.RIVALT_DATABASE_URL);
const deployment = JSON.parse(readFileSync('ops/devnet-deployment.json', 'utf8'));
const report: Record<string, any> = { startedUtc: new Date().toISOString(), signed: false,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '', a19Complete: false };
const market = deployment.market;
const anchor = deployment.initializationSignature;
const runId = 'p14-devnet-' + directory.split('/').at(-1);
const indexer = new Indexer({ chain: 'solana:devnet', rpcUrl: config.rpc, wsUrl: config.ws,
  databaseUrl: process.env.RIVALT_DATABASE_URL!, runId, market, anchor });
const runtime = new Runtime(process.env.RIVALT_DATABASE_URL!, runId, config.rpc, 'smoke', 2n, 0n, 'solana:devnet');
const read = indexApi(indexer), service = serviceApi(runtime);
let stage = 'fresh-postgres-backfill';
try {
  await indexer.open(); await indexer.cycle(); await runtime.open();
  const state = await indexer.store.snapshot(), snapshot = await runtime.snapshot();
  assert.equal(state.binding.program, runtime.deployment.clearing);
  assert.equal(snapshot.m.sequence.toString(), state.state.sequence);
  assert.equal(snapshot.actual, snapshot.m.allocatedVault);
  report.binding = state.binding; report.state = state.state;
  report.vaultAtoms = snapshot.actual.toString(); report.sourceMode = snapshot.sourceMode;
  report.metrics = { ...indexer.metrics };
  stage = 'actual-http-views';
  await read.listen({ host: '127.0.0.1', port: 18090 });
  await service.listen({ host: '127.0.0.1', port: 18091 });
  // Backfill may take longer than the normal readiness freshness budget; refresh
  // at the now-current checkpoint before asking for the bounded HTTP views.
  await indexer.cycle();
  const response = await fetch('http://127.0.0.1:18090/v1/trades?latest=true&limit=10');
  assert.equal(response.status, 200); const trades = await response.json();
  const trade = { signature: deployment.openingTradeSignature };
  assert(trades.items.some((t: any) => t.signature === trade.signature && t.payload.fee === deployment.openingTradeFeeAtoms));
  assert.equal(trades.capabilities.routes, 'devnet-test-profile');
  const ready = await fetch('http://127.0.0.1:18091/ready'); assert.equal(ready.status, 200);
  report.http = { trades, serviceReady: await ready.json() };
  report.sql = (await indexer.store.pool.query(`SELECT
    (SELECT count(*)::text FROM transactions WHERE run_id=$1) AS transactions,
    (SELECT count(*)::text FROM events WHERE run_id=$1) AS events,
    (SELECT count(*)::text FROM jobs WHERE run_id=$1 AND status IN ('pending','unresolved')) AS unresolved`, [runId])).rows[0];
  assert.equal(report.sql.unresolved, '0');
  report.result = 'pass';
} catch {
  report.result = 'fail'; report.failedStage = stage; process.exitCode = 1;
} finally {
  report.finishedUtc = new Date().toISOString();
  await service.close(); await read.close(); await runtime.close(); await indexer.close();
  persist(`${directory}/indexer-report.json`, report);
  console.log(JSON.stringify({ result: report.result, failedStage: report.failedStage, report: `${directory}/indexer-report.json`, a19Complete: false }));
}
