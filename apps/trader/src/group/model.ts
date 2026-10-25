import type { Address } from '@solana/kit';
import type { GroupSnapshot, MarginAccountV2 } from '@rivalt/sdk';
import { units } from '../amount.js';
export const GROUP_MARKETS = [
  { name: 'BTC', decimals: 6, lotsPerUnit: 1_000_000n },
  { name: 'ETH', decimals: 5, lotsPerUnit: 100_000n },
] as const;
export const accountLabel = (
  root: Pick<MarginAccountV2, 'mode' | 'isolatedMarketIndex' | 'subaccountIndex'>,
) =>
  root.mode === 0
    ? 'Cross'
    : `Isolated ${GROUP_MARKETS[root.isolatedMarketIndex].name} · ${root.subaccountIndex}`;
export function portfolioAccounts(snapshot: GroupSnapshot | undefined, owner: Address | null) {
  if (!snapshot || !owner) return { portfolio: undefined, accounts: [] };
  const portfolio = Object.entries(snapshot.portfolios).find(
    ([, value]) => value.owner === owner && value.index === 0,
  )?.[0];
  return {
    portfolio,
    accounts: Object.entries(snapshot.roots)
      .filter(([, root]) => root.owner === owner && root.portfolio === portfolio && root.role === 0)
      .sort(([, left], [, right]) => left.subaccountIndex - right.subaccountIndex),
  };
}
/** UI prices are collateral per whole BTC/ETH; program prices are atoms per lot. */
export function groupPrice(input: string, marketIndex: 0 | 1) {
  const amount = units(input, 6, 'Price'),
    divisor = GROUP_MARKETS[marketIndex].lotsPerUnit;
  if (amount % divisor !== 0n)
    throw new Error(`Price must be a multiple of ${marketIndex === 0 ? '1' : '0.1'} test USD.`);
  const price = amount / divisor;
  if (price < 1n || price > 1_000_000n) throw new Error('Price is outside the test market bounds.');
  return price;
}
export function groupQuantity(input: string, marketIndex: 0 | 1) {
  const lots = units(
    input,
    GROUP_MARKETS[marketIndex].decimals,
    `${GROUP_MARKETS[marketIndex].name} quantity`,
  );
  if (lots > 4608n) throw new Error('Quantity exceeds the bounded route limit.');
  return lots;
}
