import type { LiquidityAdapter } from './liquidity-adapter.js';
import type { LiquidityRouteInput } from './liquidity-route.js';
import { quoteCanonical } from './canonical-quote.js';
import { MAX_POSITION_LOTS } from './quantity-limits.js';
import { EXECUTION_DENOMINATOR, EXECUTION_LOWER_NUMERATOR, EXECUTION_UPPER_NUMERATOR } from './price-policy.js';
import { lastTrue } from './quantity-search.js';

type MakerDepth = { id: number; quantity: bigint; gross: bigint };
const min = (left: bigint, right: bigint) => left < right ? left : right;

// An upper bound on a leg, before clearing checks whole-account margin, fees and signed limits.
export function makerDepth(input: LiquidityRouteInput, maker: LiquidityAdapter): MakerDepth {
  const { side, lots, marketIndex, snapshot, trader } = input;
  const id = maker.config.instance;
  const empty = { id, quantity: 0n, gross: 0n };
  if (maker.capital.owner === snapshot.roots[trader].owner ||
      (maker.unavailable !== null && maker.unavailable !== 'stale-publication')) return empty;

  const market = snapshot.marketStates[marketIndex];
  if (market.upper <= 0n) return empty;
  const inventory = maker.capital.positions[marketIndex].lots;
  const reducing = side === 0 ? inventory : -inventory;
  const inventoryCap = side === 0 ? maker.shape.shortCap : maker.shape.longCap;
  const fundedCap = min(MAX_POSITION_LOTS, maker.capital.cash * 10n / market.upper);
  let quantity = min(lots, maker.depthHints(side).at(-1) ?? 0n);
  quantity = min(quantity, reducing + min(inventoryCap, fundedCap));
  if (maker.shape.mode === 3) quantity = min(quantity, reducing);
  if (quantity <= 0n) return empty;

  const consumed = side === 0 ? maker.registrationState.buyConsumed : maker.registrationState.sellConsumed;
  const quote = (size: bigint) => {
    try { return quoteCanonical(maker.shape, maker.price.anchor, side, size, inventory, consumed).gross; }
    catch { return null; }
  };
  // Successive asks increase and bids decrease. Numeric price validity and
  // the adverse side of the average execution collar therefore define prefixes.
  const allowed = (gross: bigint | null, size: bigint) => gross !== null && (side === 0
    ? gross * EXECUTION_DENOMINATOR <= size * market.referencePrice * EXECUTION_UPPER_NUMERATOR
    : gross * EXECUTION_DENOMINATOR >= size * market.referencePrice * EXECUTION_LOWER_NUMERATOR);
  let gross = quote(quantity);
  if (!allowed(gross, quantity)) {
    quantity = lastTrue(1n, quantity, size => allowed(quote(size), size));
    if (quantity === 0n) return empty;
    gross = quote(quantity);
  }
  if (gross === null || gross * EXECUTION_DENOMINATOR < quantity * market.referencePrice * EXECUTION_LOWER_NUMERATOR ||
      gross * EXECUTION_DENOMINATOR > quantity * market.referencePrice * EXECUTION_UPPER_NUMERATOR) return empty;
  return { id, quantity, gross };
}

/** Order fees are monotone in gross. Rank by average price and only admit a
 * preferred maker if the remaining leg slots can still cover the target.
 * Keep an already admitted preview route and pad spare account slots for repricing. */
export function selectMakerIds(books: MakerDepth[], side: 0 | 1, lots: bigint, legs: number, width: number,
    previewIds: readonly number[]): Set<number> {
  const ranked = [...books].sort((left, right) => {
    if ((left.quantity > 0n) !== (right.quantity > 0n)) return left.quantity > 0n ? -1 : 1;
    const difference = left.gross * right.quantity - right.gross * left.quantity;
    if (difference !== 0n) return (difference < 0n) === (side === 0) ? -1 : 1;
    if (left.quantity !== right.quantity) return left.quantity > right.quantity ? -1 : 1;
    return left.id - right.id;
  });
  const selected = new Set(previewIds);
  if (selected.size === 0) {
    // capacity[i][k] is the greatest quantity available from k legs at or after i.
    const capacity = Array.from({ length: ranked.length + 1 }, () => Array<bigint>(legs + 1).fill(0n));
    for (let index = ranked.length - 1; index >= 0; index--) {
      for (let slots = 1; slots <= legs; slots++) {
        const take = ranked[index].quantity + capacity[index + 1][slots - 1];
        const skip = capacity[index + 1][slots];
        capacity[index][slots] = take > skip ? take : skip;
      }
    }
    let remaining = min(lots, capacity[0][legs]);
    for (const [index, book] of ranked.entries()) {
      if (remaining <= 0n) break;
      if (book.quantity + capacity[index + 1][legs - selected.size - 1] < remaining) continue;
      selected.add(book.id);
      remaining -= book.quantity;
    }
  }
  for (const book of ranked) {
    if (selected.size === width) break;
    selected.add(book.id);
  }
  return selected;
}
