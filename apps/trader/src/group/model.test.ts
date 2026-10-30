import { expect, it } from 'vitest';
import { address } from '@solana/kit';
import type { GroupSnapshot, OrderTerms, OrderRecord } from '@rivalt/sdk';
import {
  accountLabel,
  groupPrice,
  groupQuantity,
  portfolioAccounts,
  groupOrderPrice,
  groupOrderTerms,
} from './model.js';

it('converts BTC and ETH UI units to exact distinct program lots/prices', () => {
  expect(groupQuantity('0.000015', 0)).toBe(15n);
  expect(groupQuantity('0.00015', 1)).toBe(15n);
  expect(groupPrice('60000', 0)).toBe(60000n);
  expect(groupPrice('3000.1', 1)).toBe(30001n);
  expect(() => groupPrice('60000.5', 0)).toThrow(/multiple of 1/);
  expect(() => groupPrice('3000.01', 1)).toThrow(/multiple of 0.1/);
  expect(() => groupQuantity('0.000001', 1)).toThrow(/at most 5/);
  expect(() => groupQuantity('0.004609', 0)).toThrow(/bounded route/);
});
it('shows only the selected owner portfolio-zero trader roots without combining sibling cash', () => {
  const owner = address('11111111111111111111111111111111'),
    other = address('ComputeBudget111111111111111111111111111111');
  const snapshot = {
    portfolios: {
      first: { owner, index: 0 },
      second: { owner, index: 1 },
      foreign: { owner: other, index: 0 },
    },
    roots: {
      cross: {
        owner,
        portfolio: 'first',
        mode: 0,
        role: 0,
        subaccountIndex: 0,
        cash: 50n,
      },
      isolated: {
        owner,
        portfolio: 'first',
        mode: 1,
        role: 0,
        subaccountIndex: 2,
        isolatedMarketIndex: 1,
        cash: 20n,
      },
      maker: {
        owner,
        portfolio: 'first',
        mode: 1,
        role: 1,
        subaccountIndex: 3,
        cash: 500n,
      },
      siblingPortfolio: {
        owner,
        portfolio: 'second',
        role: 0,
        subaccountIndex: 0,
        cash: 100n,
      },
      foreign: {
        owner: other,
        portfolio: 'foreign',
        role: 0,
        subaccountIndex: 0,
        cash: 200n,
      },
    },
  } as unknown as GroupSnapshot;
  const result = portfolioAccounts(snapshot, owner);
  expect(result.accounts.map(([key, root]) => [key, root.cash])).toEqual([
    ['cross', 50n],
    ['isolated', 20n],
  ]);
  expect(accountLabel(result.accounts[1][1])).toBe('Isolated ETH · 2');
  expect(portfolioAccounts(snapshot, null).accounts).toEqual([]);
});

it('checks market-specific persistent limit and trigger ranges before asking for a signature', () => {
  expect(groupOrderPrice('9000', 0)).toBe(9000n);
  expect(groupOrderPrice('11000', 1)).toBe(110000n);
  expect(groupOrderPrice('10000', 1, true)).toBe(100000n);
  expect(() => groupOrderPrice('100000', 1, true)).toThrow(/1000 and 10000/);
  expect(() => groupOrderPrice('899.9', 1)).toThrow(/900 and 11000/);
  expect(() => groupOrderPrice('110001', 0)).toThrow(/9000 and 110000/);
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
  expect(groupOrderTerms(input, { lots: 0n, generation: 2n }).generation).toBe(0n);
  expect(
    groupOrderTerms({ ...input, reduceOnly: true }, { lots: -5n, generation: 3n }).generation,
  ).toBe(3n);
  expect(() =>
    groupOrderTerms({ ...input, reduceOnly: true }, { lots: 5n, generation: 3n }),
  ).toThrow(/oppose/);
  expect(() =>
    groupOrderTerms({ ...input, lots: 6n, reduceOnly: true }, { lots: -5n, generation: 3n }),
  ).toThrow(/fit/);
  expect(() =>
    groupOrderTerms({ ...input, feeBudget: 1000001n }, { lots: 0n, generation: 2n }),
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
  expect(groupOrderTerms(input, { lots: 4n, generation: 3n }, previous).lots).toBe(10n);
  expect(() =>
    groupOrderTerms({ ...input, feeBudget: 79n }, { lots: 4n, generation: 3n }, previous),
  ).toThrow(/fees already charged/);
  expect(() => groupOrderTerms(input, { lots: 4n, generation: 4n }, previous)).toThrow(
    /generation/,
  );
  expect(() =>
    groupOrderTerms({ ...input, lots: 6n }, { lots: 4n, generation: 3n }, previous),
  ).toThrow(/already filled/);
  expect(() =>
    groupOrderTerms({ ...input, reduceOnly: false }, { lots: 4n, generation: 3n }, previous),
  ).toThrow(/retain/);
});
