import { createHash } from 'node:crypto';
import { address, getAddressEncoder } from '@solana/kit';
import { expect, it } from 'vitest';
import { allocateFundingSide } from './funding-impact.js';
import { fundingReference } from './funding-sources.js';
import { fundingSnapshotDigest } from './funding-publisher.js';
import { quoteCanonicalV4 } from './canonical-quote.js';
import { testAddress } from '../test-support/liquidity-fixture.js';
import type { LiquidityAccountMap } from './liquidity-adapter.js';
import type { MarketV3 } from './generated/index.js';

const shape = { mode: 1, ttlSlots: 150, target: 0n, skewStep: 512n, skewTick: 2n, longCap: 4096n, shortCap: 4096n,
  bids: Array.from({ length: 8 }, (_, index) => ({ endLots: BigInt((index + 1) * 512), offset: BigInt(1 + 2 * index), slope: 0n })),
  asks: Array.from({ length: 8 }, (_, index) => ({ endLots: BigInt((index + 1) * 512), offset: BigInt(3 + 2 * index), slope: 0n })) };

it.each([
  [60_000n, 100n, 5_999_900n, 6_000_300n, [100n, 0n, 0n]],
  [10_000n, 600n, 5_999_400n, 6_001_800n, [512n, 88n, 0n]],
])('matches literal independent funding optimum at index %s', (reference, quantity, bid, ask, quantities) => {
  const makers = Array.from({ length: 3 }, () => ({ quote: (side: 0 | 1, lots: bigint) => quoteCanonicalV4(shape, reference, side, lots, 0n, 0n) }));
  expect(allocateFundingSide(makers, reference, quantity, 1)).toEqual({ gross: bid, quantities });
  expect(allocateFundingSide(makers, reference, quantity, 0)).toEqual({ gross: ask, quantities });
});

it('enumerates disconnected valid quantities and never uses a third leg', () => {
  const makers = [new Set([2n]), new Set([3n]), new Set([4n])].map(valid => ({ quote: (_side: 0 | 1, lots: bigint) => {
    if (!valid.has(lots)) throw new Error('outside curve domain');
    return { gross: lots * 10_000n, remaining: 0n };
  } }));
  expect(allocateFundingSide(makers, 10_000n, 5n, 0)).toEqual({ gross: 50_000n, quantities: [2n, 3n, 0n] });
  expect(allocateFundingSide(makers, 10_000n, 9n, 0)).toBeNull();
});

it('excludes out-of-band prices and zero capacity without inventing a fill', () => {
  const makers = [8_999n, 11_001n, 10_000n].map(price => ({ quote: (_side: 0 | 1, lots: bigint) => ({ gross: price * lots, remaining: 0n }) }));
  expect(allocateFundingSide(makers, 10_000n, 100n, 0)?.quantities).toEqual([0n, 0n, 100n]);
  expect(allocateFundingSide(makers, 10_000n, 100n, 1)?.quantities).toEqual([0n, 0n, 100n]);
  const empty = { quote() { throw new Error('zero capacity'); } };
  expect(allocateFundingSide([empty, empty, empty], 10_000n, 100n, 0)).toBeNull();
});

function sources(index = 0) {
  const keys = [testAddress(91), testAddress(92), testAddress(93), testAddress(94)];
  const fixture: import('@solana/kit').Address = address('A5ACpHNQHLkCQtfvRkPoR45juvuxwfi9mEWGU43eD5nj');
  const raw = keys.map((_, position) => {
    const bytes = Buffer.alloc(142);
    createHash('sha256').update('account:Feed').digest().copy(bytes, 0, 0, 8);
    bytes.fill((index === 0 ? [0, 1, 2, 3] : [4, 1, 5, 3])[position] + 1, 40, 72);
    bytes.writeBigUInt64LE(10n, 72);
    bytes.set(getAddressEncoder().encode(fixture), 80); bytes[112] = 2;
    bytes.writeBigInt64LE(position % 2 ? 1_000_000n : index === 0 ? 60_000_000_000n : 6_000_000_000n, 113);
    bytes.writeInt32LE(-6, 129); bytes.writeBigInt64LE(100n, 133);
    return bytes;
  });
  const accounts = () => new Map(keys.map((key, position) => [key, { owner: fixture, executable: false,
    data: [raw[position].toString('base64'), 'base64'] as [string, string] }]));
  const market = { index, lotsPerUnit: index === 0 ? 1_000_000n : 100_000n,
    oracle: { sources: keys, sourceSequences: [10n, 10n, 10n, 10n] } } as MarketV3;
  return { raw, accounts, market };
}

it('normalizes both markets and rejects stale, divergent, unverified and regressed sources', async () => {
  for (const marketIndex of [0, 1]) {
    const valid = sources(marketIndex);
    expect(await fundingReference(valid.market, valid.accounts(), 120n)).toBe(60_000n);
    expect(await fundingReference(valid.market, valid.accounts(), 121n)).toBeNull();
  }
  for (const mutate of [
    (raw: Buffer[]) => raw[0].writeBigUInt64LE(9n, 72),
    (raw: Buffer[]) => { raw[0][112] = 1; },
    (raw: Buffer[]) => raw[0].writeBigUInt64LE(300_000_001n, 121),
    (raw: Buffer[]) => raw[0].writeBigInt64LE(103n, 133),
    (raw: Buffer[]) => raw[2].writeBigInt64LE(60_601_000_000n, 113),
    (raw: Buffer[]) => raw[1].writeBigInt64LE(940_000n, 113),
  ]) {
    const fixture = sources(); mutate(fixture.raw);
    expect(await fundingReference(fixture.market, fixture.accounts(), 100n)).toBeNull();
  }
});

it('digest is ordered, domain separated and sensitive to bytes, owners, absence and context', async () => {
  const fixture = sources(), original = fixture.accounts();
  const digest = await fundingSnapshotDigest(123n, original);
  expect(await fundingSnapshotDigest(123n, new Map([...original].reverse()))).toEqual(digest);
  expect(await fundingSnapshotDigest(124n, original)).not.toEqual(digest);
  const missing = new Map(original) as Map<ReturnType<typeof testAddress>, LiquidityAccountMap extends ReadonlyMap<unknown, infer Value> ? Value : never>;
  missing.set(fixture.market.oracle.sources[0], null);
  expect(await fundingSnapshotDigest(123n, missing)).not.toEqual(digest);
  fixture.raw[0][113]++;
  expect(await fundingSnapshotDigest(123n, fixture.accounts())).not.toEqual(digest);
  original.get(fixture.market.oracle.sources[0])!.owner = testAddress(95);
  expect(await fundingSnapshotDigest(123n, original)).not.toEqual(digest);
});
