// The canonical MarginAccount prefix owns collateral and the two original market positions.
// This directory immediately follows their fixed-width entry costs on wider deployments.
import {getMarginAccountDecoder,getMarginAccountSize,MARGIN_ACCOUNT_DISCRIMINATOR} from './generated/index.js';
import {requireValue} from './wallet-client.js';
import {readEntryBounds} from './entry-bounds.js';
import {MAX_POSITION_LOTS} from './quantity-limits.js';

const marker = new TextEncoder().encode('RVMKTS01');
const entryMarker = new TextEncoder().encode('RVPROF03');
export const INLINE_MARGIN_BYTES = getMarginAccountSize() + 8 + 2 * 40;
const headerBytes = 18;
const recordBytes = 98;

export function listedMarginCapacity(root:{mode:number;isolatedMarketIndex:number;role:number}) {
  if(root.mode===0 && root.isolatedMarketIndex===255 && root.role!==1) return 6;
  if(root.mode===1 && root.isolatedMarketIndex===254 && root.role===1) return 1;
  return 0;
}

export function decodeListedMargin(bytes:Uint8Array) {
  requireValue(bytes.length>=INLINE_MARGIN_BYTES+headerBytes &&
    MARGIN_ACCOUNT_DISCRIMINATOR.every((byte,i)=>bytes[i]===byte) &&
    entryMarker.every((byte,i)=>bytes[getMarginAccountSize()+i]===byte) &&
    marker.every((byte,i)=>bytes[INLINE_MARGIN_BYTES+i]===byte),'Invalid listed margin layout.');
  const root = getMarginAccountDecoder().decode(bytes.subarray(0,getMarginAccountSize()));
  const inlineEntries = root.positions.map((position,index)=>{
    const offset=getMarginAccountSize()+8+40*index;
    return readEntryBounds(bytes.subarray(offset,offset+40),position.lots);
  });
  const capacity = listedMarginCapacity(root);
  requireValue(root.schemaVersion===10 && capacity>0 &&
    bytes.length===INLINE_MARGIN_BYTES+headerBytes+capacity*recordBytes,'Invalid listed margin capacity.');
  return {root,inlineEntries,capacity,...decodeListedRecords(bytes.subarray(INLINE_MARGIN_BYTES),capacity,false)};
}

export function decodeListedRecords(directory:Uint8Array,capacity:number,packed:boolean) {
  requireValue(Number.isInteger(capacity) && capacity>0 && directory.length>=headerBytes
    && marker.every((byte,i)=>directory[i]===byte),'Invalid listed directory header.');
  const view = new DataView(directory.buffer,directory.byteOffset,directory.byteLength);
  const signedWide = (offset:number)=>view.getBigUint64(offset,true)+(view.getBigInt64(offset+8,true)<<64n);
  const lastIncarnation = view.getBigUint64(8,true);
  const count = view.getUint16(16,true);
  requireValue(count<=capacity && directory.length===headerBytes+(packed?count:capacity)*recordBytes && directory.subarray(headerBytes+count*recordBytes).every(byte=>byte===0),'Invalid listed margin occupancy.');
  const records = [];
  const incarnations = new Set<bigint>();
  let priorMarket = 1;
  for(let index=0;index<count;index++) {
    const offset=headerBytes+index*recordBytes;
    const market=view.getUint16(offset,true),incarnation=view.getBigUint64(offset+2,true);
    const lots=view.getBigInt64(offset+10,true),virtualScaled=signedWide(offset+18);
    const fundingCheckpointScaled=signedWide(offset+34),generation=view.getBigUint64(offset+50,true);
    requireValue(market>priorMarket && incarnation>0n && incarnation<=lastIncarnation && !incarnations.has(incarnation) &&
      lots>=-MAX_POSITION_LOTS && lots<=MAX_POSITION_LOTS && (lots===0n||generation<0xffffffffffffffffn) &&
      virtualScaled>=-(10n**26n) && virtualScaled<=10n**26n &&
      fundingCheckpointScaled>=-(10n**15n) && fundingCheckpointScaled<=10n**15n &&
      (lots!==0n||virtualScaled!==0n),'Invalid listed margin position.');
    const entry=readEntryBounds(directory.subarray(offset+58,offset+recordBytes),lots);
    records.push({market,incarnation,lots,virtualScaled,fundingCheckpointScaled,generation,entry});
    incarnations.add(incarnation);
    priorMarket=market;
  }
  return {lastIncarnation,records};
}
