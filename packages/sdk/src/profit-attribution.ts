// Explicit reader for the separately deployed local candidate. Existing account
// readers select their own fixed layout and deployment allowlist.
import {getMarginAccountDecoder,getMarginAccountSize,MARGIN_ACCOUNT_DISCRIMINATOR} from './generated/index.js';
import {requireValue} from './wallet-client.js';

export const PROFIT_ATTRIBUTION_ARTIFACT_SET='profit-attribution-33361d9';
export type PerLotProfit={entryScaled:bigint;paidScaled:bigint;denominator:bigint};
const marker=new TextEncoder().encode('RVPROF01');
const slotBytes=128;

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
  const gcd=(left:bigint,right:bigint)=>{while(right!==0n)[left,right]=[right,left%right];return left;};
  requireValue(entryScaled>0n&&denominator>0n&&gcd(gcd(entryScaled,denominator),paidScaled)===1n&&
    bytes.subarray(cursor).every(byte=>byte===0),'Noncanonical attribution.');
  return {entryScaled,paidScaled,denominator};
}

export function decodeProfitAttribution(bytes:Uint8Array) {
  const prefix=getMarginAccountSize();
  requireValue(bytes.length===prefix+marker.length+2*slotBytes&&
    MARGIN_ACCOUNT_DISCRIMINATOR.every((byte,index)=>bytes[index]===byte)&&
    marker.every((byte,index)=>bytes[prefix+index]===byte),'Invalid candidate margin layout.');
  const root=getMarginAccountDecoder().decode(bytes.subarray(0,prefix));
  requireValue(root.schemaVersion===10,'Invalid candidate margin schema.');
  const positions=root.positions.map((position,index)=>{
    const start=prefix+marker.length+index*slotBytes;
    return slot(bytes.subarray(start,start+slotBytes),position.lots);
  });
  return {root,positions};
}

export type MarginLayout='profit-attribution'|'selected';
export function decodeMarginForLayout(bytes:Uint8Array,layout:MarginLayout='selected') {
  if(layout==='profit-attribution')return decodeProfitAttribution(bytes).root;
  requireValue(MARGIN_ACCOUNT_DISCRIMINATOR.every((byte,index)=>bytes[index]===byte),'Wrong account discriminator.');
  requireValue(layout==='selected'&&bytes.length===getMarginAccountSize(),'Invalid selected margin layout.');
  return getMarginAccountDecoder().decode(bytes);
}
