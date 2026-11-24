// Explicit reader for the separately deployed local candidate. Existing account
// readers select their own fixed layout and deployment allowlist.
import {getAddressDecoder} from '@solana/kit';
import {getMarginAccountDecoder,getMarginAccountSize,MARGIN_ACCOUNT_DISCRIMINATOR} from './generated/index.js';
import {MAX_PRICE} from './price-policy-constants.js';
import {requireValue} from './wallet-client.js';

export const PROFIT_ATTRIBUTION_ARTIFACT_SET='profit-attribution-33361d9';
export const SPONSORED_PROFIT_ARTIFACT_SET='sponsored-profit-1763dc7';
export type PerLotProfit={entryScaled:bigint;paidScaled:bigint;denominator:bigint};
const marker=new TextEncoder().encode('RVPROF01');
const closedMarker=new TextEncoder().encode('RVPROF02');
const boundedMarker=new TextEncoder().encode('RVPROF03');
const slotBytes=128;
const boundedBytes=40;

export type EntryCostBounds = {lower:bigint; upper:bigint; referenceLots:bigint};
function gcd(left:bigint,right:bigint) {
  while(right!==0n) [left,right]=[right,left%right];
  return left;
}
function readBounds(bytes:Uint8Array,lots:bigint):EntryCostBounds {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const wide=(offset:number)=>view.getBigUint64(offset,true)+(view.getBigUint64(offset+8,true)<<64n);
  const lower=wide(0), upper=wide(16), referenceLots=view.getBigUint64(32,true);
  const minimum=referenceLots*1_000_000_000n;
  const valid=lots===0n ? lower===0n && upper===0n && referenceLots===0n :
    referenceLots>=(lots<0n?-lots:lots) && referenceLots<=100_000_000n &&
    lower>=minimum && upper>=lower && upper<=minimum*MAX_PRICE && upper-lower<=2n*referenceLots;
  requireValue(valid,'Invalid bounded entry cost.');
  return {lower,upper,referenceLots};
}
function perLot(total:bigint, quantity:bigint):PerLotProfit {
  if(quantity===0n) return {entryScaled:0n,paidScaled:0n,denominator:1n};
  const divisor=gcd(total,quantity);
  return {entryScaled:total/divisor,paidScaled:0n,denominator:quantity/divisor};
}
// The frozen selector authenticates this same canonical fraction on chain.
function frozenHistory(entry:PerLotProfit) {
  const bytes=new Uint8Array(boundedBytes);
  if(entry.entryScaled===0n) return bytes;
  let cursor=6;
  for(const [index,initial] of [entry.entryScaled,0n,entry.denominator].entries()) {
    const start=cursor;
    for(let number=initial;number!==0n;number>>=8n) bytes[cursor++]=Number(number&255n);
    bytes[2*index]=cursor-start;
  }
  return bytes;
}

/** Whole collateral atoms eligible before pool, backing and recipient admission. */
export function ordinaryGainAtoms(claimScaled:bigint, lots:bigint, mark:bigint, entry?:PerLotProfit) {
  const scale=1_000_000_000n;
  if(!entry || lots===0n) return claimScaled>0n?claimScaled/scale:0n;
  requireValue(entry.paidScaled===0n && entry.denominator>0n && mark>0n,'Invalid closed-quantity basis.');
  const open=lots*(mark*scale*entry.denominator-entry.entryScaled);
  const eligible=claimScaled*entry.denominator-(open>0n?open:0n);
  return eligible>0n?eligible/(entry.denominator*scale):0n;
}

function slot(bytes:Uint8Array,lots:bigint):PerLotProfit {
  if(lots===0n) {
    requireValue(bytes.every(byte=>byte===0),'A flat candidate position must have empty attribution.');
    return {entryScaled:0n,paidScaled:0n,denominator:1n};
  }
  const lengths=new DataView(bytes.buffer,bytes.byteOffset,6);
  let cursor=6;
  const number=(index:number)=>{
    const length=lengths.getUint16(2*index,true);
    requireValue(cursor+length<=bytes.length&&(length===0||bytes[cursor+length-1]!==0),'Invalid attribution magnitude.');
    let result=0n;
    for(let offset=length;offset>0;offset--)result=(result<<8n)+BigInt(bytes[cursor+offset-1]);
    cursor+=length;return result;
  };
  const entryScaled=number(0),paidScaled=number(1),denominator=number(2);
  requireValue(entryScaled>0n&&denominator>0n&&gcd(gcd(entryScaled,denominator),paidScaled)===1n&&
    bytes.subarray(cursor).every(byte=>byte===0),'Noncanonical attribution.');
  return {entryScaled,paidScaled,denominator};
}

export function decodeProfitAttribution(bytes:Uint8Array,allowSponsored=false) {
  const prefix=getMarginAccountSize();
  const minimum=prefix+marker.length+2*slotBytes;
  const bounded=boundedMarker.every((byte,index)=>bytes[prefix+index]===byte);
  const expanded=!bounded && bytes.length!==minimum;
  const width=bounded?boundedBytes:expanded?(bytes.length-prefix-marker.length-40)/2:slotBytes;
  const closedQuantity=bounded||closedMarker.every((byte,index)=>bytes[prefix+index]===byte);
  requireValue((!bounded||bytes.length===prefix+8+2*boundedBytes)&&(!expanded||(allowSponsored&&Number.isInteger(width)&&width>slotBytes&&width<=256))&&
    MARGIN_ACCOUNT_DISCRIMINATOR.every((byte,index)=>bytes[index]===byte)&&
    (closedQuantity||marker.every((byte,index)=>bytes[prefix+index]===byte)),'Invalid candidate margin layout.');
  const root=getMarginAccountDecoder().decode(bytes.subarray(0,prefix));
  requireValue(root.schemaVersion===10,'Invalid candidate margin schema.');
  const slots=root.positions.map((_,index)=>{
    const start=prefix+marker.length+index*width;
    return bytes.subarray(start,start+width);
  });
  const entryBounds=bounded?slots.map((bytes,index)=>readBounds(bytes,root.positions[index].lots)):null;
  // Existing default callers consume the endpoint with the least seizable gain.
  const positions=entryBounds?entryBounds.map((entry,index)=>
    perLot(root.positions[index].lots>0n?entry.upper:entry.lower,entry.referenceLots)):
    slots.map((bytes,index)=>slot(bytes,root.positions[index].lots));
  const ordinaryPositions=entryBounds?entryBounds.map((entry,index)=>
    perLot(root.positions[index].lots>0n?entry.lower:entry.upper,entry.referenceLots)):positions;
  const histories=bounded?positions.map(frozenHistory):slots;
  const credit=expanded?{
    contributor:getAddressDecoder().decode(bytes.subarray(bytes.length-40,bytes.length-8)),
    lamports:new DataView(bytes.buffer,bytes.byteOffset+bytes.length-8,8).getBigUint64(0,true),
  }:null;
  requireValue(!closedQuantity||positions.every(entry=>entry.paidScaled===0n),'Open price payment in a closed-quantity account.');
  return {root,positions,ordinaryPositions,entryBounds,histories,width,credit,closedQuantity};
}

export type MarginLayout='profit-attribution'|'sponsored-profit'|'aggregate-fees'|'bounded-market'|'checked-funding'|'market-lanes'|'ledger-lanes'|'selected';
export const hasFundingLayout=(layout?:MarginLayout)=>layout==='checked-funding'||layout==='market-lanes'||layout==='ledger-lanes';
export const hasCapacityLayout=(layout?:MarginLayout)=>layout==='bounded-market'||hasFundingLayout(layout);
export const hasFeeLayout=(layout?:MarginLayout)=>layout==='aggregate-fees'||hasCapacityLayout(layout);
export const feeLaneLayout=(layout?:MarginLayout)=>layout==='ledger-lanes'?'ledger-lanes' as const:hasFundingLayout(layout)?'checked-funding' as const:layout==='bounded-market';
export function decodeMarginForLayout(bytes:Uint8Array,layout:MarginLayout='selected') {
  if(layout==='profit-attribution'||layout==='sponsored-profit'||hasFeeLayout(layout))return decodeProfitAttribution(bytes,layout!=='profit-attribution').root;
  requireValue(MARGIN_ACCOUNT_DISCRIMINATOR.every((byte,index)=>bytes[index]===byte),'Wrong account discriminator.');
  requireValue(layout==='selected'&&bytes.length===getMarginAccountSize(),'Invalid selected margin layout.');
  return getMarginAccountDecoder().decode(bytes);
}
