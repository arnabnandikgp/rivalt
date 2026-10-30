import { expect, it } from 'vitest';
import { address } from '@solana/kit';
import type { OrderTerms, OrderRecord } from '@rivalt/sdk';
import {
  accountLabel,
  parsePrice,
  parseQuantity,
  orderPrice,
  orderTerms,
} from './model.js';

it('converts BTC and ETH UI units to exact distinct program lots/prices', () => {
  expect(parseQuantity('0.000015', 0)).toBe(15n);
  expect(parseQuantity('0.00015', 1)).toBe(15n);
  expect(parsePrice('60000', 0)).toBe(60000n);
  expect(parsePrice('3000.1', 1)).toBe(30001n);
  expect(() => parsePrice('60000.5', 0)).toThrow(/multiple of 1/);
  expect(() => parsePrice('3000.01', 1)).toThrow(/multiple of 0.1/);
  expect(() => parseQuantity('0.000001', 1)).toThrow(/at most 5/);
  expect(() => parseQuantity('0.004609', 0)).toThrow(/bounded route/);
});
it('checks market-specific persistent limit and trigger ranges before asking for a signature', () => {
  expect(orderPrice('9000', 0)).toBe(9000n);
  expect(orderPrice('11000', 1)).toBe(110000n);
  expect(orderPrice('10000', 1, true)).toBe(100000n);
  expect(() => orderPrice('100000', 1, true)).toThrow(/1000 and 10000/);
  expect(() => orderPrice('899.9', 1)).toThrow(/900 and 11000/);
  expect(() => orderPrice('110001', 0)).toThrow(/9000 and 110000/);
});
it('ordinary orders after closing a position use zero generation; reductions bind the live position', () => {
  const input: Omit<OrderTerms, 'generation'> = {
    side: 0,
    lots: 5n,
    limit: 60000n,
    feeBudget: 100n,
    startSlot: 100n,
    expirySlot: 700n,
    trigger: 0,
    threshold: 0n,
    reduceOnly: false,
  };
  expect(orderTerms(input, { lots: 0n, generation: 2n }).generation).toBe(0n);
  expect(
    orderTerms({ ...input, reduceOnly: true }, { lots: -5n, generation: 3n }).generation,
  ).toBe(3n);
  expect(() =>
    orderTerms({ ...input, reduceOnly: true }, { lots: 5n, generation: 3n }),
  ).toThrow(/oppose/);
  expect(() =>
    orderTerms({ ...input, lots: 6n, reduceOnly: true }, { lots: -5n, generation: 3n }),
  ).toThrow(/fit/);
  expect(() =>
    orderTerms({ ...input, feeBudget: 1000001n }, { lots: 0n, generation: 2n }),
  ).toThrow(/cannot exceed/);
});
it('replacement retains generation/side and charged fee prefixes, accounting for already filled lots', () => {
  const input: Omit<OrderTerms, 'generation'> = {
    side: 1,
    lots: 10n,
    limit: 60000n,
    feeBudget: 100n,
    startSlot: 100n,
    expirySlot: 700n,
    trigger: 0,
    threshold: 0n,
    reduceOnly: true,
  };
  const previous = {
    ...input,
    id: 1n,
    version: 1n,
    state: 1,
    generation: 3n,
    filled: 6n,
    feeCharged: 80n,
    originalLots: 10n,
    groupId: 0n,
    notional: 360000n,
    termsEpoch: 0n,
    reserve: 0n,
  } satisfies OrderRecord;
  expect(orderTerms(input, { lots: 4n, generation: 3n }, previous).lots).toBe(10n);
  expect(() =>
    orderTerms({ ...input, feeBudget: 79n }, { lots: 4n, generation: 3n }, previous),
  ).toThrow(/fees already charged/);
  expect(() => orderTerms(input, { lots: 4n, generation: 4n }, previous)).toThrow(
    /generation/,
  );
  expect(() =>
    orderTerms({ ...input, lots: 6n }, { lots: 4n, generation: 3n }, previous),
  ).toThrow(/already filled/);
  expect(() =>
    orderTerms({ ...input, reduceOnly: false }, { lots: 4n, generation: 3n }, previous),
  ).toThrow(/retain/);
});
