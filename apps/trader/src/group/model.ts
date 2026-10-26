import type { Address } from '@solana/kit';
import type { GroupSnapshot, MarginAccountV2, OrderTerms, StoredOrder } from '@rivalt/sdk';
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

/** Persistent order bounds differ from an immediate route's all-in cash limit. */
export function groupOrderPrice(input: string, marketIndex: 0 | 1, trigger = false) {
  const price = groupPrice(input, marketIndex);
  const minimum = trigger ? 10_000n : 9_000n,
    maximum = trigger ? 100_000n : 110_000n;
  if (price < minimum || price > maximum) {
    const divisor = marketIndex === 0 ? 1n : 10n;
    throw new Error(
      `${trigger ? 'Trigger' : 'Order limit'} price must be between ${minimum / divisor} and ${maximum / divisor} test USD per unit.`,
    );
  }
  return price;
}

/** Bind reductions to a live generation; ordinary orders deliberately use zero. */
export function groupOrderTerms(
  input: Omit<OrderTerms, 'generation'>,
  position: Pick<MarginAccountV2['positions'][number], 'lots' | 'generation'>,
  previous?: StoredOrder,
): OrderTerms {
  const terms = { ...input, generation: input.reduceOnly ? position.generation : 0n };
  const filled = previous?.filled ?? 0n;
  if (terms.lots <= filled)
    throw new Error('Total quantity must exceed the already filled quantity.');
  if (terms.feeBudget > 1_000_000n)
    throw new Error('Lifetime venue fee budget cannot exceed 1 test USD.');
  if (
    terms.reduceOnly &&
    (position.lots === 0n ||
      terms.lots - filled > (position.lots < 0n ? -position.lots : position.lots) ||
      (terms.side === 0) !== position.lots < 0n)
  )
    throw new Error('Reduce-only orders must oppose and fit the existing position.');
  if (
    previous &&
    (terms.side !== previous.side ||
      terms.reduceOnly !== previous.reduceOnly ||
      terms.generation !== previous.generation ||
      terms.feeBudget < previous.feeCharged)
  )
    throw new Error(
      'Replacement must retain side, reduce-only mode and generation, and cover fees already charged.',
    );
  if (
    previous?.groupId &&
    (terms.trigger !== previous.trigger || terms.lots > previous.originalLots)
  )
    throw new Error(
      'Protection replacements must retain their trigger direction and cannot increase quantity.',
    );
  return terms;
}
