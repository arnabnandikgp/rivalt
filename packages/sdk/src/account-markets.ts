import type { Address } from '@solana/kit';
import type { MarginAccount } from './generated/index.js';
import { requireValue } from './wallet-client.js';

/** Conservative transaction dependencies, including stored active authority that
 * may expire on landing. Clearing independently derives and enforces this union. */
export function requiredAccountMarkets(roots: readonly MarginAccount[], requested = 0): number {
  requireValue(Number.isInteger(requested) && requested >= 0 && requested < 4, 'Invalid market dependency mask.');
  let mask = requested;
  for (const root of roots) {
    requireValue(root?.schemaVersion === 7 && root.positions.length === 2 && root.book.orders.length === 4
      && [0, 1].includes(root.mode), 'Invalid account market dependencies.');
    for (const [index, position] of root.positions.entries()) {
      if (position.lots !== 0n || position.virtualScaled !== 0n) mask |= 1 << index;
    }
    for (const stored of root.book.orders) {
      requireValue(Number.isInteger(stored.order.state) && stored.order.state >= 0 && stored.order.state <= 6,
        'Invalid stored order state.');
      if (stored.order.state === 1 || stored.order.state === 2) {
        requireValue([0, 1].includes(stored.marketIndex), 'Invalid active order market.');
        mask |= 1 << stored.marketIndex;
      }
    }
    requireValue(root.mode === 0 || [0, 1].includes(root.isolatedMarketIndex)
      && root.positions.every((position, index) => index === root.isolatedMarketIndex
        || position.lots === 0n && position.virtualScaled === 0n), 'Invalid isolated account dependencies.');
  }
  return mask;
}

export function accountMarketMetas(markets: readonly Address[], roots: readonly MarginAccount[], requested = 0) {
  requireValue(markets.length === 2 && markets[0] !== markets[1], 'Canonical market pair required.');
  const mask = requiredAccountMarkets(roots, requested);
  return { btc: mask & 1 ? markets[0] : undefined, eth: mask & 2 ? markets[1] : undefined };
}

/** Liability proofs depend on cash/claim changes, not inert order metadata. */
export function requiredAccountLiabilities(roots: readonly MarginAccount[], requested = 0): number {
  requiredAccountMarkets(roots, requested); // Validate the same canonical root bounds.
  return roots.reduce((mask, root) => root.positions.reduce((value, position, index) =>
    value | (position.lots !== 0n || position.virtualScaled !== 0n ? 1 << index : 0), mask), requested);
}

export function accountLiabilityMetas(ledgers: readonly Address[], roots: readonly MarginAccount[], requested = 0) {
  requireValue(ledgers.length === 2 && ledgers[0] !== ledgers[1], 'Canonical ledger pair required.');
  const mask = requiredAccountLiabilities(roots, requested);
  return { btcLedger: mask & 1 ? ledgers[0] : undefined, ethLedger: mask & 2 ? ledgers[1] : undefined };
}
