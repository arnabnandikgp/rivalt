/** Integer search primitives. Monotonicity is required of prices/objectives,
 * never assumed of account health. All endpoints are inclusive. */
export function firstTrue(lower: bigint, upper: bigint, predicate: (value: bigint) => boolean): bigint {
  let left = lower, right = upper + 1n;
  while (left < right) {
    const middle = (left + right) / 2n;
    if (middle <= upper && predicate(middle)) right = middle;
    else left = middle + 1n;
  }
  return left;
}

export function lastTrue(lower: bigint, upper: bigint, predicate: (value: bigint) => boolean): bigint {
  return firstTrue(lower, upper, value => !predicate(value)) - 1n;
}

/** Rightmost minimum of an integer convex function (nondecreasing differences).
 * Fee rounding is deliberately applied afterwards: net proceeds may have flat
 * steps without having monotone differences. */
export function convexMinimum(lower: bigint, upper: bigint, value: (quantity: bigint) => bigint): bigint {
  while (lower < upper) {
    const middle = (lower + upper) / 2n;
    if (value(middle) < value(middle + 1n)) upper = middle;
    else lower = middle + 1n;
  }
  return lower;
}

export const LIQUIDITY_SEARCH_BUDGET = Object.freeze({ intervals: 65_536, quantityQuotes: 131_072 });
export class LiquiditySearchLimitError extends Error {
  readonly code = 'liquidity-search-budget-exhausted';
  constructor(readonly metrics: Readonly<{ intervals: number; quantityQuotes: number }>) {
    super('Exact liquidity search exceeded its work budget; no allocation is certified.');
  }
}
