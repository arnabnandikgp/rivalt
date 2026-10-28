import { expect,it } from 'vitest';
import { allocateLiquidityRoute } from './liquidity-allocation.js';
import { liquidityFixture } from '../test-support/liquidity-fixture.js';

const SCALE = 1_000_000_000n;
const allocate = (input: Parameters<typeof allocateLiquidityRoute>[0]) => allocateLiquidityRoute(input).allocation;
it('searches every singleton/pair, keeps exact size and deterministic instance ties independent of program identity',() => {
  const { input,makers } = liquidityFixture();
  expect(allocate(input)).toMatchObject({ grossQuote: 10010n,fee: 3n,legs: [{ instance: 0,lots: 1n }] });
  makers[0].shape = { ...makers[0].shape,asks: [{ endLots: 4096n,offset: 10n,slope: 1n }] };
  makers[1].shape = { ...makers[1].shape,asks: [{ endLots: 4096n,offset: 30n,slope: 0n }] };
  makers[2].shape = { ...makers[2].shape,asks: [{ endLots: 4096n,offset: 40n,slope: 0n }] };
  const result = allocate({ ...input,lots: 100n });
  // Sum 21*10010 + (0+...+20) + 79*10030. At equal cost choose 21 over 20 for instance 0.
  expect(result).toMatchObject({ grossQuote: 1_002_790n,fee: 201n,allIn: 1_002_991n,
    legs: [{ instance: 0,lots: 21n },{ instance: 1,lots: 79n }] });
  expect(allocate({ ...input,lots: 100n,makers: [makers[2],makers[0],makers[1]] })).toEqual(result);
  makers[2].price.anchor = 9990n;
  expect(allocate({ ...input,lots: 100n })!.legs.map(leg => leg.instance)).toEqual([0,1]); // Same price, lexicographic pair.
});
it('uses funded cash, fractional negative claims and all-market pending funding without positive profit credit',() => {
  const { input,root } = liquidityFixture();root.cash = 1123n;
  expect(allocate(input)).not.toBeNull();
  root.positions[1].virtualScaled = -1n;expect(allocate(input)).toBeNull();
  root.positions[1].virtualScaled = 100_000n*SCALE;root.cash = 1122n;expect(allocate(input)).toBeNull();
  root.positions[1].lots = 1n;root.positions[1].virtualScaled = -10_000n*SCALE;root.cash = 2233n;
  expect(allocate(input)).not.toBeNull();
  expect(allocate({ ...input,funding: [0n,1n] })).toBeNull();
});
it('refreshes the complete order book and charges aggregate stored-prefix fees exactly once',() => {
  const { input,root } = liquidityFixture();root.cash = 1123n;
  const stored = root.book.orders[0];stored.marketIndex = 0;
  Object.assign(stored.order,{ id: 1n,version: 2n,state: 2,termsEpoch: 1n,side: 0,lots: 2n,filled: 1n,
    notional: 10000n,feeCharged: 2n,limit: 10013n,feeBudget: 100n,startSlot: 1n,expirySlot: 1000n });
  const intent = { ...input,stored: { id: 1n,version: 2n,filled: 1n } };
  expect(allocate(input)).toBeNull();expect(allocate(intent)).toMatchObject({ fee: 3n });
  const other = root.book.orders[3];other.marketIndex = 1;
  Object.assign(other.order,{ id: 2n,state: 1,termsEpoch: 1n,lots: 1n,limit: 10000n,expirySlot: 1000n });
  expect(allocate(intent)).toBeNull();other.order.state = 4;
  stored.delegateEpoch = 1n;expect(() => allocate(intent)).toThrow(/Stored liquidity order/);
});
it('preserves trigger, position generation and shared TP/SL allowance',() => {
  const { input,root } = liquidityFixture();root.positions[0].lots = 2n;root.positions[0].generation = 7n;
  root.positions[0].virtualScaled = -20_000n*SCALE;
  const stored = root.book.orders[0];stored.marketIndex = 0;
  Object.assign(stored.order,{ id: 1n,version: 1n,state: 1,termsEpoch: 1n,side: 1,lots: 2n,limit: 9000n,feeBudget: 100n,
    startSlot: 1n,expirySlot: 1000n,reduceOnly: true,generation: 7n,groupId: 1n,trigger: 1,threshold: 10001n });
  Object.assign(root.book.protections[0].protection,{ id: 1n,remaining: 1n });
  const intent = { ...input,side: 1 as const,allInLimit: 0n,stored: { id: 1n,version: 1n,filled: 0n } };
  expect(() => allocate(intent)).toThrow(/Stored liquidity order/);
  stored.order.threshold = 10000n;expect(allocate(intent)).not.toBeNull();
  expect(() => allocate({ ...intent,lots: 2n })).toThrow(/Stored liquidity order/);
  stored.order.generation = 6n;expect(() => allocate(intent)).toThrow(/Stored liquidity order/);
});
it('allows below-IM reductions only if whole-account maintenance deficit strictly improves after fees',() => {
  const { input,root,makers } = liquidityFixture();root.cash = 1000n;
  root.positions[0].lots = 2n;root.positions[0].virtualScaled = -20_000n*SCALE;
  const intent = { ...input,side: 1 as const,allInLimit: 0n,reduceOnly: true };
  expect(allocate(intent)).not.toBeNull();
  for (const maker of makers) maker.shape = { ...maker.shape,bids: [{ endLots: 4096n,offset: 1000n,slope: 0n }] };
  expect(allocate(intent)).toBeNull();
});
it('finds a nonprefix maker health interval instead of discarding it after quantity one fails',() => {
  const { input,makers } = liquidityFixture();
  for (const maker of makers.slice(1)) maker.unavailable = 'quarantined';
  const capital = makers[0].capital;capital.cash = 500n;capital.positions[0].lots = 3n;
  capital.positions[0].virtualScaled = -30_000n*SCALE;
  expect(allocate({ ...input,lots: 1n })).toBeNull();
  expect(allocate({ ...input,lots: 2n })).toBeNull();
  expect(allocate({ ...input,lots: 3n })).toMatchObject({ legs: [{ instance: 0,lots: 3n }] });
  expect(allocate({ ...input,lots: 4n })).toBeNull();
});
it('requires sources for exposure and active orders but not an empty other market',() => {
  const { input,root } = liquidityFixture();input.sources[1] = 'Frozen';
  expect(allocate(input)).not.toBeNull();root.positions[1].lots = 1n;
  expect(() => allocate(input)).toThrow(/source unavailable/);root.positions[1].lots = 0n;
  input.sources[0] = 'Degraded';expect(() => allocate(input)).toThrow(/source unavailable/);
  root.positions[0].lots = -1n;expect(allocate({ ...input,reduceOnly: true })).not.toBeNull();
});
it('rejects invalid bounds in a relevant second market',() => {
  const { input,root,markets } = liquidityFixture();root.positions[1].lots = 1n;markets[1].lower = 0n;
  expect(() => allocate(input)).toThrow(/relevant market bounds/);
});
it('excludes unavailable/self capital, enforces aliases and binds every candidate to one snapshot',() => {
  const { input,root,makers } = liquidityFixture();makers[0].capital.owner = root.owner;makers[1].unavailable = 'stale-publication';
  expect(allocateLiquidityRoute(input)).toMatchObject({ allocation: { legs: [{ instance: 2 }] },
    excluded: [{ instance: 0,reason: 'self-capital' },{ instance: 1,reason: 'stale-publication' }] });
  makers[2].registrationState.capital = makers[1].registrationState.capital;
  expect(() => allocate(input)).toThrow(/Duplicate/);
  makers[2].snapshot.contextSlot++;expect(() => allocate(input)).toThrow(/snapshot/);
});
it('does not mutate inputs and never uses three capitals to satisfy an exact-size request',() => {
  const { input,root,makers } = liquidityFixture();
  for (const maker of makers) maker.shape = { ...maker.shape,asks: [{ endLots: 2n,offset: 10n,slope: 0n }] };
  const before = structuredClone(root);expect(allocate({ ...input,lots: 5n })).toBeNull();expect(root).toEqual(before);
  expect(allocate({ ...input,lots: 4n })).toMatchObject({ legs: [{ instance: 0,lots: 2n },{ instance: 1,lots: 2n }] });
  expect(allocate({ ...input,lots: 4n,maxFee: 9n,allInLimit: 40049n })).not.toBeNull();
  expect(allocate({ ...input,lots: 4n,maxFee: 8n })).toBeNull(); // ceil(40040/5000)=9, not per-leg fees.
});
