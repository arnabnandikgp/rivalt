import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { AccountRole, type Address, type Instruction } from '@solana/kit';
import type { Keypair } from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import { json } from '../../packages/indexer/src/events.js';
import { decodeAccountInvocations } from '../../packages/indexer/src/account-events.js';
import { accountUserAuthority } from '../../packages/services/src/account-ingress.js';
import { openCanonicalRpcHarness } from './canonical-rpc-harness.js';
import { symmetricPayoutShape } from './canonical-maker-cases.js';
import { liquidityExecutionSetup } from './liquidity-execution-setup.js';
import { executionTestHelpers } from './liquidity-execution-helpers.js';
import { openSettlementJournal } from './scalable-settlement-journal.js';
import { routerBuild } from './execution-router-build.js';
import { feasibleBook, type Book, type Order } from './feasible-book-reference.js';

const arm = process.env.RIVALT_FEASIBLE_ARM;
assert(arm === 'wallet' || arm === 'control');
const directory = process.env.RIVALT_RUN_DIR!, build = routerBuild();
const offered = (label: string) => label.startsWith('feasible ');
const feePayers = new Map<string, Keypair>();
let venue: Address, known: Awaited<ReturnType<typeof sdk.venueMarketCheckpoints>>;
const { h, rpc, ws, checks, flush } = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,
  process.env.RIVALT_WS_URL!, directory, {
    deferFinality: true, observeOutcomes: offered, measureComputeBoundary: offered, payerFor: label => feePayers.get(label),
    computeUnitLimit: label => offered(label) ? 800_000 : undefined,
    heapSize: label => offered(label) && label !== 'feasible constrained control' ? 128 * 1024 : undefined,
    beforeBroadcast: async (label, bytes) => {
      if (offered(label)) assert.equal(accountUserAuthority(bytes, venue, 4, known, 'multi-maker')?.kind, 'accountStateVersion');
    },
  });
const makerCount = 10, width = 4, cash = 500_000_000_000n;
const scale = 1_000_000_000n;
type FillLeg = { instance: number; lots: string; gross: string; consumedBefore: string; consumedAfter: string };
type Snapshot = Awaited<ReturnType<typeof sdk.readAccountTradeSnapshot>>;

function readBook(snapshot: Snapshot, trader: Address, index: 0 | 1, side: 0 | 1): Book[] {
  const market = snapshot.marketStates[index];
  assert.equal(sdk.accountSourceMode(snapshot.safetyState, market, snapshot.now, snapshot.slot), 'Normal');
  assert.equal(market.grossLots, 0n);
  for (const root of [snapshot.roots[trader], ...snapshot.liquidity!.adapters.map(maker => maker.capital)]) {
    assert.equal(root.reserved, 0n);
    assert(root.book.orders.every(record => ![1, 2].includes(record.order.state)));
    assert(root.positions.every(position => position.lots === 0n && position.virtualScaled === 0n));
  }
  const makers = snapshot.liquidity!.adapters;
  assert.equal(makers.length, makerCount);
  return makers.map(maker => {
    assert(maker.unavailable === null || maker.unavailable === 'stale-publication');
    assert.equal(maker.shape.skewTick, 0n);
    assert.equal(maker.shape.mode, 1);
    assert.equal(maker.capital.isolatedMarketIndex, index);
    assert.equal(maker.registrationState.buyConsumed + maker.registrationState.sellConsumed, 0n);
    return { id: maker.config.instance, cash: maker.capital.cash, anchor: maker.price.anchor,
      cap: side === 0 ? maker.shape.shortCap : maker.shape.longCap, regions: side === 0 ? maker.shape.asks : maker.shape.bids };
  });
}

let journal: Awaited<ReturnType<typeof openSettlementJournal>> | undefined;
try {
  const setup = await liquidityExecutionSetup(h, rpc, { makerCounts: [makerCount, makerCount], traderCount: 2,
    independentTraders: true, makerCash: cash, traderCash: cash, marginLayout: 'ledger-lanes', marketCheckpoints: true,
    verifyRejections: false, shape: id => {
      const zero = { endLots: 0n, offset: 0n, slope: 0n };
      const asks = id < 6 ? [{ endLots: 200000n, offset: BigInt(45 + 2 * id), slope: 0n }] : [
        { endLots: 40950n, offset: BigInt(id - 4), slope: 0n },
        { endLots: 41450n, offset: BigInt(12 + 5 * (id - 6)), slope: 1n },
        { endLots: 200000n, offset: BigInt(600 + id), slope: 0n },
      ];
      return { ...symmetricPayoutShape, longCap: 200000n, shortCap: 200000n, askCount: asks.length,
        asks: [...asks, ...Array(8 - asks.length).fill(zero)], bids: [
          { endLots: 200000n, offset: BigInt(2 + 2 * id), slope: 0n }, ...Array(7).fill(zero)] };
    } });
  venue = setup.venue;
  known = await sdk.venueMarketCheckpoints(venue, true);
  const { route, guard } = executionTestHelpers(h, setup);
  const prefix = (instruction: Instruction) => [...sdk.marketCheckpointsFor(known, instruction), instruction];
  const results = [];
  // A successful control consumes depth. Try the mixed control only after an
  // atomically rejected full-curve attempt leaves the BTC book untouched.
  let curvedControlExhausted = false;
  for (const scenario of ['curved', 'mixed', 'constrained'] as const) {
    if (scenario === 'mixed' && !curvedControlExhausted) continue;
    const index = scenario === 'constrained' ? 1 : 0;
    const side = index, lots = index === 0 ? 163935n : 100000n;
    const trader = setup.roots[index], owner = setup.traderOwners[index];
    const instances = setup.instances.filter(maker => maker.market === setup.markets[index]);
    if (index === 1) {
      const maker = instances[0];
      const withdrawal = sdk.getWithdrawFundedAccountInstruction({ ...setup.common, btc: setup.markets[0], eth: setup.markets[1],
        owner: maker.owner, margin: maker.capital, userToken: maker.token.address, quoteMint: setup.mint.address,
        amount: cash - 240_000_000n, guard: await guard(maker.capital) });
      await h.send('fund constrained maker with exactly 240 test tokens', prefix(withdrawal), [maker.owner]);
    }
    await setup.sample();
    if (index === 1) await instances[0].publish(setup.updater, 30202n);
    const snapshot = await setup.snapshot(trader, index), market = snapshot.marketStates[index];
    const books = readBook(snapshot, trader, index, side);
    const order: Order = { side, lots, width, lower: market.lower, upper: market.upper, reference: market.referencePrice,
      traderCash: snapshot.roots[trader].cash, limit: lots * market.referencePrice * (side === 0 ? 11n : 9n) / 10n + (side === 0 ? lots * 100n : 0n),
      maxFee: (lots * market.referencePrice * 11n + 49999n) / 50000n };
    const reference = feasibleBook(books, order), best = reference.best;
    assert(best);
    const input: sdk.LiquidityRouteInput = { trader, snapshot, marketIndex: index, side, lots, allInLimit: order.limit, maxFee: order.maxFee, reduceOnly: false };
    const normal = await sdk.buildMultiMakerRoute(input, owner.address, width);
    const scoped = feasibleBook(books.filter(book => normal.candidateInstances.includes(book.id)), order);
    assert(scoped.best);
    let instructions = normal.instructions;
    let signedInstances = normal.candidateInstances;
    if (arm === 'control' && index === 0) {
      // Pass the independently chosen four real bundles to the same multi-route instruction.
      // All quantities are still selected on chain. The generated builder binds the real epochs.
      assert.equal(best.legs.length, 4);
      // Two flat and two curved offers give an executable price comparator
      // if the theoretical optimum is too expensive to search on chain.
      signedInstances = scenario === 'mixed' ? [0, 1, 6, 7] : best.legs.map(leg => leg.id);
      const makers = signedInstances.map(id => snapshot.liquidity!.adapters[id]);
      const epochs = makers.map(maker => ({ authority: maker.registrationState.authorityEpoch,
        control: maker.config.controlEpoch, shape: maker.config.shapeEpoch, depth: maker.registrationState.depthEpoch }));
      const [first, second, third, last] = makers;
      const standing = sdk.getExecuteMultiRouteInstructionDataDecoder().decode(normal.instructions.at(-1)!.data!);
      const ix = await sdk.getExecuteMultiRouteInstructionAsync({ ...setup.common, registry: snapshot.liquidity!.registry,
        market: setup.markets[index], ledger: setup.ledgers[index], actor: owner, trader,
        zeroCapital: first.registrationState.capital, zeroRegistration: first.registration, zeroProgram: first.registrationState.pricingProgram,
        zeroProgramData: first.registrationState.programData, zeroConfig: first.registrationState.config, zeroPrice: first.registrationState.price,
        oneCapital: second.registrationState.capital, oneRegistration: second.registration, oneProgram: second.registrationState.pricingProgram,
        oneProgramData: second.registrationState.programData, oneConfig: second.registrationState.config, onePrice: second.registrationState.price,
        twoCapital: third.registrationState.capital, twoRegistration: third.registration, twoProgram: third.registrationState.pricingProgram,
        twoProgramData: third.registrationState.programData, twoConfig: third.registrationState.config, twoPrice: third.registrationState.price,
        order: { ...standing.order, makerEpochs: epochs.slice(0, 3) }, extraEpochs: epochs.slice(3) });
      const ids = signedInstances;
      instructions = prefix({ ...ix, accounts: [...ix.accounts, { address: last.registrationState.capital, role: AccountRole.WRITABLE },
        { address: last.registration, role: AccountRole.WRITABLE }, ...[last.registrationState.pricingProgram, last.registrationState.programData,
          last.registrationState.config, last.registrationState.price].map(address => ({ address, role: AccountRole.READONLY })),
        ...instances.slice(0, 3).filter((_, lane) => !ids.includes(lane) && ids.some(id => id % 3 === lane))
          .map(maker => ({ address: maker.registration, role: AccountRole.WRITABLE }))] });
    } else if (arm === 'control' && index === 1) {
      assert.equal(best.legs.length, 2);
      assert.equal(best.legs[0].id, 0);
      signedInstances = best.legs.map(leg => leg.id);
      instructions = prefix(await route({ trader, actor: owner, marketIndex: index, side, makers: best.legs.map(leg => instances[leg.id]),
        lots: best.legs.map(leg => leg.lots), allInLimit: order.limit, maxFee: order.maxFee, minimalMarkets: true }));
    }
    const label: string = `feasible ${scenario} ${arm}`;
    const keys = [trader, ...setup.markets, ...setup.ledgers, ...instances.flatMap(maker => [maker.capital, maker.registration])];
    const read = () => Promise.all(keys.map(key => h.read(key)));
    const before = await read();
    feePayers.set(label, owner);
    await h.send(label, instructions, [owner]);
    await flush();
    const tx: Record<string, unknown> = checks.find(row => row.label === label)!;
    assert.equal(tx.signatures, 1);
    let actual: { gross: bigint; fee: bigint; allIn: bigint; legs: FillLeg[] } | null = null;
    if (tx.error === null) {
      const receipt = await rpc.call('getTransaction', [tx.signature, { commitment: 'finalized', encoding: 'json', maxSupportedTransactionVersion: 1 }]);
      const block = await rpc.call('getBlock', [receipt.slot, { commitment: 'finalized', transactionDetails: 'signatures',
        maxSupportedTransactionVersion: 1, rewards: false }]);
      const blockIndex = block.signatures.indexOf(tx.signature);
      assert(blockIndex >= 0);
      const events = decodeAccountInvocations(String(tx.signature), receipt, blockIndex, { program: sdk.CLEARING_PROGRAM_ADDRESS,
        eventAuthority: setup.deployment.eventAuthority, venue, domain: setup.domain.toString('hex') }).flatMap(row => row.events);
      const fills = events.filter(row => ['LiquidityRouteFeeRecorded','LiquidityRouteExecutedV4','MarketLaneFilled'].includes(row.type));
      assert.equal(fills.length, 1);
      const trade = fills[0].data, gross = BigInt(trade.grossQuote), fee = BigInt(trade.fee);
      actual = { gross, fee, allIn: side === 0 ? gross + fee : gross - fee, legs: trade.legs };
      assert.equal(fee, (gross + 4999n) / 5000n);
      assert.equal(lots, actual.legs.reduce((sum, leg) => sum + BigInt(leg.lots), 0n));
      assert(actual.legs.length <= width);
      assert.equal(new Set(actual.legs.map(leg => leg.instance)).size, actual.legs.length);
      assert.equal(actual.legs.reduce((total, leg) => total + BigInt(leg.gross), 0n), gross);
      assert(actual.fee <= order.maxFee && (side === 0 ? actual.allIn <= order.limit : actual.allIn >= order.limit));
      const after = await setup.snapshot(trader, index), direction = side === 0 ? 1n : -1n;
      assert.equal(after.roots[trader].cash, order.traderCash - fee);
      assert.equal(after.roots[trader].positions[index].lots, direction * lots);
      assert.equal(after.roots[trader].positions[index].virtualScaled, -direction * gross * scale);
      for (const [instance, maker] of instances.entries()) {
        const leg: FillLeg | undefined = actual.legs.find(leg => leg.instance === instance);
        if (leg) {
          const quantity: bigint = BigInt(leg.lots);
          assert.equal(BigInt(leg.consumedBefore), 0n);
          assert.equal(BigInt(leg.consumedAfter), quantity);
          const single = feasibleBook([books[instance]], { ...order, lots: quantity, width: 1, limit: side === 0 ? order.limit : 0n });
          assert.equal(single.best?.gross, BigInt(leg.gross));
        }
        const root = after.roots[maker.capital];
        assert.equal(root.cash, books[instance].cash);
        assert.equal(root.positions[index].lots, -direction * BigInt(leg?.lots ?? 0));
        assert.equal(root.positions[index].virtualScaled, direction * BigInt(leg?.gross ?? 0) * scale);
      }
      assert(side === 0 ? actual.allIn >= best.allIn : actual.allIn <= best.allIn);
    } else {
      assert.deepEqual(await read(), before);
      if (arm === 'control' && scenario === 'curved' && tx.computeUnits === 800_000) {
        const receipt = await rpc.call('getTransaction', [tx.signature, { commitment: 'finalized', encoding: 'json', maxSupportedTransactionVersion: 1 }]);
        curvedControlExhausted = receipt.meta.logMessages.some((line: string) => line.includes('exceeded CUs meter'));
      }
    }
    results.push({ label, order, books, reference, scoped, shortlisted: normal.candidateInstances, signedInstances, actual, tx });
    writeFileSync(directory + '/feasible-orders.json', json(results));
    console.log(label, json({ oracle: best.allIn, actual: actual?.allIn, error: tx.error, cu: tx.computeUnits }));
  }
  journal = await openSettlementJournal(rpc, setup, checks.map(row => String(row.signature)), build);
  await journal.checkpoint('feasible-orders', true);
  const replay = await journal.finish();
  writeFileSync(directory + '/feasible-replay.json', json({ revision: build.revision, arm, events: replay.events, reconciliation: replay.reconciliation }));
} finally {
  await journal?.close();
  try { await flush(); } finally { ws.close(); }
}
