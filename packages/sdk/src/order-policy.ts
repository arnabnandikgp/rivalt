import {getLegacyOrderBookDecoder,type LegacyOrderBook} from './generated/index.js';
const abs=(n:bigint)=>n<0n?-n:n;
export const emptyLegacyOrderBook=():LegacyOrderBook=>{const d=getLegacyOrderBookDecoder();return d.decode(new Uint8Array(d.fixedSize));};
export const activeOrder=(o:any)=>o.state===1||o.state===2;
export function orderRemaining(p:any,o:any,terms:bigint,slot:bigint):bigint{
  if(!activeOrder(o)||BigInt(o.termsEpoch)!==terms||slot>=BigInt(o.expirySlot))return 0n;
  let n=BigInt(o.lots)-BigInt(o.filled),q=BigInt(p.lots);
  if(o.reduceOnly){
    if(BigInt(o.generation)!==BigInt(p.generation)||q===0n||(o.side===0)!==(q<0n))return 0n;
    if(n>abs(q))n=abs(q);
  }
  if(BigInt(o.groupId)>0n){const g=p.book.groups.find((g:any)=>BigInt(g.id)===BigInt(o.groupId));if(!g)return 0n;const remaining=BigInt(g.remaining);if(n>remaining)n=remaining;}
  return n;
}
export function orderTriggered(o:any,reference:bigint,slot:bigint){
  return activeOrder(o)&&slot>=BigInt(o.startSlot)&&slot<BigInt(o.expirySlot)&&(o.trigger===0||(o.trigger===1&&reference>=BigInt(o.threshold))||(o.trigger===2&&reference<=BigInt(o.threshold)));
}
export function orderReserve(p:any,terms:bigint,slot:bigint,lower:bigint,upper:bigint):bigint{
  let total=0n;
  for(const o of p.book.orders){
    const n=orderRemaining(p,o,terms,slot);if(n===0n)continue;
    const limit=BigInt(o.limit),loss=o.side===0?limit-lower:upper-limit;
    total+=n*((loss>0n?loss:0n)+(o.reduceOnly?0n:(upper+9n)/10n))+BigInt(o.feeBudget)-BigInt(o.feeCharged);
  }
  return total;
}
/** Candidate-only reservation preview; clearing recomputes stored authority. */
export function postOrderReserve(p:any,next:{lots:bigint},terms:bigint,slot:bigint,lower:bigint,upper:bigint,fill?:{id:bigint;lots:bigint;gross:bigint;fee:bigint}):bigint{
  if(!p.book.orders.some(activeOrder))return 0n;
  let generation=BigInt(p.generation),q=BigInt(p.lots);
  if(q!==next.lots&&(q===0n||next.lots===0n||(q>0n)!==(next.lots>0n)))generation++;
  const book=structuredClone(p.book),candidate={...p,lots:next.lots,generation,book};
  if(fill){const o=book.orders.find((o:any)=>BigInt(o.id)===fill.id);if(!o)throw new Error('Missing stored order');
    o.filled=BigInt(o.filled)+fill.lots;o.notional=BigInt(o.notional)+fill.gross;o.feeCharged=BigInt(o.feeCharged)+fill.fee;
    if(BigInt(o.filled)===BigInt(o.lots))o.state=3;
    if(BigInt(o.groupId)>0n){const g=book.groups.find((g:any)=>BigInt(g.id)===BigInt(o.groupId));g.remaining=BigInt(g.remaining)-fill.lots;}
  }
  return orderReserve(candidate,terms,slot,lower,upper);
}
