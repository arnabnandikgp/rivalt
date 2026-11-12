import type {Address} from '@solana/kit';
import * as protocol from './generated/index.js';
import {deriveAccountPortfolio,deriveMarginAccount} from './account-addresses.js';
import {decodeMembershipAccount,MEMBER_FINANCIAL,MEMBER_REGISTERED} from './account-membership.js';
import {hex,fromBase64,requireValue,rpcInteger,type UserRpc} from './wallet-client.js';

/** One bounded, coherent owner namespace. Identities include permanent retired
 * slots; the current nine-child policy is separate from venue membership scale. */
export async function readOwnerAccounts(rpc:Pick<UserRpc,'call'>,venue:Address,owner:Address,index:number) {
  const [portfolioKey,portfolioBump]=await deriveAccountPortfolio(venue,owner,index);
  const keys=await Promise.all(Array.from({length:9},(_,child)=>deriveMarginAccount(portfolioKey,child)));
  const response=await rpc.call('getMultipleAccounts',[[portfolioKey,...keys.map(([key])=>key)],{encoding:'base64',commitment:'finalized'}]);
  requireValue(response.value?.length===10,'Incomplete owner discovery.');
  const contextSlot=rpcInteger(response.context.slot);
  const accounts:[Address,protocol.MarginAccount][]=[],retired:[Address,protocol.MarginTombstone][]=[];
  if(response.value[0]===null) {
    requireValue(response.value.slice(1).every((raw:any)=>raw===null),'Owner children without a portfolio.');
    return {portfolio:{address:portfolioKey,account:null},accounts,retired,contextSlot};
  }
  const portfolio=decodeMembershipAccount(response.value[0],protocol.PORTFOLIO_DISCRIMINATOR,protocol.getPortfolioDecoder());
  requireValue(portfolio.schemaVersion===10&&portfolio.venue===venue&&portfolio.owner===owner&&portfolio.index===index
    &&portfolio.bump===portfolioBump&&portfolio.revision>0n&&portfolio.activeChildren<=9,'Portfolio identity mismatch.');
  for(const [child,[key,bump]]of keys.entries()) {
    const raw=response.value[child+1];if(raw===null)continue;
    requireValue(raw?.data?.[1]==='base64','Foreign owner account.');
    const tag=hex(fromBase64(raw.data[0]).slice(0,8));
    if(tag===hex(protocol.MARGIN_TOMBSTONE_DISCRIMINATOR)) {
      const tombstone=decodeMembershipAccount(raw,protocol.MARGIN_TOMBSTONE_DISCRIMINATOR,protocol.getMarginTombstoneDecoder());
      requireValue(tombstone.schemaVersion===10&&tombstone.venue===venue&&tombstone.portfolio===portfolioKey
        &&tombstone.owner===owner&&tombstone.child===child&&tombstone.bump===bump&&tombstone.revision>0n,'Wrong retired owner identity.');
      retired.push([key,tombstone]);continue;
    }
    const root=decodeMembershipAccount(raw,protocol.MARGIN_ACCOUNT_DISCRIMINATOR,protocol.getMarginAccountDecoder());
    requireValue(root.schemaVersion===10&&root.venue===venue&&root.portfolio===portfolioKey&&root.owner===owner
      &&root.subaccountIndex===child&&root.bump===bump&&root.revision>0n,'Owner account identity mismatch.');
    requireValue([0,1,2].includes(root.role)&&(child===0?root.mode===0&&root.isolatedMarketIndex===255&&root.role!==1:
      root.mode===1&&[0,1].includes(root.isolatedMarketIndex)),'Owner account mode mismatch.');
    requireValue([MEMBER_REGISTERED,MEMBER_FINANCIAL].includes(root.lifecycle)
      &&(root.lifecycle!==MEMBER_FINANCIAL||root.activationGeneration>0n),'Owner account lifecycle mismatch.');
    accounts.push([key,root]);
  }
  requireValue(accounts.length===portfolio.activeChildren,'Incomplete owner namespace.');
  const identities=[...accounts.map(([,root])=>root.id),...retired.map(([,root])=>root.id)];
  requireValue(new Set(identities).size===identities.length,'Aliased owner identities.');
  return {portfolio:{address:portfolioKey,account:portfolio},accounts,retired,contextSlot};
}
