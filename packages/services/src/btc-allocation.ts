import assert from 'node:assert/strict';
import {frozenMemberRank} from '@rivalt/sdk/frozen-order';
import {type Address} from '@solana/kit';
import {MAX_PRICE,type PerLotProfit} from '@rivalt/sdk';

const scale=1_000_000_000n;

const min=(left:bigint,right:bigint)=>left<right?left:right;
export type Winner={id:bigint;capacity:bigint;lotsFor:(charge:bigint)=>bigint};
export function frozenWinner(id:bigint,lots:bigint,claim:bigint,mark:bigint,history:PerLotProfit):Winner {
  const quantity=lots<0n?-lots:lots,direction=lots<0n?-1n:1n,unit=scale*history.denominator;
  const gain=direction*(mark*unit-history.entryScaled);
  const room=direction===1n?mark-1n:MAX_PRICE-mark;
  const perLot=min(min(gain/unit,room)*unit,gain-history.paidScaled);
  const capacity=perLot<=0n||claim<=0n?0n:min(claim/scale,quantity*perLot/unit);
  return {id,capacity,lotsFor:(charge)=>{assert(charge>=0n&&charge<=capacity);
    return charge===0n?0n:(charge*unit+perLot-1n)/perLot;}};
}

export function allocationCutoff(venue:Address,epoch:bigint,shortfall:bigint,winners:readonly Winner[]):[bigint,bigint,bigint,bigint] {
  const target=min(shortfall,winners.reduce((total,winner)=>total+winner.capacity,0n));
  if(target===0n)return [0n,0n,0n,0n];
  // Distinct fractions with u64 denominators are more than 2^-128 apart.
  // Find the first dyadic tick admitting enough charge; only members tied on
  // its exact marginal cost can enter or leave the prefix at this tick.
  const precision=128n;
  const count=(tick:bigint,capacity:bigint)=>min(capacity,((tick*capacity>>precision)+1n)/2n);
  let low=0n,high=2n<<precision;
  while(low+1n<high) {
    const mid=(low+high)/2n;
    if(winners.reduce((n,w)=>n+count(mid,w.capacity),0n)>=target)high=mid;else low=mid;
  }
  let remaining=target;
  const ties=[];
  for(const winner of winners) {
    const before=count(low,winner.capacity),unit=count(high,winner.capacity);
    remaining-=before;
    if(unit>before) {
      assert(unit===before+1n,'Distinct costs landed on the same dyadic tick');
      ties.push({winner,unit,extra:winner.lotsFor(unit)-winner.lotsFor(before),
        digest:frozenMemberRank(venue,epoch,winner.id)});
    }
  }
  const cmp=(a:bigint,b:bigint)=>a<b?-1:a>b?1:0;
  ties.sort((a,b)=>cmp(a.extra,b.extra)||Buffer.compare(a.digest,b.digest)||cmp(a.winner.id,b.winner.id));
  assert(remaining>0n&&remaining<=BigInt(ties.length),'Unreachable market recovery target');
  const {winner,unit,extra}=ties[Number(remaining-1n)];
  return [unit,winner.capacity,extra,winner.id];
}
