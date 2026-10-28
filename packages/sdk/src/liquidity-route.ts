import type { Address } from '@solana/kit';
import type { MarginRouteIntent } from './margin-allocation.js';
import type { readLiquidityTradeSnapshot } from './account-snapshot.js';
import { accountSourceMode,effectiveAccountFunding } from './account-balance.js';
import { allocateLiquidityRoute } from './liquidity-allocation.js';
import { requireValue } from './wallet-client.js';

/** Mathematical/financial preview only. Profile 4 cannot execute a trade until
 * the P32 on-chain integration and safety gate. No old-profile builder is used. */
export function previewLiquidityRoute(input: MarginRouteIntent & {
  snapshot: Awaited<ReturnType<typeof readLiquidityTradeSnapshot>>; trader: Address;
}) {
  const { snapshot,trader,marketIndex } = input;
  const root = snapshot.roots[trader];
  requireValue(snapshot.venueState.profileVersion === 4 && snapshot.liquidity && root?.schemaVersion === 3
    && root.venue === snapshot.venue && root.role === 0 && !snapshot.safetyState.paused
    && ![2,3,4].includes(snapshot.safetyState.mode), 'Liquidity preview unavailable.');
  requireValue(root.mode !== 0 || snapshot.marketStates[marketIndex].crossEligible, 'Market is not cross eligible.');
  return allocateLiquidityRoute({ ...input,root,makers: snapshot.liquidity.adapters,markets: snapshot.marketStates,
    slot: snapshot.slot,now: snapshot.now,
    sources: snapshot.marketStates.map(market => accountSourceMode(snapshot.safetyState,market,snapshot.now,snapshot.slot)),
    funding: snapshot.marketStates.map(market => effectiveAccountFunding(snapshot.safetyState,market,snapshot.now,snapshot.slot)),
  });
}
