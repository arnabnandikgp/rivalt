import {address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';

/** A successful action must advance this monotone stamp. Unchanged finalized
 * state proves no economic success only after finalized blockhash expiry; it
 * never proves an unseen failed transaction paid no fee. */
export type AccountAuthority={kind:'accountStateVersion'|'accountObservation';venue:string;account:string;value:string};
export async function accountAuthorityValue(authority:AccountAuthority,bytes:Buffer):Promise<bigint> {
  const venue=address(authority.venue),key=address(authority.account);
  const tagged=(discriminator:ArrayLike<number>,size:number)=>{
    if(bytes.length!==size||!bytes.subarray(0,8).equals(Buffer.from(discriminator)))throw new Error('Wrong account authority schema');
  };
  if(authority.kind==='accountStateVersion') {
    tagged(sdk.MARGIN_ACCOUNT_DISCRIMINATOR,sdk.getMarginAccountSize());const root=sdk.getMarginAccountDecoder().decode(bytes);
    const [canonical,bump]=await sdk.deriveMarginAccount(root.portfolio,root.subaccountIndex);
    if(root.schemaVersion!==3||root.venue!==venue||canonical!==key||root.bump!==bump)throw new Error('Account root authority binding');
    return root.stateVersion;
  }
  if(authority.kind==='accountObservation') {
    tagged(sdk.MARKET_DISCRIMINATOR,sdk.getMarketSize());const market=sdk.getMarketDecoder().decode(bytes);
    const [canonical,bump]=await sdk.deriveAccountMarket(venue,market.index);
    if(market.schemaVersion!==3||market.venue!==venue||canonical!==key||market.bump!==bump)throw new Error('Account observation authority binding');
    return market.observationSequence;
  }
  throw new Error('Unknown account authority');
}
