import { BTC_LOTS_PER_UNIT, ETH_LOTS_PER_UNIT, COLLATERAL_ATOMS_PER_UNIT } from './price-policy-constants.js';
export * from './price-policy-constants.js';

/** Explicit market units. Unsupported lot sizes never select a fallback policy. */
export function priceSourceMultiplier(lotsPerUnit: bigint): bigint | null {
  return lotsPerUnit === BTC_LOTS_PER_UNIT || lotsPerUnit === ETH_LOTS_PER_UNIT
    ? COLLATERAL_ATOMS_PER_UNIT / lotsPerUnit : null;
}
