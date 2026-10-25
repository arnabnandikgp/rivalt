import { expect, it } from 'vitest';
import { address } from '@solana/kit';
import type { GroupSnapshot } from '@rivalt/sdk';
import { accountLabel, groupPrice, groupQuantity, portfolioAccounts } from './model.js';

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
