import { expect, it } from 'vitest';
import { buildLiquidityRoute, type LiquidityRouteInput } from './liquidity-route.js';
import * as protocol from './generated/index.js';
import { liquidityFixture, testAddress, emptyState } from '../test-support/liquidity-fixture.js';

/** Builder-only synthetic snapshot; live account authentication is a separate
 * RPC acceptance requirement, never established by these fixtures. */
function fixture() {
  const financial = liquidityFixture(), trader = testAddress(70);
  const venue = financial.root.venue, markets = [financial.makers[0].snapshot.market, testAddress(71)];
  for (const market of financial.markets) {
    market.crossEligible = true;
    market.validFrom = 90n; market.validUntil = 250n;
    Object.assign(market.oracle, { sampledAt: 100n, sourceDeadline: 120n, status: 2, validSince: 90n,
      lastQualified: 100n, heldUntil: 106n, heldSlot: 250n, heldEpoch: 1n });
  }
  const snapshot = {
    commitment: 'confirmed', venue, markets, slot: 100n, now: 100n, contextSlot: 100n,
    custody: testAddress(72), safety: testAddress(73), vault: testAddress(74), ledgers: [testAddress(75), testAddress(76)],
    venueState: { ...emptyState(protocol.getVenueDecoder()), schemaVersion: 5, profileVersion: 4,
      domain: financial.makers[0].snapshot.domain, markets, marketCount: 2, insuranceFeeShareBps: 2500, termsEpoch: 1n },
    safetyState: { ...emptyState(protocol.getVenueSafetyDecoder()), schemaVersion: 5, venue, mode: 1, epoch: 1n },
    marketStates: financial.markets, roots: { [trader]: financial.root },
    liquidity: { registry: testAddress(77), adapters: financial.makers },
  } as unknown as LiquidityRouteInput['snapshot'];
  return { financial, input: { snapshot, trader, marketIndex: 0, side: 0, lots: 1n, allInLimit: 20_000n, maxFee: 10n } as LiquidityRouteInput };
}

it('signs caller limits and structural epochs without pinning price sequence or consumption', async () => {
  const { financial, input } = fixture();
  financial.makers[0].price.sequence = 99n;
  financial.makers[0].registrationState.buyConsumed = 10n;
  const built = (await buildLiquidityRoute(input, financial.root.owner))!;
  const parsed = protocol.parseExecuteLiquidityRouteInstruction(built.instructions[0]);
  expect(parsed.data).toMatchObject({ allInLimit: 20_000n, maxFee: 10n, lots: 1n,
    legs: [{ lots: 1n, authorityEpoch: 1n, controlEpoch: 1n, shapeEpoch: 1n, depthEpoch: 1n }] });
  expect(Object.keys(parsed.data.legs[0]).sort()).toEqual(['authorityEpoch', 'controlEpoch', 'depthEpoch', 'lots', 'shapeEpoch']);
  expect(parsed.accounts.secondCapital).toBeUndefined();
  expect(built.instructions).toHaveLength(1);
  expect(built.resourceBudget).toEqual({ computeUnitLimit: 800_000, loadedAccountsDataSizeLimit: 8 * 1024 * 1024 });
});

it('keeps the selected distinct two-maker allocation and caps expiry by every selected publication', async () => {
  const { financial, input } = fixture();
  financial.makers[0].shape = { ...financial.makers[0].shape, asks: [{ endLots: 4096n, offset: 10n, slope: 1n }] };
  financial.makers[1].shape = { ...financial.makers[1].shape, asks: [{ endLots: 4096n, offset: 30n, slope: 0n }] };
  financial.makers[2].shape = { ...financial.makers[2].shape, asks: [{ endLots: 4096n, offset: 40n, slope: 0n }] };
  financial.makers[1].validUntilSlot = 140n;
  const built = (await buildLiquidityRoute({ ...input, lots: 100n, allInLimit: 2_000_000n, maxFee: 1000n }, financial.root.owner))!;
  const parsed = protocol.parseExecuteLiquidityRouteInstruction(built.instructions[0]);
  expect(parsed.data.legs.map(leg => leg.lots)).toEqual([21n, 79n]);
  expect(parsed.data.expirySlot).toBe(140n);
  expect(parsed.accounts.firstCapital.address).toBe(financial.makers[0].registrationState.capital);
  expect(parsed.accounts.secondCapital?.address).toBe(financial.makers[1].registrationState.capital);
});

it('cannot activate custody, paused or historical snapshots and refuses an unrelated actor', async () => {
  for (const mutate of [
    (input: LiquidityRouteInput) => { input.snapshot.safetyState.mode = 0; },
    (input: LiquidityRouteInput) => { input.snapshot.safetyState.paused = true; },
    (input: LiquidityRouteInput) => { input.snapshot.commitment = 'finalized'; },
  ]) {
    const { financial, input } = fixture(); mutate(input);
    await expect(buildLiquidityRoute(input, financial.root.owner)).rejects.toThrow(/confirmed, active/);
  }
  const { input } = fixture();
  await expect(buildLiquidityRoute(input, testAddress(78))).rejects.toThrow(/authority/);
});
