import {address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';

/** A successful action must advance this monotone stamp. Unchanged finalized
 * state proves no economic success only after finalized blockhash expiry; it
 * never proves an unseen failed transaction paid no fee. */
export type AccountAuthority={kind:'accountStateVersion'|'accountMakerEpoch'|'accountObservation';venue:string;account:string;value:string};
export async function accountAuthorityValue(authority:AccountAuthority,bytes:Buffer):Promise<bigint> {
  const venue=address(authority.venue),key=address(authority.account);
  const tagged=(discriminator:ArrayLike<number>,size:number)=>{
    if(bytes.length!==size||!bytes.subarray(0,8).equals(Buffer.from(discriminator)))throw new Error('Wrong account authority schema');
  };
  if(authority.kind==='accountStateVersion') {
    tagged(sdk.MARGIN_ACCOUNT_V3_DISCRIMINATOR,sdk.getMarginAccountV3Size());const root=sdk.getMarginAccountV3Decoder().decode(bytes);
    const [canonical,bump]=await sdk.findMarginV3Pda(root.portfolio,root.subaccountIndex);
    if(root.schemaVersion!==3||root.venue!==venue||canonical!==key||root.bump!==bump)throw new Error('Account root authority binding');
    return root.stateVersion;
  }
  if(authority.kind==='accountMakerEpoch') {
    tagged(sdk.MAKER_REGISTRATION_V3_DISCRIMINATOR,sdk.getMakerRegistrationV3Size());const registration=sdk.getMakerRegistrationV3Decoder().decode(bytes);
    const [market]=await sdk.findMarketV3Pda(venue,registration.marketIndex),[canonical,bump]=await sdk.findAccountMakerV3Pda(market,registration.makerId);
    if(registration.schemaVersion!==3||registration.venue!==venue||registration.market!==market||canonical!==key||registration.bump!==bump)throw new Error('Account maker authority binding');
    return registration.quoteEpoch;
  }
  if(authority.kind==='accountObservation') {
    tagged(sdk.MARKET_V3_DISCRIMINATOR,sdk.getMarketV3Size());const market=sdk.getMarketV3Decoder().decode(bytes);
    const [canonical,bump]=await sdk.findMarketV3Pda(venue,market.index);
    if(market.schemaVersion!==3||market.venue!==venue||canonical!==key||market.bump!==bump)throw new Error('Account observation authority binding');
    return market.observationSequence;
  }
  throw new Error('Unknown account authority');
}
