import type { MarginAccountV3 } from '@rivalt/sdk';
import { accountLabel as marginLabel } from '../group/model.js';

/** Registered operator slots remain visible for owner cash management. */
export function accountLabel(root: Pick<MarginAccountV3, 'mode' | 'isolatedMarketIndex' | 'subaccountIndex' | 'role'>) {
  const label = marginLabel(root);
  return root.role === 0 ? label : `${label} · ${root.role === 1 ? 'Maker capital' : 'Liquidation receiver'}`;
}
