import {getAddressEncoder,getProgramDerivedAddress,type Address} from '@solana/kit';
import {CLEARING_PROGRAM_ADDRESS,getMarketDecoder,getMakerRegistrationDecoder,getVenueDecoder,MARKET_DISCRIMINATOR,VENUE_DISCRIMINATOR} from './generated/index.js';
import {deriveAccountMarket,deriveAccountVenue} from './account-addresses.js';
import {BASIS_POINTS,FUNDING_CAP_BPS,MAX_REFERENCE_PRICE} from './price-policy.js';
import {decodeMakerFeeLane} from './market-fees.js';
import {fromBase64,requireValue,rpcInteger,type UserRpc} from './wallet-client.js';

export const MAX_REGISTERED_MAKERS = 32;
export const MARKET_GROSS_CAP=200_000_000n;

export function decodeCapacityAnchor(bytes:Uint8Array,checkedFunding:boolean|'ledger-lanes'=false){
  const decoder=getMarketDecoder(),prefix=decoder.fixedSize;
  requireValue(bytes.length===prefix+16+(checkedFunding?32:0)&&MARKET_DISCRIMINATOR.every((byte,index)=>bytes[index]===byte),'Invalid market capacity layout.');
  const tail=new DataView(bytes.buffer,bytes.byteOffset+prefix,16);
  const generation=tail.getBigUint64(0,true),initialGross=tail.getBigUint64(8,true);
  requireValue(initialGross<=MARKET_GROSS_CAP&&(generation>0n||initialGross===0n),'Invalid market capacity anchor.');
  const market=decoder.decode(bytes);
  requireValue(market.schemaVersion===10,'Invalid capacity market schema.');
  return {market,generation,initialGross};
}

/** Each input has already been identified by its canonical PDA in this market. */
function readCapacity(marketKey:Address,marketBytes:Uint8Array,registrations:readonly Uint8Array[],checkedFunding:boolean|'ledger-lanes'=false){
  const anchor=decodeCapacityAnchor(marketBytes,checkedFunding);
  requireValue(registrations.length===3,'Incomplete market capacity.');
  const initialFree=MARKET_GROSS_CAP-anchor.initialGross;
  let gross=MARKET_GROSS_CAP;const available:bigint[]=[];
  for(const [index,bytes] of registrations.entries()){
    const {state}=decodeMakerFeeLane(bytes,checkedFunding==='ledger-lanes'?'ledger-lanes':checkedFunding?'checked-funding':true);
    requireValue(state.schemaVersion===10&&state.instance===index&&state.market===marketKey&&state.venue===anchor.market.venue,'Foreign capacity lane.');
    const tail=new DataView(bytes.buffer,bytes.byteOffset+getMakerRegistrationDecoder().fixedSize+16,16);
    const generation=tail.getBigUint64(0,true),stored=tail.getBigUint64(8,true);
    requireValue(generation<=anchor.generation&&stored<=MARKET_GROSS_CAP,'Invalid capacity generation or balance.');
    const free=generation!==0n&&generation===anchor.generation?stored:initialFree/3n+BigInt(BigInt(index)<initialFree%3n);
    requireValue(free<=gross,'Capacity exceeds the market limit.');gross-=free;available.push(free);
  }
  return {grossLots:gross,available,generation:anchor.generation};
}

export function grossFromCapacity(marketKey:Address,marketBytes:Uint8Array,registrations:readonly Uint8Array[],checkedFunding:boolean|'ledger-lanes'=false) {
  return readCapacity(marketKey,marketBytes,registrations,checkedFunding).grossLots;
}

export function makerRegistrationPdas(market:Address){
  return registeredMakerPdas(market, 3);
}

export function registeredMakerPdas(market: Address, count: number) {
  requireValue(Number.isInteger(count) && count >= 3 && count <= MAX_REGISTERED_MAKERS, 'Invalid sealed maker count.');
  return Promise.all(Array.from({length:count},(_,instance)=>getProgramDerivedAddress({programAddress:CLEARING_PROGRAM_ADDRESS,
    seeds:[new TextEncoder().encode('maker-v4'),getAddressEncoder().encode(market),Uint8Array.of(instance)]})));
}

export async function readMarketGross(rpc:Pick<UserRpc,'call'>,venue:Address,index:0|1,commitment:'confirmed'|'finalized'='finalized',checkedFunding:boolean|'ledger-lanes'=false){
  const [market,marketBump]=await deriveAccountMarket(venue,index);
  const makers=await makerRegistrationPdas(market);
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
  const anchor=decodeCapacityAnchor(rows[1],checkedFunding);
  requireValue(venueState.schemaVersion===10&&canonical===venue&&venueState.bump===bump&&venueState.markets[index]===market&&
    anchor.market.venue===venue&&anchor.market.index===index&&anchor.market.bump===marketBump,'Invalid market capacity identity.');
  const lanes=rows.slice(2);
  requireValue(lanes.every((bytes,i)=>decodeMakerFeeLane(bytes,checkedFunding==='ledger-lanes'?'ledger-lanes':checkedFunding?'checked-funding':true).state.bump===makers[i][1]),'Invalid capacity lane bump.');
  return {market,grossLots:grossFromCapacity(market,rows[1],lanes,checkedFunding),slot:rpcInteger(response.context.slot)};
}

/** Cleared by zero initialization. A populated checkpoint contains only the
 * observation identity and the chain Clock of a successful materialization. */
export function decodeFundingTouch(bytes:Uint8Array){
  requireValue(bytes.length===32,'Invalid funding checkpoint size.');
  if(bytes.every(byte=>byte===0))return null;
  const view=new DataView(bytes.buffer,bytes.byteOffset,32);
  const config=view.getBigUint64(0,true),observation=view.getBigUint64(8,true);
  const slot=view.getBigUint64(16,true),timestamp=view.getBigInt64(24,true);
  requireValue(config>0n&&observation>0n&&slot>0n,'Invalid funding checkpoint identity.');
  return {config,observation,slot,timestamp};
}


/** Reconstruct the committed market from its authenticated account and all three
 * registrations from the same RPC context. The Clock only fences the read. */
export function marketFromExecutionLanes(marketKey:Address,marketBytes:Uint8Array,
  registrations:readonly {bytes:Uint8Array;bump:number}[],slot:bigint,active:boolean,ledgerLanes=false){
  const {market}=decodeCapacityAnchor(marketBytes,true);
  const rows=registrations.map(({bytes,bump})=>{
    requireValue(decodeMakerFeeLane(bytes,ledgerLanes?'ledger-lanes':'checked-funding').state.bump===bump,'Invalid execution lane bump.');
    return bytes;
  });
  const capacity=readCapacity(marketKey,marketBytes,rows,ledgerLanes?'ledger-lanes':true);
  const grossLots=capacity.grossLots;
  const oracle=market.oracle;
  if(!active||oracle.heldEpoch!==market.configEpoch||oracle.heldUntil<=oracle.sampledAt)return {...market,grossLots,capacity};
  const maxPremium=MAX_REFERENCE_PRICE*1_000_000_000n*FUNDING_CAP_BPS/BASIS_POINTS;
  const withinIndex=(index:bigint)=>index>=-1_000_000_000_000_000n&&index<=1_000_000_000_000_000n;
  requireValue(market.configEpoch>0n&&market.observationSequence>0n&&oracle.sampledAt>0n&&
    oracle.heldUntil-oracle.sampledAt<=6n&&oracle.heldSlot>market.validFrom&&withinIndex(oracle.fundingBase)&&
    oracle.premiumScaled>=-maxPremium&&oracle.premiumScaled<=maxPremium,'Invalid funding window.');
  const materializations=new Map<bigint,bigint>();
  let latestSlot=-1n,through=oracle.sampledAt;
  const offset=getMakerRegistrationDecoder().fixedSize+32;
  for(const bytes of [marketBytes.subarray(-32),...rows.map(row=>row.subarray(offset,offset+32))]){
    const stamp=decodeFundingTouch(bytes);
    if(!stamp)continue;
    requireValue(stamp.slot<=slot&&stamp.config<=market.configEpoch&&stamp.observation<=market.observationSequence,'Future funding checkpoint.');
    if(stamp.config!==market.configEpoch||stamp.observation!==market.observationSequence)continue;
    const elapsed=stamp.timestamp-oracle.sampledAt,previous=materializations.get(stamp.slot);
    requireValue(stamp.slot>=market.validFrom&&stamp.slot<oracle.heldSlot&&elapsed>=0n&&elapsed<=30n&&
      (previous===undefined||previous===stamp.timestamp),'Invalid funding checkpoint clock.');
    materializations.set(stamp.slot,stamp.timestamp);
    if(stamp.slot>latestSlot){latestSlot=stamp.slot;through=stamp.timestamp<oracle.heldUntil?stamp.timestamp:oracle.heldUntil;}
  }
  const fundingIndexScaled=oracle.fundingBase+oracle.premiumScaled*(through-oracle.sampledAt)/3600n;
  requireValue(withinIndex(fundingIndexScaled),'Funding index exceeds the supported range.');
  return {...market,grossLots,capacity,fundingTime:through,fundingIndexScaled};
}
