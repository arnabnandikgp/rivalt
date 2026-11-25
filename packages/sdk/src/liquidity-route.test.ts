import { expect, it } from 'vitest';
import { buildLiquidityRoute, buildMakerLiquidation, type LiquidityRouteInput } from './liquidity-route.js';
import { makerDepth } from './maker-shortlist.js';
import * as protocol from './generated/index.js';
import { liquidityFixture, testAddress, emptyState } from '../test-support/liquidity-fixture.js';

/** Builder-only synthetic snapshot; live account authentication is a separate
 * RPC acceptance requirement, never established by these fixtures. */
function parseSerial(instruction:NonNullable<Awaited<ReturnType<typeof buildLiquidityRoute>>>['instructions'][number]) {
  expect(instruction.data.slice(0,8)).toEqual(protocol.EXECUTE_LIQUIDITY_ROUTE_DISCRIMINATOR);
  return protocol.parseExecuteLiquidityRouteInstruction(instruction as Awaited<ReturnType<typeof protocol.getExecuteLiquidityRouteInstructionAsync>>);
}
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
    venueState: { ...emptyState(protocol.getVenueDecoder()), schemaVersion: 10, profileVersion: 6,
      domain: financial.makers[0].snapshot.domain, markets, marketCount: 2, insuranceFeeShareBps: 2500, termsEpoch: 1n },
    safetyState: { ...emptyState(protocol.getVenueSafetyDecoder()), schemaVersion: 10, venue, mode: 1, epoch: 1n },
    marketStates: financial.markets, roots: { [trader]: financial.root,
      ...Object.fromEntries(financial.makers.map(maker => [maker.registrationState.capital, maker.capital])) },
    liquidity: { registry: testAddress(77), adapters: financial.makers },
  } as unknown as LiquidityRouteInput['snapshot'];
  return { financial, input: { snapshot, trader, marketIndex: 0, side: 0, lots: 1n, allInLimit: 20_000n, maxFee: 10n } as LiquidityRouteInput };
}

it('signs caller limits and structural epochs without pinning price sequence or consumption', async () => {
  const { financial, input } = fixture();
  financial.makers[0].price.sequence = 99n;
  financial.makers[0].registrationState.buyConsumed = 10n;
  const built = (await buildLiquidityRoute(input, financial.root.owner))!;
  const parsed = parseSerial(built.instructions[0]);
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
  const parsed = parseSerial(built.instructions[0]);
  expect(parsed.data.legs.map(leg => leg.lots)).toEqual([21n, 79n]);
  expect(parsed.data.expirySlot).toBe(140n);
  expect(parsed.accounts.firstCapital.address).toBe(financial.makers[0].registrationState.capital);
  expect(parsed.accounts.secondCapital?.address).toBe(financial.makers[1].registrationState.capital);
  // Expiry is allocation-dependent: a smaller route need not include the
  // short-lived second maker, so workers must not treat it as size-independent.
  const smaller = (await buildLiquidityRoute(input, financial.root.owner))!;
  expect(smaller.allocation.legs).toHaveLength(1);
  expect(smaller.allocation.legs[0].registration).toBe(financial.makers[0].registration);
  expect(smaller.expirySlot).toBe(250n);
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

it('permits a keeper to reduce only a distressed target and rejects each adverse maker leg', async () => {
  const {financial,input}=fixture(),{snapshot,trader}=input;
  const outsider=testAddress(78),position=financial.root.positions[0];
  Object.assign(position,{lots:20n,virtualScaled:-200_000n*1_000_000_000n,generation:3n});
  // Conservative equity = 12,000 - 2,000 = 10,000; maintenance = 10,100.
  // A single lot restores health. A two-lot forced fill goes past that point.
  financial.root.cash=12_000n;
  expect(await buildMakerLiquidation(snapshot,trader,0,2n,outsider)).toBeNull();
  const fill=await buildMakerLiquidation(snapshot,trader,0,1n,outsider);
  expect(fill!.instructions[0].data.slice(0,8)).toEqual(protocol.LIQUIDATE_LIQUIDITY_ROUTE_DISCRIMINATOR);
  const parsed=protocol.parseLiquidateLiquidityRouteInstruction(fill!.instructions[0] as Awaited<ReturnType<typeof protocol.getLiquidateLiquidityRouteInstructionAsync>>);
  expect(parsed.data).toMatchObject({side:1,reduceOnly:true,generation:{__option:'Some',value:3n},lots:1n,allInLimit:9988n,maxFee:2n});
  expect(parsed.accounts.actor.address).toEqual(outsider);
  await expect(buildLiquidityRoute({...input,side:1,allInLimit:0n},outsider)).rejects.toThrow(/authority/);
  for(const maker of financial.makers)maker.shape={...maker.shape,bids:[{endLots:4096n,offset:101n,slope:0n}]};
  expect(await buildMakerLiquidation(snapshot,trader,0,1n,outsider)).toBeNull();
  financial.root.cash=12_500n;
  for(const maker of financial.makers)maker.shape={...maker.shape,bids:[{endLots:4096n,offset:1n,slope:0n}]};
  expect(await buildMakerLiquidation(snapshot,trader,0,1n,outsider)).toBeNull();
});

it('covers a short with two one-lot asks and refuses to average in an out-of-bound leg', async () => {
  const {financial,input}=fixture(),{snapshot,trader}=input,keeper=testAddress(79);
  Object.assign(financial.root.positions[0],{lots:-20n,virtualScaled:200_000n*1_000_000_000n,generation:4n});
  // Equity starts at 10,000 − 2,000 = 8,000. A two-lot close at 10,010
  // costs five fee atoms and adds 175 equity, below the remaining 9,090 MM.
  financial.root.cash=10_000n;
  for(const maker of financial.makers)maker.shape={...maker.shape,asks:[{endLots:1n,offset:10n,slope:0n}]};
  financial.makers[2].unavailable='disabled';
  const cover=await buildMakerLiquidation(snapshot,trader,0,2n,keeper);
  expect(cover?.allocation.legs.map(leg=>leg.lots)).toEqual([1n,1n]);
  expect(cover?.allocation.grossQuote).toBe(20_020n);
  financial.makers[1].shape={...financial.makers[1].shape,asks:[{endLots:1n,offset:101n,slope:0n}]};
  expect(await buildMakerLiquidation(snapshot,trader,0,2n,keeper)).toBeNull();
});

it('selects a direct ledger-lane fill only while its held window and maker capacity cover the trade',async()=>{
  const {financial,input}=fixture();
  input.snapshot.marginLayout='ledger-lanes';
  const state=input.snapshot.marketStates[0];
  const capacity={generation:1n,available:[10n,10n,10n]};
  Object.assign(state,{capacity});
  const tag=async()=>(await buildLiquidityRoute(input,financial.root.owner))!.instructions[0].data.slice(0,8);
  expect(await tag()).toEqual(protocol.EXECUTE_LEDGER_LANE_DISCRIMINATOR);
  capacity.available.fill(0n);
  expect(await tag()).toEqual(protocol.EXECUTE_LIQUIDITY_ROUTE_DISCRIMINATOR);
  capacity.available.fill(10n);state.oracle.heldSlot=input.snapshot.slot;
  expect(await tag()).toEqual(protocol.EXECUTE_LIQUIDITY_ROUTE_DISCRIMINATOR);
});


it('estimates funded depth through inventory reductions, standing prices and consumed lots', () => {
  const { financial, input } = fixture();
  const maker = financial.makers[0];
  maker.capital.cash = 3030n; // Three new lots at the upper risk price of 10,100 and 10% IM.
  maker.capital.positions[0].lots = 2n;
  maker.unavailable = 'stale-publication';
  const order = { ...input, lots: 100n };
  expect(makerDepth(order, maker).quantity).toBe(5n);
  maker.registrationState.buyConsumed = 4094n;
  expect(makerDepth(order, maker).quantity).toBe(2n);
  maker.capital.positions[0].lots = -2n;
  expect(makerDepth({ ...order, side: 1 }, maker).quantity).toBe(5n);
  maker.shape = { ...maker.shape, mode: 3 };
  expect(makerDepth({ ...order, side: 1 }, maker).quantity).toBe(2n);
  maker.unavailable = 'quarantined';
  expect(makerDepth({ ...order, side: 1 }, maker).quantity).toBe(0n);
});

it('keeps the valid prefix of a curved book and excludes a wholly off-band or self-owned book', () => {
  const { financial, input } = fixture();
  const maker = financial.makers[0];
  const curve = [{ endLots: 40n, offset: 0n, slope: 800n }];
  maker.shape = { ...maker.shape, asks: curve, bids: curve };
  for (const side of [0, 1] as const) {
    const order = { ...input, side, lots: 40n };
    // At three lots the average is 10,800 or 9,200. At four it is 11,200 or 8,800.
    expect(makerDepth(order, maker)).toEqual({ id: 0, quantity: 3n, gross: side === 0 ? 32400n : 27600n });
  }
  maker.price.anchor = 8500n;
  // A cheap first lot can enter the collar only at a larger average size.
  expect(makerDepth(input, maker).quantity).toBe(0n);
  expect(makerDepth({ ...input, lots: 4n }, maker).gross).toBe(38800n);
  maker.price.anchor = 12000n;
  expect(makerDepth(input, maker).quantity).toBe(0n);
  maker.price.anchor = 10000n;
  maker.capital.owner = financial.root.owner;
  expect(makerDepth(input, maker).quantity).toBe(0n);
});
