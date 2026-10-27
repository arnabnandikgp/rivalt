import type {ClearingGroupV2, GroupMarketV2, MarginAccountV2} from './generated/index.js';
import {effectiveFunding, oracleMode} from './oracle-policy.js';
import {marginBalanceView, marginOrderRemaining, type MarginPreview} from './margin-balance.js';
export type GroupPreview<T> = MarginPreview<T>;
export {marginOrderRemaining as groupOrderRemaining};
type Root = GroupPreview<Omit<MarginAccountV2,'bump'|'discriminator'>>;
type Market = GroupPreview<Omit<GroupMarketV2,'bump'|'discriminator'>>;
type Group = GroupPreview<Pick<ClearingGroupV2,'mode'|'paused'>>;

export function effectiveGroupFunding(group:Group, market:Market, now:bigint, slot:bigint) {
  return effectiveFunding({...market,mode:[1,2].includes(group.mode)?2:group.mode},market,now,slot);
}
export function groupSourceMode(group:Group, market:Market, now:bigint, slot:bigint) {
  return oracleMode({...market,mode:group.mode===3?3:2},market,now,slot);
}
/** V2 retains its complete group certificate policy. Shared arithmetic does not
 * import that withdrawal prerequisite into the V3 account contract. */
export function groupBalanceView(root:Root, group:Group, markets:Market[], now:bigint, slot:bigint) {
  if(root.schemaVersion!==2||markets.some((market,index)=>market.schemaVersion!==2||market.group!==root.group||market.index!==index))
    throw new Error('Invalid group preview dependencies');
  return {...marginBalanceView(root,markets,markets.map(market=>effectiveGroupFunding(group,market,now,slot)),
    markets.map(market=>groupSourceMode(group,market,now,slot)),now,slot,group.mode===3),
    withdrawableCash:null,withdrawalStatus:'RequiresFreshGroupCertificateAndSimulation',paused:group.paused};
}
