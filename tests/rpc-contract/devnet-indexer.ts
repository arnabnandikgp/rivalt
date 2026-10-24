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
  assert(snapshot.actual >= snapshot.m.allocatedVault, 'Vault deficit');
  report.binding = state.binding; report.state = state.state;
  report.vaultAtoms = snapshot.actual.toString();
  report.allocatedVaultAtoms = snapshot.m.allocatedVault.toString();
  report.vaultSurplusAtoms = (snapshot.actual - snapshot.m.allocatedVault).toString();
  report.sourceMode = snapshot.sourceMode;
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
  // Optional narrow post-upgrade acceptance, with exact signatures from this
  // run. The runtime itself continues to load only ops/deployment configuration.
  if (process.env.RIVALT_MAKER_ROLLOUT_REPORT) {
    stage = 'maker-rollout-reconciliation';
    const rollout = JSON.parse(readFileSync(process.env.RIVALT_MAKER_ROLLOUT_REPORT, 'utf8'));
    assert.equal(rollout.result, 'pass'); assert.equal(rollout.market, market);
    const current = await indexer.store.snapshot();
    const registrationChecks = [];
    for (const [index, maker] of rollout.makers.entries()) {
      const program = rollout.programs.find((item: any) => item.name === (index === 0 ? 'maker_a' : 'maker_b'));
      assert.equal(current.state.makers[maker.registration].approvedHash, program.accountSha256);
      const check = rollout.checks.find((item: any) => item.label === `maker-${index}-jointly-approve`);
      const rows = (await indexer.store.pool.query('SELECT kind,payload FROM events WHERE run_id=$1 AND signature=$2', [runId, check.signature])).rows;
      assert.equal(rows.length, 1); assert.equal(rows[0].kind, 'maker');
      assert.equal(rows[0].payload.kind, 1); assert.equal(rows[0].payload.approvedHash, program.accountSha256);
      registrationChecks.push({ registration: maker.registration, signature: check.signature, approvedHash: program.accountSha256 });
      const rejected = rollout.checks.find((item: any) => item.label === `maker-${index}-reject-unapproved-upgrade`);
      const failed = (await indexer.store.pool.query('SELECT failed FROM transactions WHERE run_id=$1 AND signature=$2', [runId, rejected.signature])).rows;
      assert.deepEqual(failed, [{ failed: true }]);
      assert.equal((await indexer.store.pool.query('SELECT count(*)::text AS count FROM events WHERE run_id=$1 AND signature=$2', [runId, rejected.signature])).rows[0].count, '0');
    }
    assert.equal(current.state.participants[rollout.capital].owner, rollout.owner);
    assert.equal(current.state.participants[rollout.capital].cash, '0');
    if (process.env.RIVALT_MAKER_OWNERSHIP_REPORT) {
      const ownership = JSON.parse(readFileSync(process.env.RIVALT_MAKER_OWNERSHIP_REPORT, 'utf8'));
      assert.equal(ownership.result, 'pass'); assert.equal(ownership.market, market);
      assert.equal(current.state.participants[ownership.capital].owner, ownership.owner);
      assert.equal(current.state.participants[ownership.capital].cash, '0');
      const registration = ownership.checks.find((item: any) => item.label === 'register-test-participant');
      const rows = (await indexer.store.pool.query('SELECT kind,payload FROM events WHERE run_id=$1 AND signature=$2', [runId, registration.signature])).rows;
      assert.equal(rows.length, 1); assert.equal(rows[0].kind, 'custody');
      assert.equal(rows[0].payload.participant, ownership.capital);
      report.correctedOwnershipParticipant = ownership.capital;
    }
    const response = await fetch('http://127.0.0.1:18090/v1/market');
    assert.equal(response.status, 200);
    const view = await response.json();
    for (const check of registrationChecks) assert.equal(view.makers[check.registration].approvedHash, check.approvedHash);
    report.makerRollout = { report: process.env.RIVALT_MAKER_ROLLOUT_REPORT, registrations: registrationChecks,
      rejectedUpgradesRetainedWithoutEvents: 2, participant: rollout.capital, httpHashesMatch: true };
  }
  report.result = 'pass';
} catch {
  report.result = 'fail'; report.failedStage = stage; process.exitCode = 1;
} finally {
  report.finishedUtc = new Date().toISOString();
  await service.close(); await read.close(); await runtime.close(); await indexer.close();
  persist(`${directory}/indexer-report.json`, report);
  console.log(JSON.stringify({ result: report.result, failedStage: report.failedStage, report: `${directory}/indexer-report.json`, a19Complete: false }));
}
