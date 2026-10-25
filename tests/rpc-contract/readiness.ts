import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, statfsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import * as sdk from '@rivalt/sdk';
import { Indexer } from '../../packages/indexer/src/index.js';
import { json } from '../../packages/indexer/src/events.js';
import { environment, wait } from '../load/environment.js';
import { submissionFault } from '../load/submission-fault.js';
import { availability } from '../load/availability.js';
import { distribution, type Attempt } from '../load/metrics.js';

const dir = process.env.RIVALT_RUN_DIR!, started = performance.now(), attempts: Attempt[] = [];
const manifest = { source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(),
  operatorClass: 'internal-reference', sources: 'signed-synthetic-fixtures', workload: 'quote diagnostics and one original-signature custody recovery; not trading load',
  artifactHashes: Object.fromEntries(['clearing', 'maker_a', 'maker_b', 'oracle_fixture'].map(name =>
    [name, createHash('sha256').update(readFileSync(`target/deploy/${name}.so`)).digest('hex')])) };
writeFileSync(`${dir}/manifest.json`, json(manifest));
let env: Awaited<ReturnType<typeof environment>> | undefined;
try {
  env = await environment({ makerKit: true }); const venue = env;
  const binding = await venue.runtime.environment(), actor = venue.actors[0];
  const client = new sdk.UserClient({ version: 1, chain: 'solana:localnet', rpcUrl: venue.url, wsUrl: venue.wsUrl,
    genesis: binding.genesis, anchor: binding.anchor, market: venue.a.market, mint: venue.setup.mint.address, domain: binding.domain });
  async function offer(phase: string, fault: boolean) {
    const row: Attempt = { id: `readiness:${attempts.length}`, phase, actor: 0, offeredAt: performance.now(), fault, status: 'offered', side: 0, lots: '1' };
    const before = performance.now();
    const response = await fetch('http://127.0.0.1:18081/v1/quote', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: json({ owner: actor.owner.address, side: 0, lots: '1' }), signal: AbortSignal.timeout(5000) });
    row.quoteMs = performance.now() - before;
    const quote = await response.json() as any;
    if (response.ok && quote.available) { row.status = 'quote-eligible'; row.eligible = true; }
    else {
      row.status = 'quote-unavailable'; row.code = quote.code ?? (response.ok ? 'unfilled-no-liquidity' : 'unknown-api-error');
      row.diagnostic = quote.diagnostic;
      if (quote.code) {
        assert.equal(quote.diagnostic?.snapshotCommitment, 'confirmed');
        for (const name of ['snapshotSlot', 'sequence', 'observation', 'chainTime', 'sampledAt', 'validFrom', 'validUntil'])
          assert(/^\d+$/.test(quote.diagnostic[name]), `Missing exact diagnostic ${name}`);
        assert(['Normal', 'Degraded', 'NoCredibleBounds'].includes(quote.diagnostic.sourceMode));
      }
    }
    attempts.push(row); writeFileSync(`${dir}/attempts.jsonl`, attempts.map(row => json(row)).join('\n') + '\n');
    return row;
  }
  for (let count = 0; count < 10; count++) { await offer('initial', false); await delay(500); }
  await wait(async () => (await venue.runtime.store.pool.query("SELECT count(*)::int AS count FROM observations WHERE run_id=$1 AND source='ws-confirmed'", [venue.runId])).rows[0].count,
    count => count > 0, 'actual live WS observation');
  console.log('Readiness: preserve source safeguards during a bounded publication outage');
  await venue.stop('funding'); venue.setSources(false);
  const outageStarted = performance.now();
  let restrictive: Attempt | undefined;
  while (performance.now() - outageStarted < 35_000) {
    restrictive = await offer('source-publication-outage', true);
    if (restrictive.diagnostic?.sourceMode === 'NoCredibleBounds') break;
    await delay(500);
  }
  assert.equal(restrictive?.status, 'quote-unavailable');
  assert(['source-unavailable', 'observation-expired', 'observation-not-confirmed'].includes(restrictive?.code ?? ''));
  assert.equal(restrictive?.diagnostic?.sourceMode, 'NoCredibleBounds');
  const sourceOutageMs = performance.now() - outageStarted;

  console.log('Readiness: indexer death plus original-signature executor/RPC recovery');
  const indexerChild = venue.children.get('indexer')!; indexerChild.kill('SIGKILL');
  await wait(async () => indexerChild.signalCode, code => code === 'SIGKILL', 'actual indexer death');
  await venue.stop('indexer');
  const incident = await submissionFault(venue);
  venue.setSources(true); venue.start('funding');
  const recoveryStarted = performance.now();
  await wait(async () => (await venue.runtime.snapshot()).sourceMode, mode => mode === 'Normal', 'unchanged source requalification');
  const sourceRecoveryMs = performance.now() - recoveryStarted;
  for (let count = 0; count < 10; count++) { await offer('recovered', false); await delay(500); }
  assert(attempts.some(row => row.eligible), 'At least one actual returned quote required');
  assert(attempts.some(row => row.phase === 'recovered' && row.eligible), 'Recovered quotes required');

  for (const role of ['maker-a', 'maker-b', 'funding', 'settlement']) await venue.stop(role);
  await venue.stopSources();
  await wait(async () => {
    await venue.runtime.execute();
    return Number((await venue.runtime.store.pool.query("SELECT count(*) FROM service_intents WHERE run_id=$1 AND status IN ('pending','unresolved')", [venue.runId])).rows[0].count);
  }, count => count === 0, 'all original service signatures resolved');
  await venue.stop('executor');
  const before = (await client.snapshot()).participants[actor.participant].cash;
  for (let page = 0; page < 10; page++) {
    const exit = await client.exitInstructions(await client.snapshot(), actor.owner.address, actor.token.address, 1n);
    await venue.send(exit.verificationOnly ? 'readiness complete-cohort proof' : 'readiness direct one-atom withdrawal', exit.instructions, [], actor.owner);
    if (!exit.verificationOnly) break;
    assert(page < 9);
  }
  assert.equal((await client.snapshot()).participants[actor.participant].cash, before - 1n);
  const primary = new Indexer(venue.config), replay = new Indexer({ ...venue.config, runId: venue.runId + '-replay' });
  let recovery: object;
  try {
    await primary.open(); await primary.cycle(); await primary.reconcile();
    await replay.open(); await replay.cycle(); await replay.reconcile();
    const state = (await primary.store.snapshot()).state;
    assert.deepEqual((await replay.store.snapshot()).state, state, 'Fresh RPC reconstruction equals recovered original projection');
    const observations = (await primary.store.pool.query('SELECT source,count(*)::text AS count FROM observations WHERE run_id=$1 GROUP BY source', [venue.runId])).rows;
    const pending = (await primary.store.pool.query("SELECT count(*)::int AS count FROM jobs WHERE run_id=$1 AND status IN ('pending','unresolved')", [venue.runId])).rows[0].count;
    assert.equal(pending, 0);
    const disk = statfsSync('.');
    recovery = { sequence: state.sequence, observations, unresolvedIndexerJobs: pending, primary: primary.metrics, freshReplay: replay.metrics,
      databaseBytes: (await primary.store.pool.query('SELECT pg_database_size(current_database())::text AS bytes')).rows[0].bytes,
      freeDiskBytes: String(disk.bavail * disk.bsize), driverMemory: process.memoryUsage(),
      resourceScope: 'Whole qualification database and end-of-run driver memory only; not peak RSS, host attribution or leak evidence' };
  } finally { await replay.close(); await primary.close(); }
  assert.equal(venue.sourceErrors.length, 0);
  const report = { status: 'pass', manifest, elapsedSeconds: (performance.now() - started) / 1000,
    sourceOutageMs, sourceRecoveryMs, incident, recovery, availability: availability(attempts),
    quoteLatencyMs: distribution(attempts.map(row => row.quoteMs!)),
    exit: { amountAtoms: '1', cashBefore: String(before), cashAfter: String(before - 1n), indexerWasOffline: true },
    limitations: ['No trade-load or endurance claim', 'Quote offers were deliberately unsigned', 'Internal makers and synthetic prices', 'Risk settings remain provisional'] };
  writeFileSync(`${dir}/report.json`, json(report));
  console.log(json({ status: 'pass', elapsedSeconds: report.elapsedSeconds, directory: dir }));
} catch (error) {
  writeFileSync(`${dir}/failure.json`, json({ status: 'fail', manifest, attempts, error: error instanceof Error ? error.stack : String(error) }));
  throw error;
} finally { await env?.close(); }
