import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {isDeepStrictEqual} from 'node:util';
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
const reportLabel = 'P32 publisher available two-market reports';
const nativeValidator = process.env.RIVALT_CONTENTION_RUNTIME === 'agave';
const signedAt = new Map<string, number>(), acceptedAt = new Map<string, number>();
const blockhashReads = new Map<string, {start: number; end: number}>();
const timedReportSignatures = new Set<string>();
let measuring = false;
const isTimedReport = (label: string) => measuring && label === reportLabel;
const fundingRefusal = (error: unknown) => [1, 3].some(index =>
  isDeepStrictEqual(error, {InstructionError: [index, {Custom: sdk.CLEARING_ERROR__FUNDING_REPORT}]}));
class ReportPreflightRefusal extends Error {
  constructor(readonly signature: string, readonly instructionError: unknown) { super('Funding report preflight refused'); }
}
let venue = '', checkpoints: Awaited<ReturnType<typeof sdk.venueMarketCheckpoints>> = [];
const {h, rpc, ws, checks, flush} = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,
  process.env.RIVALT_WS_URL!, directory, {deferFinality: true, observeOutcomes: label => isOrder(label) || isTimedReport(label), measureComputeBoundary: isOrder,
    finalityTimeoutMs: nativeValidator ? 90_000 : undefined,
    signedOriginal: (label, signature) => {
      if (isOrder(label)) signedAt.set(label, performance.now());
      if (isTimedReport(label)) timedReportSignatures.add(signature);
    },
    broadcastAccepted: label => { if (isOrder(label)) acceptedAt.set(label, performance.now()); },
    blockhashRead: (label, start, end) => { if (isOrder(label)) blockhashReads.set(label, {start, end}); },
    afterSimulation: (label, signature, error) => {
      if (!isTimedReport(label) || error === null) return;
      if (fundingRefusal(error)) throw new ReportPreflightRefusal(signature, error);
      assert.fail('Unexpected funding report preflight error ' + JSON.stringify(error));
    },
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
    refreshDuringSampleInterval: nativeValidator,
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
  for (const wallets of nativeValidator ? [participants] : [1, participants]) {
    await setup.qualify();
    let openingMarkets;
    if (nativeValidator) {
      // Four accepted publications can still have a gap between their holds.
      // Observe both on-chain Normal states before starting the timed arrivals.
      for (let attempt = 0; ; attempt++) {
        const markets = await Promise.all([setup.marketState(0), setup.marketState(1)]);
        if (markets.every(market => market.oracle.status === 2)) {
          openingMarkets = markets.map(({index, oracle}) => ({index, status: oracle.status,
            sampledAt: oracle.sampledAt, heldUntil: oracle.heldUntil, validSince: oracle.validSince}));
          break;
        }
        assert(attempt < 12, 'Could not acquire overlapping qualified funding windows on both markets');
        await setup.sample();
      }
    } else await flush();
    const started = performance.now(), elapsed = () => performance.now() - started;
    type Offer = typeof trace[number];
    type SnapshotRead = {startMs: number; endMs: number; accounts: number; dataBytes: number; programDataBytes: number};
    type Result = Offer & {wallet: number; label: string; readyMs: number; observedMs: number;
      snapshotReads: SnapshotRead[]; snapshotEndMs: number; routeEndMs: number; unsigned: string | null};
    const observations: Result[] = [], refreshes: {startMs:number; endMs:number;
      preflight: {signature:string; error:unknown} | null}[] = [];
    measuring = true;
    let stop = false;
    const maintain = async () => {
      while (!stop) {
        if (!nativeValidator) await delay(2000);
        if (stop) break;
        const startMs = elapsed();
        let preflight = null;
        try { await setup.sample(); } catch (error) {
          if (!(error instanceof ReportPreflightRefusal)) throw error;
          preflight = {signature: error.signature, error: error.instructionError};
        }
        refreshes.push({startMs, endMs: elapsed(), preflight});
      }
    };
    const driveWallet = async (lane: number) => {
      const wallet = wallets === 1 ? 0 : 1 + lane;
      const trader = setup.roots[wallet], owner = setup.traderOwners[wallet];
      for (const offer of trace.filter(offer => offer.stream % wallets === lane)) {
        const wait = offer.dueMs - elapsed();
        if (wait > 0) await delay(wait);
        const readyMs = elapsed(), label = 'contention ' + wallets + '/' + offer.id;
        const snapshotReads: SnapshotRead[] = [];
        // A per-offer wrapper associates concurrent reads with the correct wallet
        // without introducing another RPC call or copying account data.
        const snapshot = await sdk.readAccountTradeSnapshot({async call(method, params) {
          const startMs = elapsed();
          const response = await rpc.call(method, params);
          const endMs = elapsed();
          assert.equal(method, 'getMultipleAccounts');
          let dataBytes = 0, programDataBytes = 0;
          for (const account of response.value) {
            if (!account) continue;
            assert.equal(account.data[1], 'base64');
            const bytes = Buffer.byteLength(account.data[0], 'base64');
            dataBytes += bytes;
            if (account.owner === 'BPFLoaderUpgradeab1e11111111111111111111111' && !account.executable) programDataBytes += bytes;
          }
          snapshotReads.push({startMs, endMs, accounts: response.value.length, dataBytes, programDataBytes});
          return response;
        }}, setup.identity, trader, offer.market);
        const snapshotEndMs = elapsed();
        const fee = (offer.target + 4999n) / 5000n;
        const input = {snapshot, trader, marketIndex: offer.market, side: offer.side, lots: offer.lots,
          maxFee: fee, allInLimit: offer.side === 0 ? offer.target + fee : offer.target - fee};
        let unsigned: string | null = null;
        let routeEndMs: number;
        try {
          const order = await sdk.buildMultiMakerRoute(input, owner.address, 4, deployment);
          routeEndMs = elapsed();
          assert.deepEqual(order.candidateInstances, [0, 1, 2, 3]);
          payers.set(label, owner);
          await h.send(label, order.instructions, [owner]);
        } catch (error) {
          if (payers.has(label) || !(error instanceof Error) ||
              !['Required liquidity market source unavailable.', 'Order risk window expired.'].includes(error.message)) throw error;
          unsigned = error.message;
          routeEndMs = elapsed();
        }
        observations.push({...offer, wallet, label, readyMs, snapshotReads, snapshotEndMs, routeEndMs, observedMs: elapsed(), unsigned});
      }
    };
    const offerTasks = Promise.allSettled(Array.from({length: wallets}, (_, lane) => driveWallet(lane)))
      .finally(() => { stop = true; });
    const [outcomes] = await Promise.all([offerTasks, maintain()]);
    measuring = false;
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
    await flush();
    const entries = [];
    const blocks = new Map<number, string[]>();
    for (const offer of observations.sort((left, right) => left.id - right.id)) {
      if (offer.unsigned) { entries.push({...offer, signature: null}); continue; }
      const tx = checks.find(check => check?.label === offer.label)!;
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
        assert.equal(filled.rootStates[0].owner, setup.traderOwners[offer.wallet].address);
        assert.equal(filled.rootStates[0].subaccountIndex, 0);
        gross = BigInt(filled.grossQuote); fee = BigInt(filled.fee);
        assert.equal(gross, offer.target); assert.equal(fee, (gross + 4999n) / 5000n);
      }
      const broadcast = broadcasts.get(offer.label)!;
      const blockhashRead = blockhashReads.get(offer.label)!;
      entries.push({...offer, signature, error: tx.error, gross, fee, slot: receipt.slot, broadcastMs: broadcast.at - started,
        signedMs: signedAt.get(offer.label)! - started, rpcAcceptedMs: acceptedAt.get(offer.label)! - started,
        blockhashStartMs: blockhashRead.start - started, blockhashEndMs: blockhashRead.end - started,
        locks: broadcast.locks, cu: tx.computeUnits, networkFeeLamports: String(receipt.meta.fee)});
    }
    assert.equal(entries.length, trace.length);
    const reports = checks.filter(check => check?.label === reportLabel && timedReportSignatures.has(String(check.signature)));
    for (const report of reports) assert(report.ws && (report.error === null || fundingRefusal(report.error)),
      'Unexpected finalized maintenance result ' + JSON.stringify(report.error));
    assert.equal(reports.length + refreshes.filter(sample => sample.preflight).length, refreshes.length);
    windows.push({wallets, openingMarkets, entries, refreshes, reports: reports.map(({signature, error}) => ({signature, error}))});
    timedReportSignatures.clear();
    writeFileSync(directory + '/contention-windows.json', json({revision, build, placement, gapMs, roles, windows}));
  }
  journal = await openSettlementJournal(rpc, setup, checks.filter(Boolean).map(row => String(row.signature)), build);
  await journal.checkpoint('wallet-contention', true);
  const {events, reconciliation} = await journal.finish();
  writeFileSync(directory + '/contention-replay.json', json({revision, build, placement, events, reconciliation}));
} finally {
  await journal?.close();
  try { await flush(); } finally { ws.close(); }
}
