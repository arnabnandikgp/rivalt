import type { LiquidityAdapter } from './liquidity-adapter.js';
import { requireValue } from './wallet-client.js';

export type FundingAllocation = Readonly<{ gross: bigint; quantities: readonly bigint[] }>;

/** Exact bounded enumeration over published prices. No cash, claims, orders,
 * funding checkpoints, margin projection or taker fees participate in funding. */
export function allocateFundingSide(makers: readonly Pick<LiquidityAdapter, 'quote'>[], reference: bigint,
  quantity: bigint, side: 0 | 1): FundingAllocation | null {
  requireValue(makers.length === 3 && reference >= 10_000n && reference <= 100_000n
    && quantity > 0n && quantity <= 600n && (side === 0 || side === 1), 'Invalid funding allocation domain.');
  const count = Number(quantity);
  const prices = makers.map(maker => Array.from({ length: count + 1 }, (_, lots) => {
    if (lots === 0) return 0n;
    try {
      const gross = maker.quote(side, BigInt(lots)).gross;
      const notional = BigInt(lots) * reference;
      return gross * 10n >= notional * 9n && gross * 10n <= notional * 11n ? gross : 0n;
    } catch { return 0n; } // quantity outside the authenticated curve's domain/depth
  }));
  let best: FundingAllocation | null = null;
  const consider = (gross: bigint, quantities: bigint[]) => {
    if (gross > 0n && (best === null || (side === 0 ? gross < best.gross : gross > best.gross))) best = { gross, quantities };
  };
  // Stable ties: one leg, then ascending instance IDs, then descending first quantity.
  for (let maker = 0; maker < 3; maker++) {
    const quantities = [0n, 0n, 0n]; quantities[maker] = quantity;
    consider(prices[maker][count], quantities);
  }
  for (let first = 0; first < 3; first++) for (let second = first + 1; second < 3; second++) {
    for (let firstLots = count - 1; firstLots > 0; firstLots--) {
      const secondLots = count - firstLots;
      if (prices[first][firstLots] === 0n || prices[second][secondLots] === 0n) continue;
      const quantities = [0n, 0n, 0n]; quantities[first] = BigInt(firstLots); quantities[second] = BigInt(secondLots);
      consider(prices[first][firstLots] + prices[second][secondLots], quantities);
    }
  }
  return best;
}
