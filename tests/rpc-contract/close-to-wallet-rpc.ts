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
import { ethSpreadGain, makerExitLabel, makerProofWork, readMakerExit, summarizeMakerExit, type ProofReceipt } from './cold-maker-exit.js';
import { startShadow } from './shadow-coverage.js';
import { checkShadowReceipts } from './shadow-coverage-receipts.js';
import { eventually } from './wire.js';

const arm = process.env.RIVALT_CASHOUT_ARM;
const followMaker = arm === 'worker-eth-exit';
assert(arm === 'trader' || arm === 'worker' || followMaker, 'Choose trader, worker or worker-eth-exit settlement');
const dir = process.env.RIVALT_RUN_DIR!, url = process.env.RIVALT_RPC_URL!, wsUrl = process.env.RIVALT_WS_URL!;
const database = process.env.RIVALT_DATABASE_URL!, runId = 'p55b2-application';
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(), '');
const build = routerBuild();
const shadowRun = process.env.RIVALT_SETTLEMENT_PROBE === 'execution-router-shadow-coverage';
const deployment = shadowRun ? 'shadow-coverage' : 'bounded-entry';
assert.equal(build.artifactSet, shadowRun ? sdk.SHADOW_COVERAGE_ARTIFACT_SET : sdk.BOUNDED_ENTRY_ARTIFACT_SET);
if (shadowRun) assert(followMaker, 'The shadow workload follows the cold ETH maker to SPL withdrawal');
let shadow: Awaited<ReturnType<typeof startShadow>> | undefined;
const owners = await Promise.all(['p32-trader', ...[1, 2, 3, 4, 5].map(i => 'p32-scale-trader-' + i)].map(fixtureKey));
const payers = new Map<string, typeof owners[number]>();
const broadcast = new Map<string, number>();
const { rpc, ws, h: transport, checks, flush } = await openCanonicalRpcHarness(url, wsUrl, dir, {
  deferFinality: true, payerFor: label => payers.get(label), observeOutcomes: label => label.startsWith('traffic '),
  broadcastAccepted: label => { if (payers.has(label)) broadcast.set(label, performance.now()); },
});
const h: typeof transport = {...transport, send(label, instructions, ...args) {
  return transport.send(label, shadow?.decorate(instructions) ?? instructions, ...args);
}};
class ShadowWorker extends AccountRuntime {
  override enqueue(...args: Parameters<AccountRuntime['enqueue']>) {
    assert(shadow);
    args[1] = shadow.decorate(args[1]);
    return super.enqueue(...args);
  }
}
const Worker = shadowRun ? ShadowWorker : AccountRuntime;
const service = new Worker(database, runId, url, 4, deployment);
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
const trafficCount = 48, trafficGap = 750, cutoffMs = 30_000;
// Four initial waves, followed by the same paced demand through the 30-second cutoff.
const dueMs = Array.from({ length: trafficCount }, (_, id) => id < 16 ? Math.floor(id / 4) * 160 : 2_300 + (id - 16) * trafficGap);
try {
  const setup = await liquidityExecutionSetup(h, rpc, { independentTraders: true, traderCount: owners.length,
    shape: symmetricPayoutShape, marketCheckpoints: true, marginLayout: 'ledger-lanes', makerCash: 100_000_000n,
    traderCash: deposit, verifyRejections: false });
  assert.deepEqual(setup.traderOwners.map(key => key.address), owners.map(key => key.address));
  if (shadowRun) {
    shadow = await startShadow(transport, setup);
    await flush();
    await shadow.audit(rpc);
    await setup.qualify();
  }
  const common = { ...setup.common, btc: setup.markets[0], eth: setup.markets[1] };
  const { route, root, guard, withCheckpoints } = executionTestHelpers(h, setup);
  const creditors = setup.roots.slice(0, 2);
  const tokens = [setup.traderToken.address, (await fixtureKey('p32-scale-token-1')).address];
  const [certificate] = await sdk.deriveSettlementCertificate(setup.venue, 0);
  const ethMaker = setup.instances[5];
  assert.equal(ethMaker.market, setup.markets[1]);
  const [ethCertificate] = await sdk.deriveSettlementCertificate(setup.venue, 1);
  const identity = { ...setup.identity, boundedEntry: true, closedQuantity: true };
  const sendAs = async (owner: typeof owners[number], label: string, instructions: Instruction[]) => {
    payers.set(label, owner);
    await h.send(label, instructions, [owner]);
  };
  async function trade(owner: number, market: 0 | 1, side: 0 | 1, size: bigint, maker: number, label: string, close = false) {
    const trader = setup.roots[owner];
    await sendAs(owners[owner], label, [await route({ trader, actor: owners[owner], marketIndex: market, side,
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
    anchor: binding.anchor, deployment, profile: 'liquidity-execution-qualification' });
  await indexer.open();
  await setup.qualify();
  // Attach registry and certificate to the SDK's account reads. Use the pair from the
  // same final RPC context as the financial snapshot, including all execution lanes.
  async function backing() {
    let contextSlot = -1, extra: Buffer[] = [];
    const sameBank = { async call(method: string, params: unknown[] = []) {
      assert.equal(method, 'getMultipleAccounts');
      const [keys, options] = params as [string[], unknown];
      const response = await rpc.call(method, [[...keys, setup.registry, certificate], options]);
      assert.equal(response.value.length, keys.length + 2);
      extra = response.value.slice(-2).map((row: { data: [string, string] }) => Buffer.from(row.data[0], 'base64'));
      contextSlot = response.context.slot;
      return { context: response.context, value: response.value.slice(0, -2) };
    } };
    const snapshot = await sdk.readAccountSnapshot(sameBank, identity, creditors, 'confirmed');
    assert.equal(snapshot.contextSlot, BigInt(contextSlot));
    const status = sdk.accountBackingStatus(snapshot, sdk.getVenueRegistryDecoder().decode(extra[0]),
      sdk.getSettlementCertificateDecoder().decode(extra[1]));
    return { slot: contextSlot, payable: status.payable, complete: status.complete,
      sourcesCurrent: status.sourcesCurrent, arithmeticReady: status.arithmeticReady, pool: snapshot.ledgerStates[0].settlement };
  }
  const beforeClose = await backing();
  assert(beforeClose.payable, 'Both arms must start with current backing');
  const start = performance.now();
  const elapsed = () => Math.round(performance.now() - start);
  // The opposing opening maker and the four traffic wallets are the only debtors in this book.
  // Sampling them in the same bank lets the worker drain covered losses after the last exit.
  const debtors = [setup.instances[0].capital, ...setup.roots.slice(2)];
  const reference = [61_000n, 30_000n] as const;
  async function observe() {
    const keys = [...creditors, ...tokens, setup.vault, ...setup.ledgers, ...debtors];
    const makerIndex = keys.length;
    if (followMaker) keys.push(ethMaker.capital, ethMaker.token.address, ethCertificate);
    const response = await rpc.call('getMultipleAccounts', [keys, { commitment: 'confirmed', encoding: 'base64' }]);
    const data = (i: number) => Buffer.from(response.value[i].data[0], 'base64');
    const token = (i: number) => getTokenDecoder().decode(data(i)).amount;
    const debt = [0n, 0n];
    for (let i = 0; i < debtors.length; i++) {
      const account = sdk.getMarginAccountDecoder().decode(data(7 + i));
      for (const market of [0, 1] as const) {
        const position = account.positions[market];
        const claim = position.virtualScaled + position.lots * reference[market] * scale;
        if (claim < 0n) debt[market] += -claim / scale;
      }
    }
    const maker = followMaker ? readMakerExit(data(makerIndex), data(makerIndex + 1),
      response.value[makerIndex + 2] ? data(makerIndex + 2) : null, setup.venue, ethMaker.owner.address, setup.mint.address) : undefined;
    return { ms: elapsed(), slot: response.context.slot, maker, debt, ethPool: sdk.decodeFeeLedger(data(6)).state.settlement, vault: token(4), pool: sdk.decodeFeeLedger(data(5)).state.settlement,
      creditors: creditors.map((_, i) => {
        const account = sdk.getMarginAccountDecoder().decode(data(i)), position = account.positions[0];
        return { lots: position.lots, claimScaled: position.virtualScaled, cash: account.cash, wallet: token(i + 2) };
      }) };
  }
  const first = await observe();
  assert.equal(first.pool, openingPool);
  if (followMaker) {
    assert(first.maker);
    assert.deepEqual([first.maker.cash, first.maker.lots, first.maker.virtualScaled, first.maker.proof, first.ethPool],
      [100_000_000n, 0n, 0n, null, 0n]);
  }
  const observations = [first];
  async function record() { const state = await observe(); observations.push(state); return state; }
  background(async () => { while (running) { await record(); await delay(75); } });
  background(async () => { while (running) { await indexer!.cycle(); await delay(100); } });
  background(async () => { while (running) { await delay(1000); if (running) await setup.sample(); } });
  // Equal paced demand on both venues. Pin the background maker to avoid changing the initial debtor.
  // Each wallet owns its predecessor queue; all scheduled offers count, including landed refusals.
  let trafficFinished = false;
  const traffic = background(async () => {
    await Promise.all([0, 1, 2, 3].map(async stream => {
      for (let id = stream; id < trafficCount; id += 4) {
        await delay(Math.max(0, dueMs[id] - elapsed())); healthy();
        const market = (stream % 2) as 0 | 1;
        await trade(stream + 2, market, (Math.floor(id / 4) % 2) as 0 | 1, 10n, market * 3 + 2, 'traffic ' + id);
      }
    }));
    trafficFinished = true;
  });
  const closeTimes: number[] = [];
  for (let i = 0; i < creditors.length; i++) {
    await trade(i, 0, 1, lots, 2, 'close creditor ' + i, true);
    closeTimes.push(elapsed());
    const closed = (await record()).creditors[i];
    assert.deepEqual([closed.lots, closed.claimScaled, closed.cash], [0n, gain * scale, deposit - fees]);
  }
  const afterCloseBacking = await backing();
  assert(afterCloseBacking.payable, 'The backed claims must be payable after close');
  const backingSamples = [{ ...beforeClose, ms: 0 }, { ...afterCloseBacking, ms: elapsed() }];
  background(async () => { while (running) {
    const status = await backing();
    backingSamples.push({ ...status, ms: elapsed() });
    await delay(350);
  } });
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
    if (arm !== 'trader') {
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
            await sendAs(owners[i], 'owner collects ' + i, await collect(owners[i], remaining));
            assert((await record()).pool >= remaining, 'Signed collection did not fund the pool');
            continue;
          }
          await sendAs(owners[i], 'owner claims ' + i + ' remaining ' + remaining, await withCheckpoints(sdk.getPayAccountGainInstruction({
            ...common, actor: owners[i], margin: creditors[i], certificate, marketIndex: 0, amount })));
          remaining -= amount;
          await record();
        }
      }
    }
  });
  // Common withdrawal policy: withdraw exactly the net trading gain once fully credited.
  const exited = new Set<number>();
  let makerExited = false, observedCold = false;
  const followupEnd = Math.max(...closeTimes) + (followMaker ? 360_000 : 120_000);
  while (elapsed() < followupEnd) {
    healthy();
    const state = await record();
    if (shadow && !observedCold && state.maker?.lots === 0n && state.maker.virtualScaled === ethSpreadGain * scale
        && state.ethPool === ethSpreadGain && !state.maker.proof?.complete) {
      await h.send('observe funded ETH before first certificate', [shadow.observe(1)]);
      observedCold = true;
    }
    for (let i = 0; i < creditors.length; i++) {
      const account = state.creditors[i];
      if (exited.has(i) || account.claimScaled !== 0n) continue;
      assert.equal(account.cash, deposit + net);
      await sendAs(owners[i], 'withdraw creditor ' + i, await withCheckpoints(sdk.getWithdrawFundedAccountInstruction({
        ...common, owner: owners[i], margin: creditors[i], userToken: tokens[i], quoteMint: setup.mint.address,
        guard: await guard(creditors[i]), amount: net })));
      const withdrawn = (await record()).creditors[i];
      assert.deepEqual([withdrawn.wallet - first.creditors[i].wallet, withdrawn.cash], [net, deposit]);
      exited.add(i);
    }
    if (state.maker && trafficFinished && !makerExited && state.maker.cash === first.maker!.cash + ethSpreadGain) {
      assert(state.maker.proof?.complete && state.maker.lots === 0n && state.maker.virtualScaled === 0n);
      await sendAs(ethMaker.owner, makerExitLabel, await withCheckpoints(sdk.getWithdrawFundedAccountInstruction({
        ...common, owner: ethMaker.owner, margin: ethMaker.capital, userToken: ethMaker.token.address, quoteMint: setup.mint.address,
        guard: await guard(ethMaker.capital), amount: ethSpreadGain })));
      const withdrawn = (await record()).maker!;
      assert.deepEqual([withdrawn.wallet - first.maker!.wallet, withdrawn.cash], [ethSpreadGain, first.maker!.cash]);
      makerExited = true;
    }
    if ((!followMaker || makerExited) && exited.size === creditors.length && elapsed() >= Math.max(...closeTimes) + cutoffMs
      && (arm === 'trader' || (trafficFinished && state.debt.every(amount => amount === 0n)))) break;
    await delay(100);
  }
  const cutoff = await record();
  polling = false; await settlement; await traffic; healthy();
  if (arm !== 'trader') await eventually(async () => { await dispatch(); return intents(); },
    rows => rows.every(row => ['failed', 'finalized'].includes(row.status)), 'settlement originals drain', 45_000);
  running = false; await Promise.all(tasks); healthy(); await flush(); await indexer.close(); indexer = undefined;
  const workerReceipts: { request: string; signature: string; slot: number; error: unknown;
    collections: { marketIndex: number; amount: bigint }[] }[] = [];
  const ethReceipts: ProofReceipt[] = [];
  const flows = [0, 1].map(() => ({ collections: 0, collected: 0n, paid: 0n }));
  for (const row of await intents()) {
    const receipt = await rpc.call('getTransaction', [row.signature, { commitment: 'finalized', encoding: 'base64', maxSupportedTransactionVersion: 1 }]);
    assert.equal(receipt.transaction[0], row.wire);
    assert.deepEqual((await ws.notification(subscriptions.get(row.signature)!)).params.result.value.err, receipt.meta.err);
    const collections: { marketIndex: number; amount: bigint }[] = [];
    if (receipt.meta.err === null) {
      const { message } = VersionedTransaction.deserialize(Buffer.from(row.wire, 'base64'));
      if (followMaker) {
        const work = makerProofWork(message, ethCertificate, ethMaker.capital);
        if (work) ethReceipts.push({ ...work, signature: row.signature, slot: receipt.slot, fee: BigInt(receipt.meta.fee) });
      }
      for (const ix of message.compiledInstructions) {
        if (message.staticAccountKeys[ix.programIdIndex].address !== sdk.CLEARING_PROGRAM_ADDRESS) continue;
        const tag = sdk.hex(ix.data.subarray(0, 8));
        if (tag === sdk.hex(sdk.COLLECT_ACCOUNT_LOSS_DISCRIMINATOR)) {
          const { marketIndex, amount } = sdk.getCollectAccountLossInstructionDataDecoder().decode(ix.data);
          collections.push({ marketIndex, amount });
          flows[marketIndex].collections++;
          flows[marketIndex].collected += amount;
        } else if (tag === sdk.hex(sdk.PAY_ACCOUNT_GAIN_DISCRIMINATOR)) {
          const { marketIndex, amount } = sdk.getPayAccountGainInstructionDataDecoder().decode(ix.data);
          flows[marketIndex].paid += amount;
        }
      }
    }
    workerReceipts.push({ collections, request: row.request_id, signature: row.signature, slot: receipt.slot, error: receipt.meta.err });
  }
  if (arm === 'trader') assert.equal(workerReceipts.length, 0);
  const replayName = 'close-to-wallet';
  await journal.checkpoint(replayName, true);
  const audit = shadow && await shadow.audit(rpc);
  const replay = await journal.finish(shadow ? ((blocks, invocations) => {
    assert(observedCold && shadow);
    const report = checkShadowReceipts(blocks, invocations, checks, shadow);
    writeFileSync(dir + '/shadow-coverage.json', json({revision, program:build.revision, audit, ...report}));
  }) : undefined);
  observations.sort((a,b) => a.ms - b.ms);
  const ownerReceipts = [];
  for (const check of checks.filter(check => payers.has(String(check.label)))) {
    const receipt = await rpc.call('getTransaction', [check.signature, { commitment: 'finalized', encoding: 'base64', maxSupportedTransactionVersion: 1 }]);
    const tx = VersionedTransaction.deserialize(Buffer.from(receipt.transaction[0], 'base64'));
    const label = String(check.label);
    assert.equal(tx.message.staticAccountKeys[0].address, payers.get(label)!.address);
    assert.equal(tx.signatures.length, 1);
    if (label === makerExitLabel) {
      type TokenBalance = { accountIndex: number; mint: string; uiTokenAmount: { amount: string } };
      const balance = (rows: TokenBalance[], key: string) => {
        const entry = rows.find(row => tx.message.staticAccountKeys[row.accountIndex]?.address === key);
        assert(entry && entry.mint === setup.mint.address);
        return BigInt(entry.uiTokenAmount.amount);
      };
      for (const [key, delta] of [[ethMaker.token.address, ethSpreadGain], [setup.vault, -ethSpreadGain]] as const) {
        assert.equal(balance(receipt.meta.postTokenBalances, key) - balance(receipt.meta.preTokenBalances, key), delta);
      }
    }
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
      const collectedBeforeSlot = [0n, 0n];
      for (const receipt of workerReceipts) if (receipt.slot < state.slot) {
        for (const { marketIndex, amount } of receipt.collections) collectedBeforeSlot[marketIndex] += amount;
      }
      return { ms, observedMs: state.ms - closeTimes[i], slot: state.slot, unpaid, credited, withdrawn, pool: state.pool,
        ethPool: state.ethPool, outstandingLossAtoms: state.debt, workerCollectedBeforeSlot: collectedBeforeSlot };
    });
    return { margin, closeBroadcastMs: Math.round(broadcast.get('close creditor ' + i)! - start),
      closeConfirmedMs: closeTimes[i], gain, fees, net, firstCreditMs: delayTo(s => s.creditors[i].claimScaled < gain * scale),
      fullCreditMs: delayTo(s => s.creditors[i].claimScaled === 0n),
      withdrawalMs: delayTo(s => s.creditors[i].wallet === first.creditors[i].wallet + net), checkpoints };
  });
  const competingFills = ownerReceipts.filter(row => row.label.startsWith('traffic ') && row.error === null);
  for (const [i, row] of rows.entries()) {
    const close = ownerReceipts.find(receipt => receipt.label === 'close creditor ' + i)!;
    const withdrawal = ownerReceipts.find(receipt => receipt.label === 'withdraw creditor ' + i);
    // Strictly interior slots prove overlap without claiming an ordering inside a slot.
    if (withdrawal) assert(competingFills.some(fill => fill.slot > close.slot && fill.slot < withdrawal.slot),
      'No competing fill in a slot strictly between close and withdrawal for ' + row.margin);
  }
  const load = checks.filter(check => String(check.label).startsWith('traffic '));
  assert.equal(load.length, trafficCount);
  assert(load.some(check => check.error === null), 'No landed competing fills');
  const last = await observe();
  const traderWithdrawals = last.creditors.reduce((sum, row, i) => sum + row.wallet - first.creditors[i].wallet, 0n);
  assert.equal(first.vault - last.vault, traderWithdrawals + (last.maker ? last.maker.wallet - first.maker!.wallet : 0n));
  for (const [i, key] of creditors.entries()) {
    assert.equal(BigInt(replay.state.roots[key].cash), last.creditors[i].cash);
    assert.equal(BigInt(replay.state.roots[key].positions[0].virtualScaled), last.creditors[i].claimScaled);
  }
  if (arm !== 'trader') {
    for (const market of [0, 1] as const) {
      const state = replay.state.markets[setup.markets[market]];
      assert.equal(BigInt(state.referencePrice), reference[market]);
      assert.equal(BigInt(state.fundingIndexScaled), 0n);
      const pool = BigInt(replay.state.ledgers[setup.ledgers[market]].settlement);
      assert.equal(pool, (market === 0 ? openingPool : 0n) + flows[market].collected - flows[market].paid);
    }
  }
  const availableForBoth = observations.find(state => state.creditors.every(row => row.lots === 0n)
    && state.pool >= state.creditors.reduce((total, row) => total + row.claimScaled / scale, 0n));
  writeFileSync(dir + '/cashout-observations.json', json(observations));
  let makerExit;
  if (followMaker) {
    writeFileSync(dir + '/cold-eth-receipts.json', json(ethReceipts));
    const withdrawal = ownerReceipts.find(row => row.label === makerExitLabel);
    assert(makerExited && withdrawal && withdrawal.error === null, 'Cold ETH maker withdrawal did not land before cutoff');
    makerExit = summarizeMakerExit(observations, ethReceipts, { signature: String(withdrawal.signature), slot: withdrawal.slot });
    const finalRoot = replay.state.roots[ethMaker.capital], finalProof = replay.state.backing[ethCertificate];
    assert(finalProof.complete && BigInt(finalProof.next) === 12n && BigInt(finalProof.count) === 12n);
    assert.deepEqual([BigInt(finalRoot.cash), BigInt(finalRoot.positions[1].lots), BigInt(finalRoot.positions[1].virtualScaled)],
      [first.maker!.cash, 0n, 0n]);
    assert.equal(last.ethPool, 0n);
  }
  const result = { makerExit, revision, program: build.revision, arm, openingPool, backingReadyBeforeClose: true, releasedMs, firstObservedPoolCoveringRemainingClaimsMs: availableForBoth?.ms ?? null, rows,
    traffic: { offered: trafficCount, filled: load.filter(row => row.error === null).length, gapMs: trafficGap, dueMs },
    exitsObserved: exited.size, observedThroughMs: cutoff.ms, events: replay.events, workerReceipts, workerFlows: flows, remainingLossAtoms: last.debt,
    receipts: ownerReceipts };
  writeFileSync(dir + '/cashout-backing.json', json(backingSamples));
  writeFileSync(dir + '/cashout-result.json', json(result));
  if (arm !== 'trader') {
    // Six round trips per wallet, two wallets per market, ten lots at a four-atom spread.
    // The opening BTC maker also owes 2,000 lots times 998 atoms, less the pre-seeded pool.
    assert.equal(competingFills.length, 48, 'Unmatched background traffic');
    assert.deepEqual(flows.map(flow => flow.collected), [502_000n + 480n, 480n]);
    assert.deepEqual(last.debt, [0n, 0n]);
    assert.equal(exited.size, 2);
  }
  console.log(json({ ...result, receipts: undefined, workerReceipts: workerReceipts.length }));
} finally {
  running = false; polling = false; await Promise.allSettled(tasks);
  await indexer?.close(); await service.close(); await journal?.close();
  try { await flush(); } finally { ws.close(); }
}
