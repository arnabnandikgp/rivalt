import type { Address } from '@solana/kit';
import type { AccountSnapshot, MarginAccount, OrderTerms, OrderRecord } from '@rivalt/sdk';
import {MAX_ACTION_LOTS,MAX_CASH_ATOMS,MAX_PRICE,BTC_LOTS_PER_UNIT,ETH_LOTS_PER_UNIT,MIN_TRIGGER_PRICE,MAX_TRIGGER_PRICE,MIN_ORDER_PRICE,MAX_ORDER_PRICE} from '@rivalt/sdk';
import { units } from '../amount.js';
export const MARKETS = [
  { name: 'BTC', decimals: 6, lotsPerUnit: BTC_LOTS_PER_UNIT },
  { name: 'ETH', decimals: 5, lotsPerUnit: ETH_LOTS_PER_UNIT },
] as const;
export const accountLabel = (
  root: Pick<MarginAccount, 'mode' | 'isolatedMarketIndex' | 'subaccountIndex'>,
) =>
  root.mode === 0
    ? 'Cross'
    : `Isolated ${MARKETS[root.isolatedMarketIndex].name} · ${root.subaccountIndex}`;
/** UI prices are collateral per whole BTC/ETH; program prices are atoms per lot. */
export function parsePrice(input: string, marketIndex: 0 | 1) {
  const amount = units(input, 6, 'Price'),
    divisor = MARKETS[marketIndex].lotsPerUnit;
  if (amount % divisor !== 0n)
    throw new Error(`Price must be a multiple of ${marketIndex === 0 ? '1' : '0.1'} test USD.`);
  const price = amount / divisor;
  if (price < 1n || price > MAX_PRICE) throw new Error('Price is outside the test market bounds.');
  return price;
}
export function parseQuantity(input: string, marketIndex: 0 | 1) {
  const lots = units(
    input,
    MARKETS[marketIndex].decimals,
    `${MARKETS[marketIndex].name} quantity`,
  );
  if (lots > MAX_ACTION_LOTS) throw new Error('Quantity exceeds the supported position size.');
  return lots;
}

/** Persistent order bounds differ from an immediate route's all-in cash limit. */
export function orderPrice(input: string, marketIndex: 0 | 1, trigger = false) {
  const price = parsePrice(input, marketIndex);
  const minimum = trigger ? MIN_TRIGGER_PRICE : MIN_ORDER_PRICE,
    maximum = trigger ? MAX_TRIGGER_PRICE : MAX_ORDER_PRICE;
  if (price < minimum || price > maximum) {
    const display = (value: bigint) => marketIndex === 0 ? value.toString()
      : `${value / 10n}${value % 10n ? `.${value % 10n}` : ''}`;
    throw new Error(
      `${trigger ? 'Trigger' : 'Order limit'} price must be between ${display(minimum)} and ${display(maximum)} test USD per unit.`,
    );
  }
  return price;
}

/** Bind reductions to a live generation; ordinary orders deliberately use zero. */
export function orderTerms(
  input: Omit<OrderTerms, 'generation'>,
  position: Pick<MarginAccount['positions'][number], 'lots' | 'generation'>,
  previous?: OrderRecord,
): OrderTerms {
  const terms = { ...input, generation: input.reduceOnly ? position.generation : 0n };
  const filled = previous?.filled ?? 0n;
  if (terms.lots <= filled)
    throw new Error('Total quantity must exceed the already filled quantity.');
  if (terms.feeBudget < 0n || terms.feeBudget > MAX_CASH_ATOMS)
    throw new Error('Lifetime venue fee budget exceeds the supported cash range.');
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
