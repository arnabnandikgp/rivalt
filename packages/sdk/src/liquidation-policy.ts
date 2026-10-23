import {orderReserve} from './order-policy.js';
const S=1_000_000_000n,abs=(x:bigint)=>x<0n?-x:x;
export function maintenanceDeficit(p:{cash:bigint;lots:bigint;virtualScaled:bigint},lower:bigint,upper:bigint){
  const u=p.virtualScaled+p.lots*(p.lots<0n?upper:lower)*S;
  const equity=p.cash*S+(u<0n?u:0n),mm=(abs(p.lots)*upper+19n)/20n*S;
  return mm>equity?mm-equity:0n;
}
/** Candidate preview from a coherent snapshot already accrued at the common F.
 * Clearing checks all authority, stored bounds and fresh observations again. */
export function liquidationCandidate(target:any,receiver:any,lots:bigint,price:bigint,reference:bigint,lower:bigint,upper:bigint,terms:bigint,slot:bigint,grossLots:bigint){
  if(target.id===receiver.id||receiver.cash===0n||lots<1n||lots>4608n||lots>abs(target.lots)||price*10n<reference*9n||price*10n>reference*11n||reference<10000n||reference>100000n||lower<1n||upper>1000000n||lower>upper)return null;
  const before=maintenanceDeficit(target,lower,upper);if(before===0n)return null;
  const gross=lots*price,uncapped=(gross+1999n)/2000n,fee=[uncapped,10000n,target.cash].reduce((a,b)=>a<b?a:b);
  const delta=target.lots>0n?-lots:lots;
  const next={...target,cash:target.cash-fee,lots:target.lots+delta,virtualScaled:target.virtualScaled-delta*price*S};
  const got={...receiver,cash:receiver.cash+fee,lots:receiver.lots-delta,virtualScaled:receiver.virtualScaled+delta*price*S};
  if((receiver.lots===0n||got.lots===0n||(receiver.lots<0n)!==(got.lots<0n))&&receiver.lots!==got.lots)got.generation+=1n;
  if((target.lots===0n||next.lots===0n||(target.lots<0n)!==(next.lots<0n))&&target.lots!==next.lots)next.generation+=1n;
  const limit=100_000_000_000_000_000_000_000_000n;
  if([next,got].some(p=>p.cash>1_000_000_000_000_000n||abs(p.virtualScaled)>limit||p.generation>18446744073709551615n||(p.lots!==0n&&p.generation===18446744073709551615n)))return null;
  const after=maintenanceDeficit(next,lower,upper);
  if(after>=before||abs(got.lots)>100_000_000n||grossLots-abs(target.lots)-abs(receiver.lots)+abs(next.lots)+abs(got.lots)>200_000_000n)return null;
  const u=got.virtualScaled+got.lots*(got.lots<0n?upper:lower)*S;
  const reserve=orderReserve(got,terms,slot,lower,upper),required=((abs(got.lots)*upper+9n)/10n+reserve)*S;
  if(got.cash*S+(u<0n?u:0n)<required)return null;
  return{lots,price,fee,deficitBefore:before,deficitAfter:after,target:next,receiver:got};
}
