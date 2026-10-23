import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { getBase58Decoder, type Instruction } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { Indexer } from '../../packages/indexer/src/index.js';
import { api as serviceApi } from '../../packages/services/src/api.js';
import { Runtime } from '../../packages/services/src/runtime.js';
import { decode } from '../../packages/indexer/src/events.js';
import { devnetContext, guardInstruction, profile, sampleInstruction } from './devnet-context.js';
import { DevnetRpc, persist } from './devnet-rpc.js';
import { coreEligibility, decodeCore, normalizeCore } from './pyth-core.js';

const directory = process.env.RIVALT_RUN_DIR!;
assert(directory && process.env.RIVALT_DATABASE_URL);
const a = await devnetContext(), h = new DevnetRpc(a, `${directory}/journal`);
assert.equal(profile.sourceMaxAgeSeconds, 30);
const original = JSON.parse(readFileSync('docs/evidence/p13/acceptance/final-bundle.json', 'utf8')).files;
const runId = 'p14-lifecycle-' + directory.split('/').at(-1);
const config = { chain: 'solana:devnet' as const, rpcUrl: h.config.rpc, wsUrl: h.config.ws,
  databaseUrl: process.env.RIVALT_DATABASE_URL!, runId, market: a.market, anchor: original['journal/initialize-market.json'].signature };
const indexer = new Indexer(config), runtime = new Runtime(config.databaseUrl, runId, h.config.rpc, 'smoke', 2n, 0n, 'solana:devnet');
const app = serviceApi(runtime);
const report: Record<string, any> = { startedUtc: new Date().toISOString(), a19Complete: false,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
  program: a.program, market: a.market, trader: a.trader, makers: a.makers.map(m => m.capital),
  sourceWindows: [], actions: [], sourceAgeSeconds: 30, scope: 'Existing-position reduce-only order/cancel, A close, flat-cohort settlement and withdrawal; no continuous availability target' };
let stage = 'preflight', sourceDeadline = 0;
const safeFailure = (error: unknown) => String(error).replaceAll(h.config.rpc, '[RPC]').replaceAll(h.config.ws, '[WS]').replace(/https?:\/\/\S+/g, '[endpoint]').slice(0, 500);
async function rawState(commitment: 'confirmed' | 'finalized' = 'finalized') {
  return h.rpc.call('getMultipleAccounts', [[a.market, a.routeState, a.trader, ...a.makers.map(m => m.capital), a.vault, a.traderToken.address], { encoding: 'base64', commitment }]);
}
async function recordIntent(id: string, before: any) {
  const deadline = Date.now() + 90_000;
  for (;;) {
    await runtime.queue.step(id); const intent = await runtime.queue.get(id);
    if (intent.status === 'finalized' || intent.status === 'failed') {
      const tx = await h.rpc.call('getTransaction', [intent.signature, { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
      const fetched = await h.rpc.call('getTransaction', [intent.signature, { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
      const row = (await runtime.store.pool.query('SELECT wire FROM service_intents WHERE run_id=$1 AND request_id=$2', [runId, id])).rows[0];
      assert.equal(fetched.transaction[0], row.wire);
      const item = { id, intent, wire: row.wire, history: tx, events: decode(intent.signature, tx, a.eventAuthority, a.program), before, after: await rawState() };
      report.actions.push(item); persist(`${directory}/progress.json`, report);
      assert.equal(intent.status, 'finalized', `Original financial intent ${id} failed; no automatic replacement`);
      return item;
    }
    assert(Date.now() < deadline, `Original signature unresolved: ${intent.signature}`);
    await delay(500);
  }
}
async function user(id: string, instructions: Instruction[]) {
  const before = await rawState('confirmed');
  const { transaction } = await sdk.signInstructions(runtime.connection, a.traderOwner, instructions);
  const wire = Buffer.from(transaction.serialize()).toString('base64'), signature = getBase58Decoder().decode(transaction.signatures[0]);
  mkdirSync(`${directory}/signed`, { recursive: true, mode: 0o700 });
  persist(`${directory}/signed/${id}.json`, { id, signature, wire });
  const response = await fetch('http://127.0.0.1:18091/v1/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: id, wire }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).signature, signature);
  return recordIntent(id, before);
}
async function drain() {
  for (const id of await runtime.queue.pending()) await recordIntent(id, await rawState());
}
async function sourceWindow(purpose: string) {
  let polls = 0, maxAge: bigint | undefined;
  while (Date.now() < sourceDeadline) {
    let raw: any;
    try {
      raw = await h.rpc.call('getMultipleAccounts', [[...a.primary.map(x => x.account), 'SysvarC1ock11111111111111111111111111111111'], { encoding: 'base64', commitment: 'confirmed' }]);
    } catch (error) {
      (report.sourceReadErrors ??= []).push({ purpose, at: new Date().toISOString(), error: safeFailure(error) });
      persist(`${directory}/progress.json`, report);
      // Read-only polling may recover transient HTTP/network interruptions. This
      // does not retry/rebuild any financial intent or extend the 600-second cap.
      if (report.sourceReadErrors.length >= 5 || !/fetch failed|TimeoutError|AbortError|RPC HTTP (429|502|503|504)/.test(String(error))) throw error;
      await delay(1000); continue;
    }
    const now = Buffer.from(raw.value[2].data[0], 'base64').readBigInt64LE(32);
    const prices = a.primary.map((f, i) => decodeCore(raw.value[i], f));
    maxAge = prices.reduce((max, p) => now - p.published > max ? now - p.published : max, 0n); polls++;
    // Unsigned scheduling allowance only. Actual clearing enforces 30 seconds,
    // confidence, guard, funding and action-mode checks at landing.
    if (!prices.every((p, i) => coreEligibility(p, now, i === 1, 30n).eligible) || maxAge > 15n) { await delay(1000); continue; }
    const before = await rawState('confirmed');
    const guard = prices.map((p, i) => { const n = normalizeCore(p.price, p.confidence, p.exponent); return guardInstruction(a, i, n.value, n.confidence, p.published); });
    await h.sendObservation(`${purpose}-guard-${now}`, guard, [a.guardAuthority]);
    await h.sendObservation(`${purpose}-sample-${now}`, [sdk.fundingComputeBudget(), await sampleInstruction(a)]);
    const event = h.latestEvents.find(e => e.type === 'oracle'); assert(event);
    const observed = sdk.getOracleObservedEventDecoder().decode(Buffer.from(event.bytes, 'base64'));
    const window = { purpose, polls, raw, before, observed, events: h.latestEvents };
    report.sourceWindows.push(window); persist(`${directory}/progress.json`, report);
    console.log(JSON.stringify({ stage: 'source-window', purpose, polls, maximumAgeSeconds: maxAge.toString(), status: observed.oracle.status }));
    const clock = await h.now();
    if (observed.oracle.status !== 0 && observed.oracle.sourceDeadline >= clock + 8n) return window;
    await delay(1000);
  }
  report.sourceUnavailable = { purpose, polls, lastMaximumAgeSeconds: maxAge?.toString() };
  throw new Error('Bounded source preparation expired; no further priced intent signed');
}
try {
  await h.open(); await indexer.open(); await indexer.cycle(); await runtime.open();
  await app.listen({ host: '127.0.0.1', port: 18091 });
  let s = await runtime.snapshot(); report.initial = await rawState();
  assert.equal(s.participants[a.trader].lots, 1n); assert.equal(s.participants[a.makers[0].capital].lots, -1n);
  assert.equal(s.participants[a.makers[1].capital].lots, 0n);
  stage = 'owner-maker-renewal';
  await Promise.all(a.makers.map((m, id) => runtime.maker(id, m.owner))); await drain(); await indexer.cycle();
  sourceDeadline = Date.now() + 600_000;
  stage = 'reduce-only-order'; await sourceWindow('order');
  s = await runtime.snapshot('confirmed'); const p = s.participants[a.trader], orderId = p.book.lastOrderId + 1n;
  const terms = { side: 1, lots: 1n, limit: 100_000n, feeBudget: 100n, startSlot: s.slot, expirySlot: s.slot + 3600n,
    trigger: 0, threshold: 0n, reduceOnly: true, generation: p.generation };
  report.orderTerms = terms;
  const placed = await user('p14-place-reduction', [await sdk.getPlaceOrderInstructionAsync({ ...s, owner: a.traderOwner, participant: a.trader, expectedId: orderId, terms }, a.options)]);
  assert(placed.events.some(e => e.type === 'order' && e.data.kind === 0));
  stage = 'cancel-original-order';
  const cancelled = await user('p14-cancel-reduction', [await sdk.getCancelOrderInstructionAsync({ ...a, owner: a.traderOwner, participant: a.trader, id: orderId, version: 1n }, a.options)]);
  assert(cancelled.events.some(e => e.type === 'order' && e.data.kind === 2));
  stage = 'close-existing-position'; await sourceWindow('close');
  await Promise.all(a.makers.map((m, id) => runtime.maker(id, m.owner)));
  const response = await fetch('http://127.0.0.1:18091/v1/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner: a.traderOwner.address, side: 1, lots: '1' }) });
  const quote = await response.json(); report.quote = quote; assert.equal(response.status, 200); assert(quote.available);
  assert.equal(quote.allocation.legs.length, 1); assert.equal(quote.allocation.legs[0].makerId, 0);
  // Independent one-lot G04 vector: A inventory -1 truncates to bucket zero,
  // its unconsumed sell marginal is reference - 10, with one aggregate ceil fee.
  const gross = BigInt(quote.audit.referencePrice) - 10n, fee = (gross + 4999n) / 5000n;
  assert.equal(BigInt(quote.allocation.grossQuote), gross); assert.equal(BigInt(quote.allocation.fee), fee);
  const closed = await user('p14-close-one-lot', quote.instructions.map((ix: any) => ({ ...ix, data: Buffer.from(ix.data, 'base64') })));
  const trade = closed.events.find(e => e.type === 'route'); assert(trade); report.close = { gross, fee, event: trade };
  s = await runtime.snapshot(); assert(Object.values(s.participants).every(p => p.lots === 0n));
  stage = 'source-expiry-and-funding-gap';
  await h.reconcileObservations();
  while ((await h.now()) <= s.risk.oracle.sourceDeadline) await delay(500);
  const beforeExpiry = await rawState();
  await h.send('p14-expired-sample', [sdk.fundingComputeBudget(), await sampleInstruction(a)]);
  report.expiry = { before: beforeExpiry, after: await rawState(), events: h.latestEvents };
  await indexer.cycle(); s = await runtime.snapshot(); assert.equal(s.sourceMode, 'NoCredibleBounds');
  stage = 'flat-cohort-ordinary-settlement';
  for (let i = 0; i < 12; i++) {
    await runtime.settle(a.payer); const pending = await runtime.queue.pending();
    if (!pending.length) break;
    await drain(); await indexer.cycle();
  }
  s = await runtime.snapshot(); report.settled = await rawState();
  assert(Object.values(s.participants).every(p => p.lots === 0n && p.virtualScaled > -1_000_000_000n));
  assert(s.m.settlement <= 1n, 'Only fractional residual can remain after whole-atom settlement');
  assert(report.actions.some((x: any) => x.events.some((e: any) => e.type === 'settlement' && e.data.kind === 0)));
  assert(report.actions.some((x: any) => x.events.some((e: any) => e.type === 'settlement' && e.data.kind === 1)));
  stage = 'withdraw-funded-cash';
  // Leave one atom when a negative fractional claim still belongs to the trader.
  const trader = s.participants[a.trader], amount = trader.cash - (trader.virtualScaled < 0n ? 1n : 0n);
  const withdrawn = await user('p14-withdraw-cash', [await sdk.getWithdrawTradingInstructionAsync({ ...s, owner: a.traderOwner, participant: a.trader,
    quoteMint: a.mint.address, userToken: a.traderToken.address, sequence: s.m.sequence, observation: s.risk.observationSequence, amount }, a.options)]);
  assert(withdrawn.events.some(e => e.type === 'settlement' && e.data.kind === 2));
  await indexer.cycle(); await indexer.cycle();
  report.final = await rawState(); report.projection = (await indexer.store.snapshot()).state;
  report.sql = (await runtime.store.pool.query(`SELECT
    (SELECT count(*)::text FROM service_intents WHERE run_id=$1 AND status NOT IN ('finalized','failed')) AS unresolved,
    (SELECT count(*)::text FROM jobs WHERE run_id=$1 AND status IN ('pending','unresolved')) AS jobs`, [runId])).rows[0];
  assert.equal(report.sql.unresolved, '0'); assert.equal(report.sql.jobs, '0');
  report.budgets = (await runtime.store.pool.query('SELECT name,wallet,cap,committed,spent FROM service_budgets WHERE run_id=$1 ORDER BY name', [runId])).rows;
  report.result = 'pass';
} catch (error) {
  report.result = 'fail'; report.failedStage = stage;
  report.failure = safeFailure(error);
  process.exitCode = 1;
} finally {
  await h.reconcileObservations().catch(() => { report.finalizationFailure = true; process.exitCode = 1; });
  report.checks = h.checks; report.finishedUtc = new Date().toISOString();
  await app.close().catch(() => {}); await runtime.close().catch(() => {}); await indexer.close().catch(() => {});
  persist(`${directory}/lifecycle-report.json`, report);
  console.log(JSON.stringify({ result: report.result, failedStage: report.failedStage, report: `${directory}/lifecycle-report.json`, a19Complete: false }));
}
