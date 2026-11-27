import {address, getAddressEncoder, getBase58Decoder, getProgramDerivedAddress, type Address} from '@solana/kit';
import * as clearing from './generated/index.js';
import {deriveAccountVenue} from './account-addresses.js';
import {LOCAL_ORACLE_FIXTURE} from './funding-sources.js';
import {LISTED_EXECUTION_ARTIFACT_SET,qualifiedTradingProfile} from './account-deployment.js';
import {fromBase64, requireValue, type UserRpc} from './wallet-client.js';

const encoder=new TextEncoder();

export const LISTED_CAPITAL_TAG=254;
export function isListedMakerCapital(root:{mode:number;role:number;isolatedMarketIndex:number}) {
  return root.mode===1 && root.role===1 && root.isolatedMarketIndex===LISTED_CAPITAL_TAG;
}

/** The listing namespace uses a canonical, zero-padded eight-byte ASCII ticker. */
export function listingSymbol(ticker:string):Uint8Array {
  requireValue(/^[A-Z][A-Z0-9]{0,7}$/.test(ticker) && ticker!=='BTC' && ticker!=='ETH','Invalid inactive market ticker.');
  const symbol=new Uint8Array(8);
  symbol.set(encoder.encode(ticker));
  return symbol;
}

/** The local SOL/USD fixture, for example, is identified by both its publisher and its feed ID. */
export async function listingOracle(ticker:string,publisher:Address) {
  listingSymbol(ticker);
  const feedId=new Uint8Array(32);
  feedId.set(encoder.encode(ticker+'/USD'));
  const [feed]=await getProgramDerivedAddress({programAddress:LOCAL_ORACLE_FIXTURE,
    seeds:[encoder.encode('feed'),getAddressEncoder().encode(publisher),feedId]});
  return {feed,feedId};
}

/** Discover registered, inactive contracts on a finalized local venue. Live market
 * routing continues to use the venue's admitted market accounts. */
export async function readInactiveMarketListings(rpc:Pick<UserRpc,'call'>,venue:Address) {
  return readMarketListings(rpc,venue);
}

/** Include qualification-only active listings when reading the pinned execution artifact. */
export async function readMarketListings(rpc:Pick<UserRpc,'call'>,venue:Address,artifactSet?:string) {
  const program=clearing.CLEARING_PROGRAM_ADDRESS;
  const accountBytes=(account:any,size:number,tag:ArrayLike<number>)=>{
    requireValue(account?.owner===program && account.executable===false && account.data?.[1]==='base64','Invalid listing account owner or encoding.');
    const bytes=fromBase64(account.data[0]);
    requireValue(bytes.length===size && Array.from(tag).every((byte,i)=>bytes[i]===byte),'Invalid listing account layout.');
    return bytes;
  };
  const bank=await rpc.call('getAccountInfo',[venue,{encoding:'base64',commitment:'finalized'}]);
  const deployment=clearing.getVenueDecoder().decode(accountBytes(bank.value,clearing.getVenueSize(),clearing.VENUE_DISCRIMINATOR));
  const [canonical,bump]=await deriveAccountVenue(Uint8Array.from(deployment.domain));
  requireValue(venue===canonical && deployment.bump===bump && deployment.schemaVersion===10 && qualifiedTradingProfile(deployment.profileVersion,artifactSet),
    'Invalid listing venue.');
  const entries=await rpc.call('getProgramAccounts',[program,{commitment:'finalized',encoding:'base64',minContextSlot:bank.context.slot,
    filters:[{dataSize:clearing.getMarketListingSize()},{memcmp:{offset:0,bytes:getBase58Decoder().decode(clearing.MARKET_LISTING_DISCRIMINATOR)}},
      {memcmp:{offset:18,bytes:venue}}]}]);
  requireValue(Array.isArray(entries),'Incomplete listing discovery.');
  const listings=await Promise.all(entries.map(async(entry)=>{
    const key=address(entry.pubkey);
    const record=clearing.getMarketListingDecoder().decode(accountBytes(entry.account,clearing.getMarketListingSize(),clearing.MARKET_LISTING_DISCRIMINATOR));
    const ticker=new TextDecoder().decode(Uint8Array.from(record.symbol)).replace(/\0+$/,'');
    const symbol=listingSymbol(ticker);
    const [[expected,listingBump],{feed}]=await Promise.all([
      clearing.findListingPda({venue,marketId:record.marketId}),listingOracle(ticker,record.oraclePublisher)]);
    requireValue(key===expected && record.bump===listingBump && record.venue===venue && record.schemaVersion===1 &&
      ((record.status===0 && record.revision===1n) || (record.status===1 && record.revision===2n) ||
        (artifactSet===LISTED_EXECUTION_ARTIFACT_SET && deployment.profileVersion===7 && record.status===2 && record.revision===3n)) &&
      record.marketId>=2 && symbol.every((byte,i)=>byte===record.symbol[i]) &&
      record.lotsPerUnit>0n && record.quoteMint===deployment.quoteMint && record.oracleFeed===feed,'Invalid inactive market binding.');
    return {address:key,ticker,record};
  }));
  requireValue(new Set(listings.map(row=>row.ticker)).size===listings.length &&
    new Set(listings.map(row=>row.record.marketId)).size===listings.length,'Duplicate listing identity.');
  return listings.sort((left,right)=>left.record.marketId-right.record.marketId);
}
