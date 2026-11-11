import { expect, it } from 'vitest';
import { allocateFundingSide, type FundingCurve, type FundingAllocation } from './funding-impact.js';

// Independent per-lot reference: no canonical quote/potential, domain search or
// convex optimiser imports. Enumerate every singleton and split for small Q.
function exhaustive(makers: readonly FundingCurve[], reference: bigint, quantity: bigint, side: 0 | 1): FundingAllocation | null {
  const prices = makers.map(({ shape, anchor, inventory, buyConsumed, sellConsumed }) => {
    const consumed = side === 0 ? buyConsumed : sellConsumed, direction = side === 0 ? -1n : 1n;
    const regions = side === 0 ? shape.asks : shape.bids;
    const result: (bigint | null)[] = [0n];
    let gross = 0n, valid = shape.mode !== 0 && anchor >= 1n && anchor <= 1_000_000n;
    for (let lots = 1n; lots <= quantity; lots++) {
      const before = inventory + direction * (lots - 1n), after = before + direction;
      const ordinal = consumed + lots;
      let start = 0n, offset: bigint | null = null;
      for (const region of regions) {
        if (ordinal <= region.endLots) { offset = region.offset + (ordinal - start - 1n) * region.slope; break; }
        start = region.endLots;
      }
      const oldDistance = before > shape.target ? before - shape.target : shape.target - before;
      const newDistance = after > shape.target ? after - shape.target : shape.target - after;
      const skew = newDistance > oldDistance ? oldDistance / shape.skewStep * shape.skewTick
        : -newDistance / shape.skewStep * shape.skewTick;
      const price = anchor - direction * ((offset ?? 0n) + skew);
      if (offset === null || after < -shape.shortCap || after > shape.longCap || price < 1n || price > 1_000_000n
        || shape.mode === 3 && (side === 0 ? inventory <= 0n || after < 0n : inventory >= 0n || after > 0n)) valid = false;
      gross += price;
      result.push(valid && gross * 10n >= lots * reference * 9n && gross * 10n <= lots * reference * 11n ? gross : null);
    }
    return result;
  });
  let best: FundingAllocation | null = null;
  const consider = (gross: bigint, quantities: bigint[]) => {
    if (!best || (side === 0 ? gross < best.gross : gross > best.gross)) best = { gross, quantities };
  };
  for (let index = 0; index < 3; index++) {
    const gross = prices[index][Number(quantity)];
    if (gross === null) continue;
    const quantities = [0n, 0n, 0n]; quantities[index] = quantity; consider(gross, quantities);
  }
  for (let first = 0; first < 3; first++) for (let second = first + 1; second < 3; second++) {
    for (let lots = quantity - 1n; lots > 0n; lots--) {
      const left = prices[first][Number(lots)], right = prices[second][Number(quantity - lots)];
      if (left === null || right === null) continue;
      const quantities = [0n, 0n, 0n]; quantities[first] = lots; quantities[second] = quantity - lots;
      consider(left + right, quantities);
    }
  }
  return best;
}
function flat(anchor: bigint, capacity = 3_000_000n): FundingCurve {
  return { anchor, inventory: 0n, buyConsumed: 0n, sellConsumed: 0n,
    shape: { mode: 1, ttlSlots: 150, target: 0n, skewStep: 1n, skewTick: 0n, longCap: capacity, shortCap: capacity,
      bids: [{ endLots: capacity, offset: 0n, slope: 0n }], asks: [{ endLots: capacity, offset: 0n, slope: 0n }] } };
}
it('matches independent lot-by-lot exhaustive allocations, including gaps from price bands', () => {
  let allocated = 0, unavailable = 0;
  for (let seed = 0; seed < 256; seed++) {
    const reference = [2n, 100n, 909_090n][seed % 3];
    const makers = [0, 1, 2].map(instance => {
      const salt = seed * 7 + instance * 19, maker = flat(reference + BigInt(salt % 41 - 20), 80n);
      const shape = { ...maker.shape, mode: [0, 1, 1, 1, 3][salt % 5], target: BigInt(salt % 23 - 11),
        skewStep: BigInt(salt % 8 + 1), skewTick: BigInt(salt % 3), longCap: BigInt(20 + salt % 61), shortCap: BigInt(20 + (salt * 3) % 61),
        bids: [1, 2, 3, 4].map(index => ({ endLots: BigInt(index * 20), offset: BigInt((index - 1) * 40 + salt % 3), slope: BigInt(salt % 3) })),
        asks: [1, 2, 3, 4].map(index => ({ endLots: BigInt(index * 20), offset: BigInt((index - 1) * 40 + salt % 5), slope: BigInt((salt + 1) % 3) })) };
      return { ...maker, shape, inventory: BigInt(salt % 31 - 15), buyConsumed: BigInt(salt % 13), sellConsumed: BigInt(salt % 17) };
    });
    for (const quantity of [1n, 37n, 79n]) for (const side of [0, 1] as const) {
      const expected = exhaustive(makers, reference, quantity, side);
      expect(allocateFundingSide(makers, reference, quantity, side), `seed=${seed}, Q=${quantity}, side=${side}`).toEqual(expected);
      if (expected) allocated++; else unavailable++;
    }
  }
  expect(allocated).toBeGreaterThan(100); expect(unavailable).toBeGreaterThan(100);
});
it('certifies the three-million-lot domain with bounded work and all deterministic ties', () => {
  for (const side of [0, 1] as const) {
    const metrics = { quantityQuotes: 0, compositions: 0 };
    expect(allocateFundingSide([flat(2n), flat(2n), flat(2n)], 2n, 3_000_000n, side, metrics))
      .toEqual({ gross: 6_000_000n, quantities: [3_000_000n, 0n, 0n] });
    expect(metrics.quantityQuotes).toBeLessThan(600);
    expect(metrics.compositions).toBe(6);
    expect(allocateFundingSide([flat(2n, 2_000_000n), flat(2n, 2_000_000n), flat(2n, 2_000_000n)], 2n, 3_000_000n, side))
      .toEqual({ gross: 6_000_000n, quantities: [2_000_000n, 1_000_000n, 0n] });
    // Enough total depth, but no valid two-maker route.
    expect(allocateFundingSide([flat(2n, 1_000_000n), flat(2n, 1_000_000n), flat(2n, 1_000_000n)], 2n, 3_000_000n, side)).toBeNull();
  }
});
it('finds an interior optimum at large Q without scanning every split', () => {
  const curved = (depth: bigint): FundingCurve => ({ ...flat(100_000n), shape: {
    ...flat(100_000n).shape, skewStep: 10_000n, skewTick: 1n,
    bids: [{ endLots: 3_000_000n, offset: depth, slope: 0n }], asks: [{ endLots: 3_000_000n, offset: depth, slope: 0n }],
  } });
  for (const side of [0, 1] as const) {
    const metrics = { quantityQuotes: 0, compositions: 0 };
    const result = allocateFundingSide([curved(0n), curved(1n), curved(1000n)], 100_000n, 3_000_000n, side, metrics);
    // Marginal steps tie at 150: rightmost optimum is 1,510,000 / 1,490,000.
    expect(result?.quantities).toEqual([1_510_000n, 1_490_000n, 0n]);
    // Sum staircases: 10,000*(150*149/2 + 149*148/2) + 10,000*150 + 1,490,000 = 225,000,000.
    expect(result?.gross).toBe(side === 0 ? 300_225_000_000n : 299_775_000_000n);
    expect(metrics.quantityQuotes).toBeLessThan(600);
  }
});
