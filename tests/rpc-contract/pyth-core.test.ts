import { createHash } from 'node:crypto';
import { getAddressEncoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { coreEligibility, decodeCore, normalizeCore, sponsoredFeeds } from './pyth-core.js';

const feeds = await sponsoredFeeds();
function fixture() {
  const b = Buffer.alloc(134);
  createHash('sha256').update('account:PriceUpdateV2').digest().copy(b, 0, 0, 8);
  b.set(getAddressEncoder().encode(feeds[0].account), 8); b[40] = 1;
  Buffer.from(feeds[0].feedId, 'hex').copy(b, 41);
  b.writeBigInt64LE(8_123_456_789_012n, 73); b.writeBigUInt64LE(10_001n, 81); b.writeInt32LE(-8, 89);
  b.writeBigInt64LE(1_000n, 93); b.writeBigInt64LE(999n, 101); b.writeBigUInt64LE(123n, 125);
  return b;
}
function account(b: Buffer) { return { owner: feeds[0].receiver, executable: false, data: [b.toString('base64'), 'base64'] as [string, string] }; }
describe('sponsored Core boundary', () => {
  it('derives documented shard-zero addresses from upstream seeds', () => {
    expect(feeds.map(x => x.account)).toEqual(['4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo', 'Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX', 'APgzQGGdv2qCgBkX6aHVkrGePtBVDDg68GiqaM7rmtf5', '6HAuqASbHEh4w4REJEUUUCginTLfj1kwCh215ZLtMkrT']);
  });
  it('decodes independent serialized fields and rejects identity/verification substitutes', () => {
    const b = fixture();
    expect(decodeCore(account(b), feeds[0])).toMatchObject({ price: 8_123_456_789_012n, confidence: 10_001n, exponent: -8, published: 1_000n, previousPublished: 999n, postedSlot: 123n });
    expect(() => decodeCore({ ...account(b), owner: feeds[2].receiver }, feeds[0])).toThrow();
    expect(() => decodeCore({ ...account(b), executable: true }, feeds[0])).toThrow();
    expect(() => decodeCore(account(b), feeds[1])).toThrow();
    expect(() => decodeCore(account(b.subarray(0, 133)), feeds[0])).toThrow();
    for (const offset of [0, 8, 40, 41]) { const bad = Buffer.from(b); bad[offset] ^= 1; expect(() => decodeCore(account(bad), feeds[0])).toThrow(); }
    b.writeBigInt64LE(-1n, 73); expect(() => decodeCore(account(b), feeds[0])).toThrow();
  });
  it('encloses fractional confidence at -6 with exact expected vectors', () => {
    expect(normalizeCore(8_123_456_789_012n, 10_001n, -8)).toEqual({ value: 81_234_567_890n, confidence: 101n, exponent: -6 });
    expect(normalizeCore(100_099n, 100n, -8)).toEqual({ value: 1_000n, confidence: 2n, exponent: -6 });
    expect(normalizeCore(8_123_456n, 3n, -2)).toEqual({ value: 81_234_560_000n, confidence: 30_000n, exponent: -6 });
    expect(() => normalizeCore(1n, 0n, -18)).toThrow();
    expect(() => normalizeCore(0x7fffffffffffffffn, 0n, 0)).toThrow();
    expect(() => normalizeCore(1n, 0n, -19)).toThrow();
  });
  it('retains 20-second age, two-second future and confidence limits', () => {
    const p = decodeCore(account(fixture()), feeds[0]);
    expect(coreEligibility(p, 1_020n, false).eligible).toBe(true);
    expect(coreEligibility(p, 1_021n, false).eligible).toBe(false);
    expect(coreEligibility(p, 998n, false).eligible).toBe(true);
    expect(coreEligibility(p, 997n, false).eligible).toBe(false);
    expect(coreEligibility({ ...p, confidence: p.price / 10n }, 1_000n, false).eligible).toBe(false);
    expect(coreEligibility(p, 1_000n, true).eligible).toBe(false);
  });
});
