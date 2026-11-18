import { MIN_REFERENCE_PRICE, MAX_REFERENCE_PRICE, MAX_FUNDING_SAMPLE_LOTS, EXECUTION_DENOMINATOR, EXECUTION_LOWER_NUMERATOR, EXECUTION_UPPER_NUMERATOR } from './price-policy.js';
import { quoteCanonical, validateCanonicalShape, type CanonicalShape } from './canonical-quote.js';
import { convexMinimum, firstTrue, lastTrue } from './quantity-search.js';
import { requireValue } from './wallet-client.js';

/** Price inputs extracted only after complete snapshot authentication. This
 * search supports the canonical curve capability, never arbitrary quote callbacks.
 * Inventory/consumption affect price/depth; cash, claims and margin do not. */
export type FundingCurve = Readonly<{
  shape: CanonicalShape; anchor: bigint; inventory: bigint; buyConsumed: bigint; sellConsumed: bigint;
}>;
export type FundingAllocation = Readonly<{ gross: bigint; quantities: readonly bigint[] }>;
export type FundingSearchMetrics = { quantityQuotes: number; compositions: number };
const minimum = (...values: bigint[]) => values.reduce((left, right) => left < right ? left : right);
const maximum = (...values: bigint[]) => values.reduce((left, right) => left > right ? left : right);

/** Exact singleton/pair optimum in O(m² log Q × regions). Canonical marginal
 * buys increase and sells decrease, so valid endpoint prices form a prefix,
 * average-price bands an interval, and pair gross cost is integer convex.
 * No hypothetical financial admission or taker fees participate in funding. */
export function allocateFundingSide(makers: readonly FundingCurve[], reference: bigint,
  quantity: bigint, side: 0 | 1, metrics: FundingSearchMetrics = { quantityQuotes: 0, compositions: 0 }): FundingAllocation | null {
  requireValue(makers.length === 3 && reference >= MIN_REFERENCE_PRICE && reference <= MAX_REFERENCE_PRICE
    && quantity > 0n && quantity <= MAX_FUNDING_SAMPLE_LOTS && (side === 0 || side === 1), 'Invalid funding allocation domain.');
  const table = makers.map(maker => {
    const { shape, inventory, anchor } = maker;
    validateCanonicalShape(shape);
    const consumed = side === 0 ? maker.buyConsumed : maker.sellConsumed;
    const regions = side === 0 ? shape.asks : shape.bids;
    let upper = minimum(quantity, (regions.at(-1)?.endLots ?? 0n) - consumed,
      side === 0 ? inventory + shape.shortCap : shape.longCap - inventory);
    if (shape.mode === 3) upper = minimum(upper, side === 0 ? inventory : -inventory);
    if (shape.mode === 0 || upper <= 0n) return null;
    const cache = new Map<bigint, bigint | null>();
    const read = (lots: bigint) => {
      if (!cache.has(lots)) {
        metrics.quantityQuotes++;
        try { cache.set(lots, quoteCanonical(shape, anchor, side, lots, inventory, consumed).gross); }
        catch { cache.set(lots, null); }
      }
      return cache.get(lots)!;
    };
    if (read(1n) === null) return null;
    upper = lastTrue(1n, upper, lots => read(lots) !== null);
    const quote = (lots: bigint) => { const gross = read(lots); requireValue(gross !== null, 'Invalid bounded funding quote.'); return gross; };
    const lowerBand = (lots: bigint) => quote(lots) * EXECUTION_DENOMINATOR >= lots * reference * EXECUTION_LOWER_NUMERATOR;
    const upperBand = (lots: bigint) => quote(lots) * EXECUTION_DENOMINATOR <= lots * reference * EXECUTION_UPPER_NUMERATOR;
    const lower = firstTrue(1n, upper, side === 0 ? lowerBand : upperBand);
    upper = lastTrue(1n, upper, side === 0 ? upperBand : lowerBand);
    return lower <= upper ? { lower, upper, quote } : null;
  });
  let best: FundingAllocation | null = null;
  const consider = (gross: bigint, quantities: bigint[]) => {
    metrics.compositions++;
    if (best === null || (side === 0 ? gross < best.gross : gross > best.gross)) best = { gross, quantities };
  };
  // Stable ties: one leg, ascending instance IDs, descending first quantity.
  for (let maker = 0; maker < 3; maker++) {
    const entry = table[maker];
    if (!entry || quantity < entry.lower || quantity > entry.upper) continue;
    const quantities = [0n, 0n, 0n]; quantities[maker] = quantity;
    consider(entry.quote(quantity), quantities);
  }
  for (let first = 0; first < 3; first++) for (let second = first + 1; second < 3; second++) {
    const left = table[first], right = table[second];
    if (!left || !right) continue;
    const lower = maximum(left.lower, quantity - right.upper), upper = minimum(left.upper, quantity - right.lower);
    if (lower > upper) continue;
    const gross = (lots: bigint) => left.quote(lots) + right.quote(quantity - lots);
    const firstLots = convexMinimum(lower, upper, lots => side === 0 ? gross(lots) : -gross(lots));
    const quantities = [0n, 0n, 0n]; quantities[first] = firstLots; quantities[second] = quantity - firstLots;
    consider(gross(firstLots), quantities);
  }
  return best;
}
