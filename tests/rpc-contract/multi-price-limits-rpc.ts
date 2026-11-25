import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {accountUserAuthority} from '../../packages/services/src/account-ingress.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {multiDeploymentFor, routerBuild} from './execution-router-build.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';

const directory = process.env.RIVALT_RUN_DIR!, build = routerBuild();
const deployment = multiDeploymentFor(build.artifactSet);
assert.equal(deployment, 'price-limited-multi-maker');
const isOrder = (label: string) => label.startsWith('price limit ');
const payers = new Map<string, Keypair>();
let venue = '', checkpoints: Awaited<ReturnType<typeof sdk.venueMarketCheckpoints>> = [];
const {h, rpc, ws, checks, flush} = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,
  process.env.RIVALT_WS_URL!, directory, {
    deferFinality: true, observeOutcomes: isOrder, measureComputeBoundary: isOrder,
    payerFor: label => payers.get(label), computeUnitLimit: label => isOrder(label) ? 800_000 : undefined,
    heapSize: label => isOrder(label) ? 128 * 1024 : undefined,
    beforeBroadcast: async (label, bytes) => {
      if (isOrder(label)) assert.equal(accountUserAuthority(bytes, venue, 4, checkpoints, deployment)?.kind, 'accountStateVersion');
    },
  });
let journal: Awaited<ReturnType<typeof openSettlementJournal>> | undefined;
try {
  const regions = [{endLots: 100n, offset: 0n, slope: 0n}, ...symmetricPayoutShape.asks.slice(1)];
  const setup = await liquidityExecutionSetup(h, rpc, {makerCounts: [4, 4], marketCheckpoints: true,
    marginLayout: 'ledger-lanes', traderCount: 2, independentTraders: true, verifyRejections: false,
    makerCash: 500_000_000_000n, traderCash: 500_000_000_000n,
    shape: () => ({...symmetricPayoutShape, shortCap: 100n, longCap: 100n, bids: regions, asks: regions})});
  venue = setup.venue;
  checkpoints = await sdk.venueMarketCheckpoints(setup.venue, true);
  const results = [];
  for (const side of [0, 1] as const) {
    const makers = setup.instances.filter(maker => maker.market === setup.markets[side]);
    const trader = setup.roots[side], owner = setup.traderOwners[side];
    // The first BTC ask is outside the execution collar. The first ETH bid
    // would push the rounded aggregate fee one atom above the signed ceiling.
    const price = side === 0 ? 60_000n : 30_000n, exceptional = side === 0 ? 53_000n : 30_001n;
    await setup.sample();
    await makers[0].publish(setup.updater, exceptional);
    const snapshot = await setup.snapshot(trader, side);
    assert.equal(snapshot.marketStates[side].referencePrice, price);
    const gross = 300n * price, fee = gross / 5_000n;
    const limit = side === 0 ? gross + fee : gross - fee;
    const keys = [trader, ...setup.markets, ...setup.ledgers, ...makers.flatMap(maker => [maker.registration, maker.capital])];
    const read = () => Promise.all(keys.map(key => h.read(key)));
    const before = await read();
    for (const tighter of [true, false]) {
      const label = 'price limit ' + (side === 0 ? 'BTC collar' : 'ETH fee') + (tighter ? ' tight' : ' exact');
      const allInLimit = limit + (tighter ? (side === 0 ? -1n : 1n) : 0n);
      const order = await sdk.buildMultiMakerRoute({snapshot, marketIndex: side, side, trader,
        lots: 300n, maxFee: fee, allInLimit}, owner.address, 4, deployment);
      assert.deepEqual(order.candidateInstances, [0, 1, 2, 3]);
      payers.set(label, owner);
      await h.send(label, order.instructions, [owner]);
      await flush();
      const tx = checks.find(row => row.label === label)!;
      assert.equal(tx.signatures, 1);
      if (tighter) {
        assert.deepEqual(tx.error, {InstructionError: [2, {Custom: 6120}]});
        assert.deepEqual(await read(), before);
      } else {
        assert.equal(tx.error, null, label);
        const after = await setup.snapshot(trader, side);
        const signedLots = side === 0 ? 300n : -300n;
        const root = after.roots[trader];
        assert.equal(root.positions[side].lots, signedLots);
        assert.equal(root.positions[side].virtualScaled, -signedLots * price * 1_000_000_000n);
        assert.equal(root.cash, snapshot.roots[trader].cash - fee);
        for (const [id, maker] of makers.entries()) {
          const registration = await maker.registrationState();
          const lots = id === 0 ? 0n : 100n;
          assert.equal(side === 0 ? registration.buyConsumed : registration.sellConsumed, lots);
          assert.equal(after.roots[maker.capital].positions[side].lots, side === 0 ? -lots : lots);
        }
      }
      results.push({label, allInLimit, fee, tx});
    }
  }
  journal = await openSettlementJournal(rpc, setup, checks.map(row => String(row.signature)), build);
  await journal.checkpoint('wide-price-limits', true);
  const {events, reconciliation} = await journal.finish();
  writeFileSync(directory + '/price-limits.json', json({build, results, events, reconciliation}));
  console.log(results.map(row => [row.label, row.tx.error, row.tx.computeUnits]), events);
} finally {
  await journal?.close();
  try { await flush(); } finally { ws.close(); }
}
