import assert from 'node:assert/strict';
import * as sdk from '@rivalt/sdk';
import type { CanonicalHarness } from './canonical-maker-cases.js';
import type { liquidityExecutionSetup } from './liquidity-execution-setup.js';
import { executionTestHelpers } from './liquidity-execution-helpers.js';

export const pricePolicyShape = {
  mode: 1, ttlSlots: 150, target: 0n, skewStep: 1n, skewTick: 0n,
  longCap: 3_100_000n, shortCap: 3_100_000n, bidCount: 1, askCount: 1,
  bids: [{ endLots: 3_100_000n, offset: 0n, slope: 0n }, ...Array.from({ length: 7 }, () => ({ endLots: 0n, offset: 0n, slope: 0n }))],
  asks: [{ endLots: 3_100_000n, offset: 0n, slope: 0n }, ...Array.from({ length: 7 }, () => ({ endLots: 0n, offset: 0n, slope: 0n }))],
};

/** Actual signed effects before the common finalized/restart/fresh-PG check.
 * Flat canonical curves make expected fills/fees independent literal vectors. */
export async function pricePolicyCases(h: CanonicalHarness, setup: Awaited<ReturnType<typeof liquidityExecutionSetup>>) {
  const { root, guard, route } = executionTestHelpers(h, setup), owner = setup.traderOwner, margin = setup.roots[0];
  const vectors = [
    { reference: 2n, lots: 500n, lower: 1n, upper: 3n, gross: 1_000n, fee: 1n, sample: 3_000_000n },
    { reference: 9_999n, lots: 1n, lower: 9_899n, upper: 10_099n, gross: 9_999n, fee: 2n, sample: 601n },
    { reference: 100_001n, lots: 1n, lower: 99_000n, upper: 101_002n, gross: 100_001n, fee: 21n, sample: 60n },
    { reference: 909_090n, lots: 1n, lower: 899_999n, upper: 918_181n, gross: 909_090n, fee: 182n, sample: 7n },
  ];
  for (const marketIndex of [0, 1] as const) for (const vector of vectors) {
    if (marketIndex === 0) setup.sourcePrices.btc = vector.reference * 1_000_000n;
    else setup.sourcePrices.eth = vector.reference * 100_000n;
    await setup.qualify();
    const market = await setup.marketState(marketIndex);
    assert.deepEqual([market.referencePrice, market.lower, market.upper, market.oracle.quantity],
      [vector.reference, vector.lower, vector.upper, vector.sample]);
    const before = await root(margin);
    for (const side of [0, 1] as const) {
      const current = await root(margin);
      await h.send(`P53B route market ${marketIndex} reference ${vector.reference} side ${side}`, [await route({
        trader: margin, actor: owner, marketIndex, side, makers: [setup.instances[marketIndex * 3]], lots: [vector.lots],
        reduceOnly: side === 1, generation: side === 1 ? current.positions[marketIndex].generation : undefined,
        allInLimit: side === 0 ? vector.gross + vector.fee : vector.gross - vector.fee, maxFee: vector.fee,
      })], [owner]);
    }
    const after = await root(margin);
    assert.equal(after.positions[marketIndex].lots, 0n);
    assert.equal(after.positions[marketIndex].virtualScaled, 0n);
    assert.equal(before.cash - after.cash, 2n * vector.fee);
  }
  for (const ledger of setup.ledgers) {
    const state = sdk.getMarketLedgerDecoder().decode((await h.read(ledger))!);
    // Two round trips' four bands: 2 * (1 + 2 + 21 + 182) = 412 per market.
    assert.deepEqual([state.insurance, state.fees, state.insuranceFeeRemainder], [103n, 309n, 0]);
  }
  setup.sourcePrices.btc = 60_000_000_000n; setup.sourcePrices.eth = 3_000_000_000n;
  await setup.qualify();
  const common = { ...setup.common, owner, margin, btc: setup.markets[0], eth: setup.markets[1] };
  const withdraw = async () => sdk.getWithdrawFundedAccountInstruction({ ...common, guard: await guard(margin),
    quoteMint: setup.mint.address, userToken: setup.traderToken.address, amount: 10n });
  const deposit = () => sdk.getDepositAccountInstructionAsync({ ...common, quoteMint: setup.mint.address,
    userToken: setup.traderToken.address, amount: 10n });
  const manage = async (operation: sdk.OrderActionArgs) => sdk.getManageAccountOrderInstruction({ ...common, actor: owner,
    guard: await guard(margin), marketIndex: 0, operation });
  await h.send('P53B fund source-failure deposit from actual withdrawal', [await withdraw()], [owner]);
  const slot = await setup.slot();
  const terms = { side: 0, lots: 1n, limit: 1n, feeBudget: 1n, startSlot: slot, expirySlot: slot + 20_000n,
    trigger: 1, threshold: 2n, reduceOnly: false, generation: 0n };
  for (const invalid of [{ ...terms, limit: 0n }, { ...terms, limit: 1_000_001n },
    { ...terms, threshold: 1n }, { ...terms, threshold: 909_091n }]) {
    const before = await root(margin);
    await h.send('P53B rejects out-of-domain stored terms', [await manage({ __kind: 'Place',
      expectedId: before.book.lastOrderId + 1n, terms: invalid })], [owner], sdk.CLEARING_ERROR__ORDER_TERMS);
    assert.deepEqual(await root(margin), before);
  }
  for (const valid of [terms, { ...terms, side: 1, limit: 1_000_000n, threshold: 909_090n }]) {
    await h.send('P53B accepts inclusive stored limit and trigger edge', [await manage({ __kind: 'Place',
      expectedId: (await root(margin)).book.lastOrderId + 1n, terms: valid })], [owner]);
  }
  const orders = (await root(margin)).book.orders.filter(entry => entry.order.state === 1 || entry.order.state === 2);
  assert.equal(orders.length, 2);
  // Let real Clock expire all sources. A deposit and owner cancellation remain
  // reachable; the surviving buy reserves against the whole numeric interval.
  const expiryStart = await setup.now();
  // Each existing waiter is bounded at 20 seconds; retain that deadline while
  // advancing actual Clock past the unchanged 20-second source age.
  await setup.waitUntil(expiryStart + 11n);
  await setup.waitUntil(expiryStart + 21n);
  await h.send('P53B actual deposit without sources', [await deposit()], [owner]);
  for (const entry of [...orders].reverse()) {
    await h.send('P53B cancellation without sources', [await manage({ __kind: 'Cancel', id: entry.order.id,
      version: entry.order.version, protectionGroup: false })], [owner]);
    const remaining = await root(margin);
    if (entry === orders[1]) assert.equal(remaining.reserved, 100_001n);
    else assert.equal(remaining.reserved, 0n);
  }
  await h.send('P53B flat funded exit without sources', [await withdraw()], [owner]);
  await h.send('P53B restore actual collateral after exit', [await deposit()], [owner]);
  await setup.qualify();
  return { vectors, roundTrips: 8, feesPerMarket: 412n };
}
