import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';
import {routerBuild} from './execution-router-build.js';

const directory = process.env.RIVALT_RUN_DIR!;
const build = routerBuild();
let afterOrderSignature: (() => Promise<void>) | undefined;
const {h,rpc,ws,checks,flush} = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,
  process.env.RIVALT_WS_URL!, directory, {
    deferFinality: true,
    computeUnitLimit: label => label.startsWith('landed router') ? 1_400_000 : undefined,
    heapSize: label => label.startsWith('landed router') ? 128 * 1024 : undefined,
    beforeBroadcast: async label => {
      if (label === 'landed router selects repriced pair') {
        assert(afterOrderSignature);
        await afterOrderSignature();
        afterOrderSignature = undefined;
      }
    },
  });
let journal: Awaited<ReturnType<typeof openSettlementJournal>> | undefined;
try {
  const asks = [...symmetricPayoutShape.asks];
  asks[0] = {endLots: 1n, offset: 2n, slope: 0n};
  asks[1] = {endLots: 4096n, offset: 42n, slope: 0n};
  const setup = await liquidityExecutionSetup(h, rpc, {marketCheckpoints: true, marginLayout: 'ledger-lanes',
    shape: {...symmetricPayoutShape, asks, askCount: 2}, verifyRejections: false});
  await setup.sample();
  const trader = setup.roots[0], actor = setup.traderOwner;
  const buildOrder = async (lots: bigint, allInLimit: bigint) => sdk.buildBestRoute({
    snapshot: await setup.snapshot(trader, 0), trader, marketIndex: 0, side: 0, lots, allInLimit, maxFee: 30n,
  }, actor.address);
  const order = await buildOrder(2n, 120_100n);
  const makers = setup.instances.slice(0, 3);
  const before = await Promise.all(makers.map(maker => maker.registrationState()));
  // Original best is [0,1] at 120004. After this reprice [0,2] costs 119994.
  afterOrderSignature = () => makers[2].publish(setup.updater, 59_990n);
  await h.send('landed router selects repriced pair', order.instructions, [actor]);
  const after = await Promise.all(makers.map(maker => maker.registrationState()));
  assert.deepEqual(after.map((row,index) => row.buyConsumed-before[index].buyConsumed), [1n,0n,1n]);
  const decoded = await setup.snapshot(trader, 0);
  assert.equal(decoded.roots[trader].positions[0].lots, 2n);
  assert.equal(decoded.roots[trader].positions[0].virtualScaled, -119_994n * 1_000_000_000n);
  assert.equal(decoded.roots[trader].cash, 999_976n);
  await setup.sample();
  const publication = makers[1].module.getMakerPriceDecoder().decode((await h.read(makers[1].price))!).state;
  await setup.waitUntil(publication.updatedTime + 6n);
  const oldQuote = await setup.snapshot(trader, 0);
  assert.equal(oldQuote.liquidity!.adapters[1].unavailable, 'stale-publication');
  const standing = await sdk.buildBestRoute({snapshot: oldQuote, trader, marketIndex: 0, side: 0,
    lots: 1n, allInLimit: 60_100n, maxFee: 15n}, actor.address);
  await h.send('landed router fills standing one-lot ask', standing.instructions, [actor]);
  assert.equal((await makers[1].registrationState()).buyConsumed, before[1].buyConsumed + 1n);
  await setup.sample();
  const refusal = await buildOrder(1n, 1n);
  const states = () => Promise.all([trader, ...makers.flatMap(maker => [maker.capital, maker.registration])].map(key => h.read(key)));
  const preRefusal = await states();
  await h.send('landed router refuses trader limit', refusal.instructions, [actor], sdk.CLEARING_ERROR__ROUTE_HEALTH);
  assert.deepEqual(await states(), preRefusal);
  await flush();
  journal = await openSettlementJournal(rpc, setup, checks.map(check => String(check.signature)), build);
  await journal.checkpoint('execution-time-route', true);
  const replay = await journal.finish();
  writeFileSync(`${directory}/execution-router.json`, json({revision:process.env.RIVALT_ROUTER_REVISION,
    results: checks.filter(check => String(check.label).startsWith('landed router')), replay: replay.events}));
} finally {
  await journal?.close();
  try { await flush(); } finally { ws.close(); }
}
