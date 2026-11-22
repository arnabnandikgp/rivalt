import {address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';

/** A successful action must advance this monotone stamp. Unchanged finalized
 * state proves no economic success only after finalized blockhash expiry; it
 * never proves an unseen failed transaction paid no fee. */
export type AccountAuthority={kind:'accountStateVersion'|'accountRevision'|'accountObservation'|'backingRevision';venue:string;account:string;value:string};
export async function accountAuthorityValue(authority:AccountAuthority,bytes:Buffer,layout:sdk.MarginLayout='selected'):Promise<bigint> {
  const venue=address(authority.venue),key=address(authority.account);
  const tagged=(discriminator:ArrayLike<number>,size:number)=>{
    if(bytes.length!==size||!bytes.subarray(0,8).equals(Buffer.from(discriminator)))throw new Error('Wrong account authority schema');
  };
  if(authority.kind==='accountStateVersion'||authority.kind==='accountRevision') {
    if(layout==='selected')tagged(sdk.MARGIN_ACCOUNT_DISCRIMINATOR,sdk.getMarginAccountSize());
    const root=sdk.decodeMarginForLayout(bytes,layout);
    const [canonical,bump]=await sdk.deriveMarginAccount(root.portfolio,root.subaccountIndex);
    if(root.schemaVersion!==10||root.venue!==venue||canonical!==key||root.bump!==bump)throw new Error('Account root authority binding');
    return authority.kind==='accountRevision'?root.revision:root.stateVersion;
  }
  if(authority.kind==='accountObservation') {
    if(!sdk.hasCapacityLayout(layout))tagged(sdk.MARKET_DISCRIMINATOR,sdk.getMarketSize());
    const market=sdk.hasCapacityLayout(layout)?sdk.decodeCapacityAnchor(bytes,sdk.hasFundingLayout(layout)).market:sdk.getMarketDecoder().decode(bytes);
    const [canonical,bump]=await sdk.deriveAccountMarket(venue,market.index);
    if(market.schemaVersion!==10||market.venue!==venue||canonical!==key||market.bump!==bump)throw new Error('Account observation authority binding');
    return market.observationSequence;
  }
  if(authority.kind==='backingRevision') {
    tagged(sdk.SETTLEMENT_CERTIFICATE_DISCRIMINATOR,sdk.getSettlementCertificateSize());
    const certificate=sdk.getSettlementCertificateDecoder().decode(bytes);
    if(certificate.marketIndex>1)throw new Error('Backing certificate market');
    const [canonical,bump]=await sdk.deriveSettlementCertificate(venue,certificate.marketIndex);
    if(certificate.schemaVersion!==10||certificate.venue!==venue||canonical!==key||certificate.bump!==bump)
      throw new Error('Backing certificate authority binding');
    return certificate.revision;
  }
  throw new Error('Unknown account authority');
}
