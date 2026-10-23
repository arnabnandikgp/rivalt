import { createHash } from 'node:crypto';
import { address, getAddressDecoder, getProgramDerivedAddress } from '@solana/kit';

// Pinned upstream schema: pyth-crosschain 145e9b4a88ef0bf2795357fdce8c0c2fe57b77d2.
// Read-only P13 dependency probe; this does not enable a clearing instruction.
export const CORE_PROFILES = [
  { name: 'core', receiver: 'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ', push: 'pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT' },
  { name: 'compatible', receiver: 'rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp', push: 'pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou' },
] as const;
export const CORE_FEEDS = [
  { name: 'btc', id: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43' },
  { name: 'collateral', id: 'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a' },
] as const;
export async function sponsoredFeeds() {
  return Promise.all(CORE_PROFILES.flatMap(profile => CORE_FEEDS.map(async feed => ({
    ...profile, feed: feed.name, feedId: feed.id,
    account: (await getProgramDerivedAddress({ programAddress: address(profile.push), seeds: [new Uint8Array(2), Buffer.from(feed.id, 'hex')] }))[0],
  }))));
}
export type SponsoredFeed = Awaited<ReturnType<typeof sponsoredFeeds>>[number];
export type RpcAccount = { owner: string; executable: boolean; data: [string, string] } | null;
const discriminator = createHash('sha256').update('account:PriceUpdateV2').digest().subarray(0, 8);

export function decodeCore(account: RpcAccount, expected: SponsoredFeed) {
  if (!account || account.owner !== expected.receiver || account.executable || account.data[1] !== 'base64') throw new Error('Core account binding');
  const b = Buffer.from(account.data[0], 'base64');
  if (b.length !== 134 || !b.subarray(0, 8).equals(discriminator) || b[40] !== 1) throw new Error('Core schema or full verification');
  const authority = getAddressDecoder().decode(b.subarray(8, 40));
  if (authority !== expected.account || b.subarray(41, 73).toString('hex') !== expected.feedId) throw new Error('Core authority or feed identity');
  const price = b.readBigInt64LE(73), confidence = b.readBigUInt64LE(81), exponent = b.readInt32LE(89);
  const published = b.readBigInt64LE(93), previousPublished = b.readBigInt64LE(101), postedSlot = b.readBigUInt64LE(125);
  if (price <= 0n || published <= 0n || previousPublished > published || postedSlot === 0n) throw new Error('Core value or time');
  return { price, confidence, exponent, published, previousPublished, postedSlot, authority };
}

// Enclose the original confidence interval at Rivalt's explicit -6 USD exponent.
// Flooring the midpoint requires including its fractional remainder in confidence.
export function normalizeCore(price: bigint, confidence: bigint, exponent: number) {
  if (price <= 0n || price > 0x7fffffffffffffffn || confidence < 0n || confidence > 0xffffffffffffffffn || !Number.isInteger(exponent) || exponent < -18 || exponent > 0) throw new Error('Core normalization range');
  const shift = exponent + 6;
  const scale = 10n ** BigInt(Math.abs(shift));
  const value = shift >= 0 ? price * scale : price / scale;
  const conf = shift >= 0 ? confidence * scale : (confidence + price % scale + scale - 1n) / scale;
  if (value <= 0n || value > 0x7fffffffffffffffn || conf > 0xffffffffffffffffn) throw new Error('Core normalization overflow');
  return { value, confidence: conf, exponent: -6 };
}

export function coreEligibility(p: ReturnType<typeof decodeCore>, now: bigint, collateral: boolean, sourceAge: 20n | 30n = 20n) {
  const n = normalizeCore(p.price, p.confidence, p.exponent);
  const [min, max, conf] = collateral ? [500_000n, 1_500_000n, 25n] : [10_000_000_000n, 100_000_000_000n, 50n];
  return { ageSeconds: now - p.published,
    eligible: p.published <= now + 2n && now - p.published <= sourceAge && n.value >= min && n.value <= max && n.confidence * 10_000n <= n.value * conf };
}
