// Matched normal-settlement paths. Cash, a claim and tokens are three different balances.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { Instruction } from '@solana/kit';
import { VersionedTransaction } from '@solana/web3.js';
import { getTokenDecoder } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { json } from '../../packages/indexer/src/events.js';
import { LiquidityIndexer } from '../../packages/indexer/src/liquidity-indexer.js';
import { AccountRuntime } from '../../packages/services/src/account-runtime.js';
import { symmetricPayoutShape } from './canonical-maker-cases.js';
import { openCanonicalRpcHarness } from './canonical-rpc-harness.js';
import { routerBuild } from './execution-router-build.js';
import { fixtureKey } from './harness.js';
import { executionTestHelpers } from './liquidity-execution-helpers.js';
import { liquidityExecutionSetup } from './liquidity-execution-setup.js';
import { backingStep } from './membership-scan-helper.js';
import { openSettlementJournal } from './scalable-settlement-journal.js';
import { eventually } from './wire.js';

const arm = process.env.RIVALT_CASHOUT_ARM;
assert(arm === 'trader' || arm === 'worker', 'Choose trader or worker settlement');
const dir = process.env.RIVALT_RUN_DIR!, url = process.env.RIVALT_RPC_URL!, wsUrl = process.env.RIVALT_WS_URL!;
const database = process.env.RIVALT_DATABASE_URL!, runId = 'p55b2-application';
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(), '');
const build = routerBuild();
assert.equal(build.artifactSet, sdk.BOUNDED_ENTRY_ARTIFACT_SET);
const owners = await Promise.all(['p32-trader', ...[1, 2, 3, 4, 5].map(i => 'p32-scale-trader-' + i)].map(fixtureKey));
const payers = new Map<string, typeof owners[number]>();
const broadcast = new Map<string, number>();
const { rpc, ws, h, checks, flush } = await openCanonicalRpcHarness(url, wsUrl, dir, {
  deferFinality: true, payerFor: label => payers.get(label), observeOutcomes: label => label.startsWith('traffic '),
  broadcastAccepted: label => { if (payers.has(label)) broadcast.set(label, performance.now()); },
});
const service = new AccountRuntime(database, runId, url, 4, 'bounded-entry');
let journal: Awaited<ReturnType<typeof openSettlementJournal>> | undefined, indexer: LiquidityIndexer | undefined;
let running = true, polling = true, loopError: unknown;
const tasks: Promise<void>[] = [];
function background(task: () => Promise<void>) {
  const promise = task().catch(error => { loopError ??= error; running = false; });
  tasks.push(promise);
  return promise;
}
function healthy() { if (loopError) throw loopError; }
const lots = 1_000n, openPrice = 60_002n, closePrice = 60_998n, deposit = 50_000_000n;
const fee = (gross: bigint) => (gross + 4_999n) / 5_000n;
const gain = lots * (closePrice - openPrice), fees = fee(lots * openPrice) + fee(lots * closePrice);
const net = gain - fees, openingPool = gain * 3n / 2n, scale = 1_000_000_000n;
const trafficCount = 32, trafficGap = 750, cutoffMs = 30_000;
try {
  const setup = await liquidityExecutionSetup(h, rpc, { independentTraders: true, traderCount: owners.length,
    shape: symmetricPayoutShape, marketCheckpoints: true, marginLayout: 'ledger-lanes', makerCash: 100_000_000n,
    traderCash: deposit, verifyRejections: false });
  assert.deepEqual(setup.traderOwners.map(key => key.address), owners.map(key => key.address));
  const common = { ...setup.common, btc: setup.markets[0], eth: setup.markets[1] };
  const { route, root, guard, withCheckpoints } = executionTestHelpers(h, setup);
  const creditors = setup.roots.slice(0, 2);
  const tokens = [setup.traderToken.address, (await fixtureKey('p32-scale-token-1')).address];
  const [certificate] = await sdk.deriveSettlementCertificate(setup.venue, 0);
  const identity = { ...setup.identity, boundedEntry: true, closedQuantity: true };
  const sendAs = async (owner: number, label: string, instructions: Instruction[]) => {
    payers.set(label, owners[owner]);
    await h.send(label, instructions, [owners[owner]]);
  };
  async function trade(owner: number, market: 0 | 1, side: 0 | 1, size: bigint, maker: number, label: string, close = false) {
    const trader = setup.roots[owner];
    await sendAs(owner, label, [await route({ trader, actor: owners[owner], marketIndex: market, side,
      lots: [size], makers: [setup.instances[maker]], marketLane: true, minimalMarkets: true,
      reduceOnly: close, generation: close ? (await root(trader)).positions[market].generation : undefined })]);
  }
  const collect = (actor: typeof owners[number], amount: bigint) => withCheckpoints(sdk.getCollectAccountLossInstruction({
    ...common, actor, margin: setup.instances[0].capital, marketIndex: 0, amount }));
  await setup.sample();
  for (let i = 0; i < creditors.length; i++) await trade(i, 0, 0, lots, 0, 'open creditor ' + i);
  setup.sourcePrices.btc = 61_000_000_000n;
  await setup.qualify();
  await h.send('seed pool from an actual maker loss', await collect(setup.payer, openingPool));
  await h.send('initialize BTC backing', [sdk.getInitializeMarketBackingInstruction({ ...common, payer: setup.payer, certificate, marketIndex: 0 })]);
  const proof = async () => sdk.getSettlementCertificateDecoder().decode((await h.read(certificate))!);
  for (let step = 0; !(await proof()).complete; step++) {
    assert(step < 100, 'Incomplete backing scan');
    if (step % 4 === 0) await setup.sample();
    const next = await backingStep(h, { ...common, certificate, ledger: setup.ledgers[0] }, step === 0);
    await h.send('prepare backing ' + step, await withCheckpoints(next.instruction));
  }
  await flush();
  journal = await openSettlementJournal(rpc, setup, checks.map(receipt => String(receipt.signature)), build);
  await journal.checkpoint('before-close', true);
  await service.open();
  const { binding } = await service.store.snapshot();
  indexer = new LiquidityIndexer({ rpcUrl: url, wsUrl, databaseUrl: database, runId, venue: setup.venue,
    anchor: binding.anchor, deployment: 'bounded-entry', profile: 'liquidity-execution-qualification' });
  await indexer.open();
  await setup.qualify();
  const registry = sdk.getVenueRegistryDecoder().decode((await h.read(setup.registry))!);
  const backing = async () => sdk.accountBackingStatus(
    await sdk.readAccountSnapshot(rpc, identity, creditors, 'confirmed'), registry, await proof());
  assert((await backing()).payable, 'Both arms must start with current backing');
  const start = performance.now();
  const elapsed = () => Math.round(performance.now() - start);
  async function observe() {
    const keys = [...creditors, ...tokens, setup.vault, setup.ledgers[0]];
    const response = await rpc.call('getMultipleAccounts', [keys, { commitment: 'confirmed', encoding: 'base64' }]);
    const data = (i: number) => Buffer.from(response.value[i].data[0], 'base64');
    const token = (i: number) => getTokenDecoder().decode(data(i)).amount;
    return { ms: elapsed(), slot: response.context.slot, vault: token(4), pool: sdk.decodeFeeLedger(data(5)).state.settlement,
      creditors: creditors.map((_, i) => {
        const account = sdk.getMarginAccountDecoder().decode(data(i)), position = account.positions[0];
        return { lots: position.lots, claimScaled: position.virtualScaled, cash: account.cash, wallet: token(i + 2) };
      }) };
  }
  const first = await observe();
  assert.equal(first.pool, openingPool);
  const observations = [first];
  async function record() { const state = await observe(); observations.push(state); return state; }
  background(async () => { while (running) { await record(); await delay(75); } });
  background(async () => { while (running) { await indexer!.cycle(); await delay(100); } });
  background(async () => { while (running) { await delay(1000); if (running) await setup.sample(); } });
  // Equal paced demand on both venues. Pin the background maker to avoid changing the initial debtor.
  // Each wallet owns its predecessor queue; all scheduled offers count, including landed refusals.
  const traffic = background(async () => {
    await Promise.all([0, 1, 2, 3].map(async stream => {
      for (let id = stream; id < trafficCount; id += 4) {
        await delay(Math.max(0, id * trafficGap - elapsed())); healthy();
        const market = (stream % 2) as 0 | 1;
        await trade(stream + 2, market, (Math.floor(id / 4) % 2) as 0 | 1, 10n, market * 3 + 2, 'traffic ' + id);
      }
    }));
  });
  const closeTimes: number[] = [];
  for (let i = 0; i < creditors.length; i++) {
    await trade(i, 0, 1, lots, 2, 'close creditor ' + i, true);
    closeTimes.push(elapsed());
    const closed = (await record()).creditors[i];
    assert.deepEqual([closed.lots, closed.claimScaled, closed.cash], [0n, gain * scale, deposit - fees]);
  }
  assert((await backing()).payable, 'The backed claims must be payable after close');
  const releasedMs = elapsed();
  const intents = async () => (await service.store.pool.query<{ request_id: string; signature: string; wire: string; status: string }>(
    'SELECT request_id,signature,wire,status FROM service_intents WHERE run_id=$1 ORDER BY request_id', [runId])).rows;
  const subscriptions = new Map<string, number>();
  async function dispatch() {
    for (const row of await intents()) if (row.status === 'pending' && !subscriptions.has(row.signature))
      subscriptions.set(row.signature, await ws.call('signatureSubscribe', [row.signature, { commitment: 'finalized' }]));
    await service.execute();
  }
  const settlement = background(async () => {
    if (arm === 'worker') {
      while (running && polling) {
        await dispatch();
        try { await service.settle(setup.payer); }
        catch (error) { if (!(error instanceof Error && error.message === 'Reconciled projection unavailable')) throw error; }
        await delay(100);
      }
    } else {
      // Each trader pays their own fee. Claim currently funded cash first, then collect the
      // missing amount from the known funded debtor in this fixture; no keeper dispatch.
      for (let i = 0; i < creditors.length; i++) {
        let remaining = gain;
        while (remaining > 0n) {
          const state = await record();
          const amount = state.pool < remaining ? state.pool : remaining;
          if (!amount) {
            await sendAs(i, 'owner collects ' + i, await collect(owners[i], remaining));
            assert((await record()).pool >= remaining, 'Signed collection did not fund the pool');
            continue;
          }
          await sendAs(i, 'owner claims ' + i + ' remaining ' + remaining, await withCheckpoints(sdk.getPayAccountGainInstruction({
            ...common, actor: owners[i], margin: creditors[i], certificate, marketIndex: 0, amount })));
          remaining -= amount;
          await record();
        }
      }
    }
  });
  // Common withdrawal policy: withdraw exactly the net trading gain once fully credited.
  const exited = new Set<number>();
  const followupEnd = Math.max(...closeTimes) + 120_000;
  while (elapsed() < followupEnd) {
    healthy();
    const state = await record();
    for (let i = 0; i < creditors.length; i++) {
      const account = state.creditors[i];
      if (exited.has(i) || account.claimScaled !== 0n) continue;
      assert.equal(account.cash, deposit + net);
      await sendAs(i, 'withdraw creditor ' + i, await withCheckpoints(sdk.getWithdrawFundedAccountInstruction({
        ...common, owner: owners[i], margin: creditors[i], userToken: tokens[i], quoteMint: setup.mint.address,
        guard: await guard(creditors[i]), amount: net })));
      const withdrawn = (await record()).creditors[i];
      assert.deepEqual([withdrawn.wallet - first.creditors[i].wallet, withdrawn.cash], [net, deposit]);
      exited.add(i);
    }
    if (exited.size === creditors.length && elapsed() >= Math.max(...closeTimes) + cutoffMs) break;
    await delay(100);
  }
  const cutoff = await record();
  polling = false; await settlement; await traffic; healthy();
  if (arm === 'worker') await eventually(async () => { await dispatch(); return intents(); },
    rows => rows.every(row => ['failed', 'finalized'].includes(row.status)), 'settlement originals drain', 45_000);
  running = false; await Promise.all(tasks); healthy(); await flush(); await indexer.close(); indexer = undefined;
  const workerReceipts = [];
  for (const row of await intents()) {
    const receipt = await rpc.call('getTransaction', [row.signature, { commitment: 'finalized', encoding: 'base64', maxSupportedTransactionVersion: 1 }]);
    assert.equal(receipt.transaction[0], row.wire);
    assert.deepEqual((await ws.notification(subscriptions.get(row.signature)!)).params.result.value.err, receipt.meta.err);
    workerReceipts.push({ request: row.request_id, signature: row.signature, slot: receipt.slot, error: receipt.meta.err });
  }
  if (arm === 'trader') assert.equal(workerReceipts.length, 0);
  const replayName = 'close-to-wallet';
  await journal.checkpoint(replayName, true);
  const replay = await journal.finish();
  observations.sort((a,b) => a.ms - b.ms);
  const ownerReceipts = [];
  for (const check of checks.filter(check => payers.has(String(check.label)))) {
    const receipt = await rpc.call('getTransaction', [check.signature, { commitment: 'finalized', encoding: 'base64', maxSupportedTransactionVersion: 1 }]);
    const tx = VersionedTransaction.deserialize(Buffer.from(receipt.transaction[0], 'base64'));
    const label = String(check.label);
    assert.equal(tx.message.staticAccountKeys[0].address, payers.get(label)!.address);
    assert.equal(tx.signatures.length, 1);
    ownerReceipts.push({ label, signature: check.signature, slot: receipt.slot, error: receipt.meta.err });
  }
  const rows = creditors.map((margin, i) => {
    const afterClose = observations.filter(state => state.ms >= closeTimes[i] && state.creditors[i].lots === 0n);
    const delayTo = (match: (state: typeof first) => boolean) => {
      const found = afterClose.find(match);
      return found ? found.ms - closeTimes[i] : null;
    };
    const checkpoints = [1_000, 5_000, 15_000, cutoffMs].map(ms => {
      const state = afterClose.filter(row => row.ms <= closeTimes[i] + ms).at(-1);
      assert(state, 'Missing observation after close');
      const holder = state.creditors[i], unpaid = holder.claimScaled / scale;
      assert.equal(holder.claimScaled % scale, 0n);
      const withdrawn = holder.wallet - first.creditors[i].wallet, credited = gain - unpaid;
      assert.equal(holder.cash + withdrawn, deposit - fees + credited);
      return { ms, observedMs: state.ms - closeTimes[i], slot: state.slot, unpaid, credited, withdrawn, pool: state.pool };
    });
    return { margin, closeBroadcastMs: Math.round(broadcast.get('close creditor ' + i)! - start),
      closeConfirmedMs: closeTimes[i], gain, fees, net, firstCreditMs: delayTo(s => s.creditors[i].claimScaled < gain * scale),
      fullCreditMs: delayTo(s => s.creditors[i].claimScaled === 0n),
      withdrawalMs: delayTo(s => s.creditors[i].wallet === first.creditors[i].wallet + net), checkpoints };
  });
  const load = checks.filter(check => String(check.label).startsWith('traffic '));
  assert.equal(load.length, trafficCount);
  assert(load.some(check => check.error === null), 'No landed competing fills');
  const last = await observe();
  assert.equal(first.vault - last.vault, last.creditors.reduce((sum, row, i) => sum + row.wallet - first.creditors[i].wallet, 0n));
  for (const [i, key] of creditors.entries()) {
    assert.equal(BigInt(replay.state.roots[key].cash), last.creditors[i].cash);
    assert.equal(BigInt(replay.state.roots[key].positions[0].virtualScaled), last.creditors[i].claimScaled);
  }
  const availableForBoth = observations.find(state => state.creditors.every(row => row.lots === 0n)
    && state.pool >= state.creditors.reduce((total, row) => total + row.claimScaled / scale, 0n));
  const result = { revision, program: build.revision, arm, openingPool, backingReadyBeforeClose: true, releasedMs, firstObservedPoolCoveringRemainingClaimsMs: availableForBoth?.ms ?? null, rows,
    traffic: { offered: trafficCount, filled: load.filter(row => row.error === null).length, gapMs: trafficGap },
    exitsObserved: exited.size, observedThroughMs: cutoff.ms, events: replay.events, workerReceipts,
    receipts: ownerReceipts };
  writeFileSync(dir + '/cashout-observations.json', json(observations));
  writeFileSync(dir + '/cashout-result.json', json(result));
  console.log(json({ ...result, receipts: undefined, workerReceipts: workerReceipts.length }));
} finally {
  running = false; polling = false; await Promise.allSettled(tasks);
  await indexer?.close(); await service.close(); await journal?.close();
  try { await flush(); } finally { ws.close(); }
}
