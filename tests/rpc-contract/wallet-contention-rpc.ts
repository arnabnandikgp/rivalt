import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {decodeAccountInvocations} from '../../packages/indexer/src/account-events.js';
import {json} from '../../packages/indexer/src/events.js';
import {accountUserAuthority} from '../../packages/services/src/account-ingress.js';
import {transactionLocks} from '../performance/lock-model.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {routerBuild} from './execution-router-build.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const placement = process.env.RIVALT_CONTENTION_MARKETS;
assert(placement === 'btc' || placement === 'eth' || placement === 'split');
const directory = process.env.RIVALT_RUN_DIR!, build = routerBuild();
assert.equal(build.artifactSet, sdk.PRICE_LIMITED_MULTI_ARTIFACT_SET);
const deployment = 'price-limited-multi-maker';
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {encoding: 'utf8'}).trim(), '');
const participants = 12, rounds = 4, gapMs = 40;
const trace = Array.from({length: participants * rounds}, (_, id) => {
  const stream = id % participants, round = Math.floor(id / participants);
  const market: 0 | 1 = placement === 'btc' ? 0 : placement === 'eth' ? 1 : stream % 2 === 0 ? 0 : 1;
  const side: 0 | 1 = (Math.floor(stream / 2) + round) % 2 === 0 ? 0 : 1;
  const target = [120n, 600n, 1200n][(stream + Math.floor(round / 2)) % 3] * 1_000_000n;
  const indexPrice = market === 0 ? 60_000n : 30_000n;
  assert.equal(target % indexPrice, 0n);
  return {id, stream, side, market, target, lots: target / indexPrice, dueMs: id * gapMs};
});
writeFileSync(directory + '/scheduled-offers.json', json({revision, build, placement, gapMs, trace}));
const payers = new Map<string, Keypair>();
const broadcasts = new Map<string, {at: number; locks: ReturnType<typeof transactionLocks>}>();
const isOrder = (label: string) => label.startsWith('contention ');
let venue = '', checkpoints: Awaited<ReturnType<typeof sdk.venueMarketCheckpoints>> = [];
const {h, rpc, ws, checks, flush} = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,
  process.env.RIVALT_WS_URL!, directory, {deferFinality: true, observeOutcomes: isOrder, measureComputeBoundary: isOrder,
    payerFor: label => payers.get(label), computeUnitLimit: label => isOrder(label) ? 800_000 : undefined,
    heapSize: label => isOrder(label) ? 128 * 1024 : undefined,
    beforeBroadcast: async (label, bytes) => {
      if (!isOrder(label)) return;
      assert.equal(accountUserAuthority(bytes, venue, 4, checkpoints, deployment)?.kind, 'accountStateVersion');
      broadcasts.set(label, {locks: transactionLocks(Buffer.from(bytes, 'base64')), at: performance.now()});
    },
  });
let journal: Awaited<ReturnType<typeof openSettlementJournal>> | undefined;
try {
  // An identical index-price book on both markets makes each dollar and fee
  // comparable. Four signed candidates also expose locks on unused makers.
  const regions = [{endLots: 20_000_000n, offset: 0n, slope: 0n}, ...symmetricPayoutShape.asks.slice(1)];
  const setup = await liquidityExecutionSetup(h, rpc, {makerCounts: [4, 4], marketCheckpoints: true,
    marginLayout: 'ledger-lanes', traderCount: participants + 1, independentTraders: true, verifyRejections: false,
    makerCash: 500_000_000_000n, traderCash: 500_000_000_000n,
    shape: () => ({...symmetricPayoutShape, shortCap: 20_000_000n, longCap: 20_000_000n, bids: regions, asks: regions})});
  venue = setup.venue;
  checkpoints = await sdk.venueMarketCheckpoints(setup.venue, true);
  const roles: Record<string,string> = {};
  for (const [market, key] of setup.markets.entries()) {
    const name = market === 0 ? 'BTC' : 'ETH';
    roles[key] = name + ' market';
    roles[setup.ledgers[market]] = name + ' ledger';
    setup.instances.filter(maker => maker.market === key).forEach((maker, id) => {
      roles[maker.capital] = name + ' capital ' + id;
      roles[maker.registration] = name + ' registration ' + id;
    });
  }
  setup.roots.forEach((root, id) => { roles[root] = 'wallet margin ' + id; roles[setup.traderOwners[id].address] = 'payer ' + id; });
  const windows = [];
  for (const wallets of [1, participants]) {
    await setup.qualify();
    await flush();
    const started = performance.now(), elapsed = () => performance.now() - started;
    type Offer = typeof trace[number];
    type Result = Offer & {wallet: number; label: string; readyMs: number; observedMs: number;
      unsigned: string | null};
    const observations: Result[] = [], refreshes: {startMs:number; endMs:number}[] = [];
    let stop = false;
    const maintain = async () => {
      while (!stop) {
        await delay(2000);
        if (stop) break;
        const startMs = elapsed();
        await setup.sample();
        refreshes.push({startMs, endMs: elapsed()});
      }
    };
    const driveWallet = async (lane: number) => {
      const wallet = wallets === 1 ? 0 : 1 + lane;
      const trader = setup.roots[wallet], owner = setup.traderOwners[wallet];
      for (const offer of trace.filter(offer => offer.stream % wallets === lane)) {
        const wait = offer.dueMs - elapsed();
        if (wait > 0) await delay(wait);
        const readyMs = elapsed(), label = 'contention ' + wallets + '/' + offer.id;
        const snapshot = await setup.snapshot(trader, offer.market);
        const fee = (offer.target + 4999n) / 5000n;
        const input = {snapshot, trader, marketIndex: offer.market, side: offer.side, lots: offer.lots,
          maxFee: fee, allInLimit: offer.side === 0 ? offer.target + fee : offer.target - fee};
        let unsigned: string | null = null;
        try {
          const order = await sdk.buildMultiMakerRoute(input, owner.address, 4, deployment);
          assert.deepEqual(order.candidateInstances, [0, 1, 2, 3]);
          payers.set(label, owner);
          await h.send(label, order.instructions, [owner]);
        } catch (error) {
          if (payers.has(label) || !(error instanceof Error) ||
              !['Required liquidity market source unavailable.', 'Order risk window expired.'].includes(error.message)) throw error;
          unsigned = error.message;
        }
        observations.push({...offer, wallet, label, readyMs, observedMs: elapsed(), unsigned});
      }
    };
    const offerTasks = Promise.allSettled(Array.from({length: wallets}, (_, lane) => driveWallet(lane)))
      .finally(() => { stop = true; });
    const [outcomes] = await Promise.all([offerTasks, maintain()]);
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
    await flush();
    const entries = [];
    const blocks = new Map<number, string[]>();
    for (const offer of observations.sort((left, right) => left.id - right.id)) {
      if (offer.unsigned) { entries.push({...offer, signature: null}); continue; }
      const tx = checks.find(check => check.label === offer.label)!;
      assert.equal(tx.signatures, 1);
      assert(tx.ws);
      const signature = String(tx.signature);
      const receipt = await rpc.call('getTransaction', [signature, {encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 1}]);
      assert.deepEqual(receipt.meta.err, tx.error);
      if (!blocks.has(receipt.slot)) {
        const block = await rpc.call('getBlock', [receipt.slot, {transactionDetails: 'signatures', rewards: false,
          commitment: 'finalized', maxSupportedTransactionVersion: 1}]);
        blocks.set(receipt.slot, block.signatures);
      }
      const blockIndex = blocks.get(receipt.slot)!.indexOf(signature);
      assert(blockIndex >= 0);
      let gross = 0n, fee = 0n;
      if (tx.error === null) {
        const events = decodeAccountInvocations(signature, receipt, blockIndex, {venue, domain: setup.domain.toString('hex'),
          program: sdk.CLEARING_PROGRAM_ADDRESS, eventAuthority: setup.deployment.eventAuthority})
          .flatMap(invocation => invocation.events).filter(event => event.type === 'LiquidityRouteFeeRecorded');
        assert.equal(events.length, 1);
        const filled = events[0].data;
        assert.equal(BigInt(filled.lots), offer.lots);
        assert.equal(filled.market, setup.markets[offer.market]);
        assert.equal(filled.side, offer.side);
        assert.equal(filled.trader, setup.roots[offer.wallet]);
        gross = BigInt(filled.grossQuote); fee = BigInt(filled.fee);
        assert.equal(gross, offer.target); assert.equal(fee, (gross + 4999n) / 5000n);
      }
      const broadcast = broadcasts.get(offer.label)!;
      entries.push({...offer, signature, error: tx.error, gross, fee, slot: receipt.slot, broadcastMs: broadcast.at - started,
        locks: broadcast.locks, cu: tx.computeUnits, networkFeeLamports: String(receipt.meta.fee)});
    }
    assert.equal(entries.length, trace.length);
    windows.push({wallets, entries, refreshes});
    writeFileSync(directory + '/contention-windows.json', json({revision, build, placement, gapMs, roles, windows}));
  }
  journal = await openSettlementJournal(rpc, setup, checks.map(row => String(row.signature)), build);
  await journal.checkpoint('wallet-contention', true);
  const {events, reconciliation} = await journal.finish();
  writeFileSync(directory + '/contention-replay.json', json({revision, build, placement, events, reconciliation}));
} finally {
  await journal?.close();
  try { await flush(); } finally { ws.close(); }
}
