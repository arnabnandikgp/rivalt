/** Existing checked financial domain, not a promise of executable liquidity.
 * Mirrors financial_core::MAX_LOTS/MAX_CASH; wire scalars remain u64/i64. */
export const MAX_POSITION_LOTS = 100_000_000n;
export const MAX_ACTION_LOTS = MAX_POSITION_LOTS;
export const MAX_MAKER_DEPTH_LOTS = MAX_POSITION_LOTS;
export const MAX_CASH_ATOMS = 1_000_000_000_000_000n;
