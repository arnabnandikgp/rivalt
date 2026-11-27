import {MAX_POSITION_LOTS} from './quantity-limits.js';
import {MAX_PRICE} from './price-policy-constants.js';
import {requireValue} from './wallet-client.js';

export type EntryCostBounds = {lower:bigint; upper:bigint; referenceLots:bigint};
export function readEntryBounds(bytes:Uint8Array,lots:bigint):EntryCostBounds {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const wide=(offset:number)=>view.getBigUint64(offset,true)+(view.getBigUint64(offset+8,true)<<64n);
  const lower=wide(0), upper=wide(16), referenceLots=view.getBigUint64(32,true);
  const minimum=referenceLots*1_000_000_000n;
  const valid=lots===0n ? lower===0n && upper===0n && referenceLots===0n :
    referenceLots>=(lots<0n?-lots:lots) && referenceLots<=MAX_POSITION_LOTS &&
    lower>=minimum && upper>=lower && upper<=minimum*MAX_PRICE && upper-lower<=2n*referenceLots;
  requireValue(valid,'Invalid bounded entry cost.');
  return {lower,upper,referenceLots};
}
