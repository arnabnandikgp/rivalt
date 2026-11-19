import {getAddressEncoder,getProgramDerivedAddress,type Address} from '@solana/kit';
import {CLEARING_PROGRAM_ADDRESS,getMarketDecoder,getVenueDecoder,MARKET_DISCRIMINATOR,VENUE_DISCRIMINATOR} from './generated/index.js';
import {deriveAccountMarket,deriveAccountVenue} from './account-addresses.js';
import {decodeMakerFeeLane} from './market-fees.js';
import {fromBase64,requireValue,rpcInteger,type UserRpc} from './wallet-client.js';

const MAX_GROSS=200_000_000n;

export function decodeCapacityAnchor(bytes:Uint8Array){
  const decoder=getMarketDecoder(),prefix=decoder.fixedSize;
  requireValue(bytes.length===prefix+16&&MARKET_DISCRIMINATOR.every((byte,index)=>bytes[index]===byte),'Invalid market capacity layout.');
  const tail=new DataView(bytes.buffer,bytes.byteOffset+prefix,16);
  const generation=tail.getBigUint64(0,true),initialGross=tail.getBigUint64(8,true);
  requireValue(initialGross<=MAX_GROSS&&(generation>0n||initialGross===0n),'Invalid market capacity anchor.');
  const market=decoder.decode(bytes);
  requireValue(market.schemaVersion===10,'Invalid capacity market schema.');
  return {market,generation,initialGross};
}

/** Each input has already been identified by its canonical PDA in this market. */
export function grossFromCapacity(marketKey:Address,marketBytes:Uint8Array,registrations:readonly Uint8Array[]){
  const anchor=decodeCapacityAnchor(marketBytes);
  requireValue(registrations.length===3,'Incomplete market capacity.');
  const initialFree=MAX_GROSS-anchor.initialGross;
  let gross=MAX_GROSS;
  for(const [index,bytes] of registrations.entries()){
    const {state}=decodeMakerFeeLane(bytes,true);
    requireValue(state.schemaVersion===10&&state.instance===index&&state.market===marketKey&&state.venue===anchor.market.venue,'Foreign capacity lane.');
    const tail=new DataView(bytes.buffer,bytes.byteOffset+bytes.length-16,16);
    const generation=tail.getBigUint64(0,true),stored=tail.getBigUint64(8,true);
    requireValue(generation<=anchor.generation&&stored<=MAX_GROSS,'Invalid capacity generation or balance.');
    const free=generation!==0n&&generation===anchor.generation?stored:initialFree/3n+BigInt(BigInt(index)<initialFree%3n);
    requireValue(free<=gross,'Capacity exceeds the market limit.');gross-=free;
  }
  return gross;
}

export async function readMarketGross(rpc:Pick<UserRpc,'call'>,venue:Address,index:0|1,commitment:'confirmed'|'finalized'='finalized'){
  const [market,marketBump]=await deriveAccountMarket(venue,index);
  const makers=await Promise.all([0,1,2].map(instance=>getProgramDerivedAddress({programAddress:CLEARING_PROGRAM_ADDRESS,
    seeds:[new TextEncoder().encode('maker-v4'),getAddressEncoder().encode(market),Uint8Array.of(instance)]})));
  const keys=[venue,market,...makers.map(([key])=>key)];
  const response=await rpc.call('getMultipleAccounts',[keys,{encoding:'base64',commitment}]);
  requireValue(response.value.length===5,'Incomplete market capacity read.');
  const rows:Uint8Array[]=response.value.map((account:{owner:string;executable:boolean;data:[string,string]}|null)=>{
    requireValue(account?.owner===CLEARING_PROGRAM_ADDRESS&&!account.executable&&account.data[1]==='base64','Invalid market capacity owner.');
    return fromBase64(account!.data[0]);
  });
  const venueDecoder=getVenueDecoder();
  requireValue(rows[0].length===venueDecoder.fixedSize&&VENUE_DISCRIMINATOR.every((byte,i)=>byte===rows[0][i]),'Invalid capacity venue.');
  const venueState=venueDecoder.decode(rows[0]),[canonical,bump]=await deriveAccountVenue(Uint8Array.from(venueState.domain));
  const anchor=decodeCapacityAnchor(rows[1]);
  requireValue(venueState.schemaVersion===10&&canonical===venue&&venueState.bump===bump&&venueState.markets[index]===market&&
    anchor.market.venue===venue&&anchor.market.index===index&&anchor.market.bump===marketBump,'Invalid market capacity identity.');
  const lanes=rows.slice(2);
  requireValue(lanes.every((bytes,i)=>decodeMakerFeeLane(bytes,true).state.bump===makers[i][1]),'Invalid capacity lane bump.');
  return {market,grossLots:grossFromCapacity(market,rows[1],lanes),slot:rpcInteger(response.context.slot)};
}
