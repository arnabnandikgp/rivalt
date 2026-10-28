import { describe, expect, it } from 'vitest';
import { quoteCanonicalV4, validateCanonicalShapeV4, type CanonicalShapeV4 } from './canonical-quote.js';

const shape: CanonicalShapeV4 = {
  mode: 1, ttlSlots: 150, target: 0n, skewStep: 2n, skewTick: 2n,
  longCap: 100_000_000n, shortCap: 100_000_000n,
  bids: [{ endLots: 3n, offset: 2n, slope: 1n }, { endLots: 8n, offset: 8n, slope: 0n }],
  asks: [{ endLots: 3n, offset: 3n, slope: 2n }, { endLots: 8n, offset: 12n, slope: 0n }],
};

describe('canonical profile-4 quote', () => {
  it.each([
    [0, 3n, 0n, 0n, 317n], [0, 4n, 0n, 0n, 431n], [1, 3n, 0n, 0n, 289n],
    [0, 3n, 3n, 0n, 313n], [1, 3n, -3n, 0n, 293n], [0, 1n, -3n, 3n, 114n],
  ] as const)('matches literal side=%s lots=%s inventory=%s consumed=%s', (side, lots, inventory, consumed, gross) => {
    expect(quoteCanonicalV4(shape, 100n, side, lots, inventory, consumed)).toEqual({ gross, remaining: 8n - consumed - lots });
  });

  it('rejects disabled, empty, nonmonotone and nonpositive marginal quotes', () => {
    expect(() => quoteCanonicalV4({ ...shape, mode: 0 }, 100n, 0, 1n, 0n, 0n)).toThrow();
    expect(() => validateCanonicalShapeV4({ ...shape, bids: [], asks: [] })).toThrow();
    expect(() => validateCanonicalShapeV4({ ...shape, asks: [shape.asks[0], { endLots: 8n, offset: 6n, slope: 0n }] })).toThrow();
    expect(() => quoteCanonicalV4(shape, 1n, 1, 1n, 0n, 0n)).toThrow();
    expect(() => quoteCanonicalV4(shape, 1_000_000n, 0, 1n, 0n, 0n)).toThrow();
  });

  it('does not turn a shape replacement into unconsumed depth', () => {
    const shorter = { ...shape, asks: [{ endLots: 2n, offset: 3n, slope: 0n }] };
    expect(() => quoteCanonicalV4(shorter, 100n, 0, 1n, 0n, 7n)).toThrow();
  });

  it('honors directional caps and reduction without crossing zero', () => {
    const reducing = { ...shape, mode: 3, shortCap: 2n };
    expect(quoteCanonicalV4(reducing, 100n, 0, 3n, 3n, 0n).remaining).toBe(0n);
    expect(() => quoteCanonicalV4(reducing, 100n, 0, 4n, 3n, 0n)).toThrow();
    expect(() => quoteCanonicalV4(reducing, 100n, 0, 1n, -1n, 0n)).toThrow();
  });
});
