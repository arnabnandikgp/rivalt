import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import type { Keypair } from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import { accountUserAuthority } from '../../packages/services/src/account-ingress.js';
import { decodeAccountInvocations } from '../../packages/indexer/src/account-events.js';
import { json } from '../../packages/indexer/src/events.js';
import { openCanonicalRpcHarness } from './canonical-rpc-harness.js';
import { symmetricPayoutShape } from './canonical-maker-cases.js';
import { liquidityExecutionSetup } from './liquidity-execution-setup.js';
import { executionTestHelpers } from './liquidity-execution-helpers.js';
import { readOffers } from './depth-benchmark-reference.js';
import { compareFlat } from './comparison-reference.js';
import { openSettlementJournal } from './scalable-settlement-journal.js';
import { routerBuild } from './execution-router-build.js';

const count = Number(process.env.RIVALT_COMPARISON_MAKERS),
  width = Number(process.env.RIVALT_COMPARISON_LEGS);
assert([16, 32].includes(count) && [2, 4, 8].includes(width));
const directory = process.env.RIVALT_RUN_DIR!,
  build = routerBuild();
const offered = (label: string) => label.startsWith('compare ');
const payers = new Map<string, Keypair>();
let venue = '',
  known: Awaited<ReturnType<typeof sdk.venueMarketCheckpoints>> = [];
let afterSignature: (() => Promise<void>) | undefined;
const { h, rpc, ws, checks, flush } = await openCanonicalRpcHarness(
  process.env.RIVALT_RPC_URL!,
  process.env.RIVALT_WS_URL!,
  directory,
  {
    deferFinality: true,
    observeOutcomes: offered,
    measureComputeBoundary: offered,
    payerFor: (label) => payers.get(label),
    computeUnitLimit: (label) => (offered(label) ? 800_000 : undefined),
    heapSize: (label) => (offered(label) ? 128 * 1024 : undefined),
    beforeBroadcast: async (label, original) => {
      if (!offered(label)) return;
      assert.equal(accountUserAuthority(original, venue, 4, known, 'multi-maker')?.kind, 'accountStateVersion');
      if (label === 'compare omitted reprice') {
        assert(afterSignature);
        await afterSignature();
        afterSignature = undefined;
      }
    },
  },
);
let journal: Awaited<ReturnType<typeof openSettlementJournal>> | undefined;
try {
  const inputShape = (id: number, deep = false) => {
    const region = (size: bigint) => [
      { endLots: size, offset: 2n + 2n * BigInt(id), slope: 0n },
      ...symmetricPayoutShape.asks.slice(1),
    ];
    return {
      ...symmetricPayoutShape,
      bids: region(deep ? 1_000_000n : id < count / 2 ? 6_000n : 40_000n),
      asks: region(deep ? 1_000_000n : 65_000n),
      shortCap: 8_000_000n,
      longCap: 8_000_000n,
    };
  };
  const setup = await liquidityExecutionSetup(h, rpc, {
    makerCounts: [count, 3],
    marketCheckpoints: true,
    marginLayout: 'ledger-lanes',
    traderCount: 3,
    independentTraders: true,
    makerCash: 500_000_000_000n,
    traderCash: 500_000_000_000n,
    verifyRejections: false,
    shape: (id) => inputShape(id),
  });
  venue = setup.venue;
  known = await sdk.venueMarketCheckpoints(setup.venue, true);
  const reference = 61_000n;
  setup.sourcePrices.btc = reference * 1_000_000n;
  await setup.qualify();
  const makers = setup.instances.slice(0, count);
  const { withCheckpoints } = executionTestHelpers(h, setup);
  const entries: Record<string, unknown>[] = [];
  type Request = { name: string; dollars: number; actor: number };
  async function batch(requests: Request[], side: 0 | 1) {
    await setup.sample();
    const prepared = await Promise.all(
      requests.map(async (request) => {
        const trader = setup.roots[request.actor],
          owner = setup.traderOwners[request.actor];
        const snapshot = await setup.snapshot(trader, 0),
          lots = (BigInt(request.dollars) * 1_000_000n + reference - 1n) / reference;
        const input = {
          trader,
          snapshot,
          lots,
          side,
          marketIndex: 0 as const,
          allInLimit: side === 0 ? lots * (reference + 100n) : lots * (reference - 100n),
          maxFee: (lots * (reference + 100n) + 4999n) / 5000n,
          reduceOnly: false,
        };
        const offers = readOffers(snapshot.liquidity!.adapters, side, true);
        const source = sdk.accountSourceMode(
          snapshot.safetyState,
          snapshot.marketStates[0],
          snapshot.now,
          snapshot.slot,
        );
        if (source !== 'Normal') {
          // The wallet rejects risk-increasing orders in this observed source mode.
          await assert.rejects(
            width === 2
              ? sdk.buildBestRoute(input, owner.address)
              : sdk.buildMultiMakerRoute(input, owner.address, width),
            /Required liquidity market source unavailable/,
          );
          entries.push({
            name: request.name,
            side,
            requestedLots: lots,
            requestedIndexAtoms: lots * reference,
            supplied: [],
            classification: 'unsigned source ' + source,
            unrestricted: compareFlat(offers, side, lots, count),
            bounded: compareFlat(offers, side, lots, width),
            shortlisted: null,
            actual: null,
            missedAcrossDirectoryAtoms: null,
            batchSize: requests.length,
            batchConfirmedMs: null,
            confirmedMs: null,
            cu: null,
            bytes: 0,
            accounts: 0,
            feeLamports: '0',
            signature: null,
            error: source,
            slot: snapshot.slot,
            blockIndex: null,
          });
          return null;
        }
        const order =
          width === 2
            ? await sdk.buildBestRoute(input, owner.address)
            : await sdk.buildMultiMakerRoute(input, owner.address, width);
        const label = 'compare ' + request.name;
        payers.set(label, owner);
        return { request, trader, owner, label, lots, order, offers };
      }),
    );
    const submissions = prepared.filter((row) => row !== null);
    if (!submissions.length) return;
    let book = submissions[0].offers.map((offer) => ({ ...offer }));
    for (const row of submissions) assert.deepEqual(row.offers, book);
    if (requests[0].name === 'omitted reprice')
      afterSignature = async () => {
        assert(!submissions[0].order.candidateInstances.includes(count - 1));
        await makers[count - 1].publish(setup.updater, reference - BigInt(2 * count + 25));
        book[count - 1].price = reference - 25n;
      };
    const started = performance.now();
    await Promise.all(submissions.map((row) => h.send(row.label, row.order.instructions, [row.owner])));
    const confirmedMs = performance.now() - started;
    await flush();
    const transactions = await Promise.all(
      submissions.map(async (row) => {
        const tx = checks.find((info) => info.label === row.label)!;
        assert.equal(tx.signatures, 1);
        const original = await rpc.call('getTransaction', [
          tx.signature,
          { commitment: 'finalized', encoding: 'json', maxSupportedTransactionVersion: 1 },
        ]);
        const block = await rpc.call('getBlock', [
          original.slot,
          {
            commitment: 'finalized',
            encoding: 'json',
            transactionDetails: 'full',
            rewards: false,
            maxSupportedTransactionVersion: 1,
          },
        ]);
        const index = block.transactions.findIndex(
          (item: { transaction: { signatures: string[] } }) => item.transaction.signatures[0] === tx.signature,
        );
        assert(index >= 0);
        return { row, tx, original, index };
      }),
    );
    transactions.sort((a, b) => a.original.slot - b.original.slot || a.index - b.index);
    for (const { row, tx, original, index } of transactions) {
      const submitted = book.filter((offer) => row.order.candidateInstances.includes(offer.id));
      const unrestricted = compareFlat(book, side, row.lots, count),
        bounded = compareFlat(book, side, row.lots, width);
      const shortlisted = compareFlat(submitted, side, row.lots, width);
      let actual: { gross: bigint; fee: bigint; allIn: bigint; legs: any[] } | null = null;
      if (original.meta.err === null) {
        const invocations = decodeAccountInvocations(String(tx.signature), original, index, {
          venue,
          domain: setup.domain.toString('hex'),
          program: sdk.CLEARING_PROGRAM_ADDRESS,
          eventAuthority: setup.deployment.eventAuthority,
        });
        const matches = invocations
          .flatMap((value) => value.events)
          .filter((event) => event.type === 'LiquidityRouteFeeRecorded');
        assert.equal(matches.length, 1);
        const event = matches[0].data,
          gross = BigInt(event.grossQuote),
          fee = BigInt(event.fee);
        actual = { gross, fee, allIn: side === 0 ? gross + fee : gross - fee, legs: event.legs };
        assert(shortlisted);
        assert.equal(actual.allIn, shortlisted.allIn);
        assert.equal(BigInt(event.lots), row.lots);
        assert.equal(fee, (gross + 4999n) / 5000n);
        for (const leg of event.legs) {
          const offer = book[leg.instance];
          assert(offer.depth >= BigInt(leg.lots));
          assert.equal(offer.price * BigInt(leg.lots), BigInt(leg.gross));
          offer.depth -= BigInt(leg.lots);
        }
      }
      const classification = actual
        ? 'filled'
        : !unrestricted
          ? 'insufficient published depth'
          : !bounded
            ? 'insufficient depth at leg limit'
            : !shortlisted
              ? 'shortlist omitted feasible depth'
              : 'feasible quoted route refused';
      entries.push({
        name: row.request.name,
        side,
        requestedLots: row.lots,
        requestedIndexAtoms: row.lots * reference,
        slot: original.slot,
        blockIndex: index,
        supplied: row.order.candidateInstances,
        classification,
        unrestricted,
        bounded,
        shortlisted,
        actual,
        missedAcrossDirectoryAtoms:
          actual && unrestricted
            ? side === 0
              ? actual.allIn - unrestricted.allIn
              : unrestricted.allIn - actual.allIn
            : null,
        batchSize: requests.length,
        batchConfirmedMs: confirmedMs,
        confirmedMs: tx.signedToConfirmedMs,
        cu: tx.computeUnits,
        bytes: tx.bytes,
        accounts: tx.loadedAccounts,
        feeLamports: tx.feeLamports,
        error: original.meta.err,
        signature: tx.signature,
      });
    }
  }
  await batch([{ name: 'omitted reprice', dollars: 100, actor: 0 }], 0);
  await batch([{ name: 'fragmented 5000', dollars: 5000, actor: 0 }], 0);
  await batch([{ name: 'fragmented 10000', dollars: 10000, actor: 0 }], 0);
  await batch([{ name: 'fragmented 20000', dollars: 20000, actor: 0 }], 0);
  await batch([{ name: 'thin bids', dollars: 10000, actor: 1 }], 1);
  // The unchanged book offers 6,000 lots per shallow maker and 40,000 per deep maker.
  // The pre-change independent reference found four of each for the eight-leg sell.
  const thinSale = entries.at(-1)!;
  assert.equal(thinSale.name, 'thin bids');
  assert.equal(thinSale.classification, width === 8 ? 'filled' : 'insufficient depth at leg limit');
  if (width === 8) {
    const firstDeep = count / 2;
    assert.deepEqual(thinSale.supplied, [0, 1, 2, 3, firstDeep, firstDeep + 1, firstDeep + 2, firstDeep + 3]);
    const sale = thinSale.actual as { allIn: bigint; legs: { lots: string }[] };
    assert.deepEqual(sale.legs.map(leg => BigInt(leg.lots)), [6000n, 6000n, 6000n, 6000n, 40000n, 40000n, 40000n, 19935n]);
    assert.equal(sale.allIn, count === 32 ? 9_992_798_640n : 9_995_037_152n);
  }
  const deep = makers[count - 1],
    registration = await deep.registrationState(),
    config = await deep.state();
  await h.send(
    'replace last maker with deep book',
    await withCheckpoints(
      sdk.getControlLiquidityInstruction({
        ...deep.controlCommon,
        expectedAuthority: registration.authorityEpoch,
        expectedControl: config.controlEpoch,
        expectedShape: config.shapeEpoch,
        action: { __kind: 'Shape', fields: [inputShape(count - 1, true)] },
      }),
    ),
    [deep.owner],
  );
  await setup.qualify();
  await batch([{ name: 'deep replacement', dollars: 20000, actor: 2 }], 0);
  for (const maker of makers.slice(0, 2)) {
    const state = await maker.registrationState();
    await h.send(
      'replenish consumed quote',
      await withCheckpoints(
        sdk.getReplenishLiquidityInstruction({
          ...maker.controlCommon,
          expectedAuthority: state.authorityEpoch,
          expectedDepth: state.depthEpoch,
          sides: 3,
        }),
      ),
      [maker.owner],
    );
  }
  await batch(
    [
      { name: 'immediately after replenishment A', dollars: 5000, actor: 1 },
      { name: 'immediately after replenishment B', dollars: 5000, actor: 2 },
    ],
    0,
  );
  await setup.qualify();
  await batch(
    [
      { name: 'concurrent wallet A', dollars: 5000, actor: 1 },
      { name: 'concurrent wallet B', dollars: 5000, actor: 2 },
    ],
    0,
  );
  journal = await openSettlementJournal(
    rpc,
    setup,
    checks.map((row) => String(row.signature)),
    build,
  );
  await journal.checkpoint('matched-market-orders', true);
  const replay = await journal.finish();
  writeFileSync(
    directory + '/comparison.json',
    json({
      revision: build.revision,
      count,
      width,
      entries,
      events: replay.events,
      reconciliation: replay.reconciliation,
    }),
  );
  console.log(
    entries.map((row) => [row.name, row.classification]),
    replay.events,
    'replayed',
  );
} finally {
  await journal?.close();
  try {
    await flush();
  } finally {
    ws.close();
  }
}
