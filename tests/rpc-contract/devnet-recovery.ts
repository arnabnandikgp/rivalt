import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { getBase58Decoder } from '@solana/kit';
import { getMintToInstruction } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { Indexer } from '../../packages/indexer/src/index.js';
import { api as serviceApi } from '../../packages/services/src/api.js';
import { Runtime } from '../../packages/services/src/runtime.js';
import { devnetContext } from './devnet-context.js';
import { DevnetRpc, persist } from './devnet-rpc.js';

// One actual deposit across a deliberately disconnected WS and discarded RPC
// acknowledgement. The fault adapter forwards to the real provider before
// throwing; it never fabricates a chain result, signature, event or SQL balance.
const directory = process.env.RIVALT_RUN_DIR!;
assert(directory && process.env.RIVALT_DATABASE_URL);
const a = await devnetContext(), h = new DevnetRpc(a, `${directory}/journal`);
const deployment = JSON.parse(readFileSync('ops/devnet-deployment.json', 'utf8'));
const runId = 'p14-recovery-' + directory.split('/').at(-1);
const config = { chain: 'solana:devnet' as const, rpcUrl: h.config.rpc, wsUrl: h.config.ws,
  databaseUrl: process.env.RIVALT_DATABASE_URL!, runId, market: a.market,
  anchor: deployment.initializationSignature };
let indexer = new Indexer(config);
let runtime = new Runtime(config.databaseUrl, runId, h.config.rpc, 'smoke', 2n, 0n, 'solana:devnet');
let app = serviceApi(runtime);
const amount = 1000n, requestId = 'p14-recovery-deposit';
const report: Record<string, any> = { startedUtc: new Date().toISOString(), a19Complete: false,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
  program: a.program, market: a.market, participant: a.trader, token: a.traderToken.address,
  amount: amount.toString(), requestId, fault: 'Deliberate WS disconnect and discarded actual sendTransaction acknowledgement' };
let stage = 'preflight';
async function rawState() {
  return h.rpc.call('getMultipleAccounts', [[a.market, a.trader, a.vault, a.traderToken.address], { encoding: 'base64', commitment: 'finalized' }]);
}
async function post() {
  const response = await fetch('http://127.0.0.1:18091/v1/submit', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId, wire: report.wire }) });
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.signature, report.signature); return result;
}
try {
  // Resumption must use this run's retained SQL directory and exact signed wire.
  // Do not mint/sign another deposit under a fresh run to hide an unknown result.
  assert(!existsSync(`${directory}/signed-deposit.json`), 'Existing signed run: recover its original SQL/wire before creating another run');
  await h.open(); await indexer.open(); await indexer.cycle(); await runtime.open();
  await app.listen({ host: '127.0.0.1', port: 18091 });
  stage = 'provision-test-collateral';
  await h.send('mint-1000-test-atoms', [getMintToInstruction({ mint: a.mint.address, token: a.traderToken.address, mintAuthority: a.payer, amount })]);
  report.before = await rawState();
  const checkpoint = await indexer.store.snapshot(); report.checkpointBefore = checkpoint.checkpoint;
  assert(indexer.ws?.acknowledged); report.subscriptionAcknowledgedBefore = true;
  // Wait for the actual socket close before submitting the new economic action.
  const socket = indexer.ws.socket;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket did not close')), 5000);
    socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true });
    indexer.ws!.close();
  });
  report.socketClosedBeforeBroadcast = socket.readyState === WebSocket.CLOSED;
  assert(report.socketClosedBeforeBroadcast);
  stage = 'persist-wallet-intent';
  const ix = await sdk.getDepositInstructionAsync({ ...a, owner: a.traderOwner, participant: a.trader,
    quoteMint: a.mint.address, userToken: a.traderToken.address, amount }, a.options);
  const { transaction } = await sdk.signInstructions(runtime.connection, a.traderOwner, [ix]);
  report.signature = getBase58Decoder().decode(transaction.signatures[0]);
  report.wire = Buffer.from(transaction.serialize()).toString('base64');
  persist(`${directory}/signed-deposit.json`, { requestId, signature: report.signature, wire: report.wire });
  report.ingress = await post();
  const originalCall = runtime.rpc.call.bind(runtime.rpc);
  runtime.rpc.call = async (method: string, params: unknown[] = []) => {
    if (method !== 'sendTransaction') return originalCall(method, params);
    assert.equal(params[0], report.wire);
    report.broadcasts = (report.broadcasts ?? 0) + 1;
    const signature = await originalCall(method, params);
    assert.equal(signature, report.signature);
    report.actualAcknowledgementDiscarded = signature;
    throw new Error('P14 deliberately discarded the actual provider acknowledgement');
  };
  stage = 'lose-acknowledgement'; await runtime.queue.step(requestId);
  report.ambiguous = await runtime.queue.get(requestId);
  assert.equal(report.ambiguous.status, 'unresolved');
  assert.equal(report.actualAcknowledgementDiscarded, report.signature);
  assert.equal((await indexer.store.snapshot()).checkpoint, checkpoint.checkpoint);
  assert(!indexer.ws!.buffer.some(n => n.value.signature === report.signature));
  // Close all old service/SQL/WS handles; recover through new instances using the
  // durable SQL intent. No signer is used after this point.
  await app.close(); await runtime.close(); await indexer.close();
  stage = 'restart-original-intent';
  runtime = new Runtime(config.databaseUrl, runId, h.config.rpc, 'smoke', 2n, 0n, 'solana:devnet');
  await runtime.open(); app = serviceApi(runtime); await app.listen({ host: '127.0.0.1', port: 18091 });
  report.repeatedIngress = await post();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await runtime.queue.step(requestId); const intent = await runtime.queue.get(requestId);
    if (intent.status === 'finalized' || intent.status === 'failed') { report.recoveredIntent = intent; break; }
    await delay(500);
  }
  assert.equal(report.recoveredIntent?.status, 'finalized');
  report.history = await h.rpc.call('getTransaction', [report.signature, { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
  const fetched = await h.rpc.call('getTransaction', [report.signature, { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
  assert.equal(fetched.transaction[0], report.wire); assert.equal(report.history.meta.err, null);
  report.fetchedWire = fetched.transaction[0];
  stage = 'reconnect-and-backfill'; indexer = new Indexer(config); await indexer.open();
  assert(indexer.ws?.acknowledged); report.subscriptionAcknowledgedAfter = true;
  await indexer.cycle(); await indexer.cycle();
  report.after = await rawState(); report.projection = (await indexer.store.snapshot()).state;
  report.sql = (await indexer.store.pool.query(`SELECT
    (SELECT count(*)::text FROM service_intents WHERE run_id=$1 AND signature=$2) AS intents,
    (SELECT count(*)::text FROM transactions WHERE run_id=$1 AND signature=$2 AND NOT failed) AS transactions,
    (SELECT count(*)::text FROM events WHERE run_id=$1 AND signature=$2) AS events,
    (SELECT count(*)::text FROM outbox WHERE run_id=$1 AND payload->>'signature'=$2) AS outbox,
    (SELECT count(*)::text FROM observations WHERE run_id=$1 AND signature=$2 AND source='ws-confirmed') AS websocket,
    (SELECT count(*)::text FROM jobs WHERE run_id=$1 AND status IN ('pending','unresolved')) AS unresolved`, [runId, report.signature])).rows[0];
  assert.equal(report.sql.intents, '1'); assert.equal(report.sql.transactions, '1'); assert.equal(report.sql.events, '1'); assert.equal(report.sql.outbox, '1');
  assert.equal(report.sql.websocket, '0'); assert.equal(report.sql.unresolved, '0');
  const before = sdk.getParticipantDecoder().decode(Buffer.from(report.before.value[1].data[0], 'base64'));
  const after = sdk.getParticipantDecoder().decode(Buffer.from(report.after.value[1].data[0], 'base64'));
  assert.equal(after.cash, before.cash + amount); assert.equal(after.lots, before.lots);
  assert.equal(after.virtualScaled, before.virtualScaled); assert.equal(report.projection.participants[a.trader].cash, after.cash.toString());
  report.metrics = indexer.metrics; report.result = 'pass';
} catch (error) {
  report.result = 'fail'; report.failedStage = stage;
  // Assertions contain only our labels/values; provider URLs never enter output.
  report.failure = error instanceof assert.AssertionError ? error.message : 'Bounded runtime operation failed; retained journal requires inspection';
  process.exitCode = 1;
} finally {
  report.finishedUtc = new Date().toISOString();
  await app.close().catch(() => {}); await runtime.close().catch(() => {}); await indexer.close().catch(() => {});
  persist(`${directory}/recovery-report.json`, report);
  console.log(JSON.stringify({ result: report.result, failedStage: report.failedStage, report: `${directory}/recovery-report.json`, a19Complete: false }));
}
