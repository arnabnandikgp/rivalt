import {createHash} from 'node:crypto';
import {getAddressEncoder,type Address} from '@solana/kit';
import {MAX_PRICE} from './price-policy.js';
import {MAX_POSITION_LOTS} from './quantity-limits.js';
import {frozenMemberRank} from './frozen-order.node.js';

export type MultiLotRow={id:bigint;lots:bigint;face:bigint;cash:bigint;rate:readonly [bigint,bigint]};
const magnitude=(value:bigint)=>value<0n?-value:value;
const min=(left:bigint,right:bigint)=>left<right?left:right;
const ceil=(amount:bigint,unit:bigint)=>(amount+unit-1n)/unit;
const order=(left:bigint,right:bigint)=>left<right?-1:left>right?1:0;
const capacity=(row:MultiLotRow,lots:bigint)=>min(row.face,lots*row.rate[0]/row.rate[1]);
type Unit={unit:bigint;capacity:bigint};
const marginal=(left:Unit,right:Unit)=>order((2n*left.unit-1n)*right.capacity,(2n*right.unit-1n)*left.capacity);
const word=(value:bigint)=>{const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(value);return bytes;};

function sharesFor(target:bigint,caps:bigint[],gain:bigint) {
  const shares=caps.map(cap=>gain===0n?0n:(2n*target*cap+gain-1n)/(2n*gain));
  let sum=shares.reduce((left,right)=>left+right,0n);
  while(sum!==target) {
    const add=sum<target;
    let best:Unit|undefined,index=-1;
    for(const [i,charge] of shares.entries()){
      if(add?charge===caps[i]:charge===0n)continue;
      const candidate={unit:add?charge+1n:charge,capacity:caps[i]};
      if(!best||(add?marginal(candidate,best)<0:marginal(candidate,best)>0)){best=candidate;index=i;}
    }
    if(index<0)throw new Error('Impossible marginal allocation');
    const step=add?1n:-1n;
    shares[index]+=step;sum+=step;
  }
  const used=shares.flatMap((charge,i)=>charge>0n?[{unit:charge,capacity:caps[i]}]:[]).sort(marginal);
  const open=shares.flatMap((charge,i)=>charge<caps[i]?[{unit:charge+1n,capacity:caps[i]}]:[]).sort(marginal);
  if(used.length&&open.length&&marginal(used.at(-1)!,open[0])>=0)return null;
  return shares;
}

/** Reconstruct the complete bound certificate from original whole BTC claims and frozen rates. */
export function multiLotBookPlan(venue:Address,epoch:bigint,mark:bigint,insurance:bigint,rows:MultiLotRow[]){
  if(rows.length===0||rows.some((row,index)=>index>0 && rows[index-1].id>=row.id ||row.cash<0n||
    row.rate[0]<0n||row.rate[1]<=0n||row.rate[1]>MAX_POSITION_LOTS||row.rate[0]>MAX_PRICE*row.rate[1])||
    rows.reduce((sum,row)=>sum+row.face,0n)!==0n||rows.reduce((sum,row)=>sum+row.lots,0n)!==0n)return null;
  const debtors=rows.filter(row=>row.face<0n).map(row=>({...row,amount:row.face+row.cash<0n?-row.face-row.cash:0n}));
  const loss=debtors.reduce((sum,row)=>sum+row.amount,0n);
  const budgets=debtors.map(row=>({...row,budget:loss>insurance?row.amount*(loss-insurance)/loss:0n}))
    .filter(row=>row.budget>0n&&row.lots!==0n);
  const winners=rows.filter(row=>row.lots!==0n&&row.face>=0n);
  const caps=winners.map(row=>{
    let available=0n;
    for(const debtor of budgets){
      const match=min(magnitude(row.lots),magnitude(debtor.lots));
      if(row.lots*debtor.lots<0n && capacity(row,match)>0n)available+=match;
    }
    return capacity(row,min(magnitude(row.lots),available));
  });
  const sum=(array:bigint[])=>array.reduce((a,b)=>a+b,0n);
  const totalBudget=sum(budgets.map(row=>row.budget)),gain=sum(caps),total=min(totalBudget,gain);
  const shares=sharesFor(total,caps,gain);
  if(!shares)return null;
  const targets=shares.filter(value=>value>0n).sort((a,b)=>order(b,a));
  const amounts=budgets.map(row=>row.budget).sort((a,b)=>order(b,a));
  let floor=sum(shares.map((charge,i)=>charge?ceil(charge*winners[i].rate[1],winners[i].rate[0]):0n));
  let remainder=total,needed=0n;
  for(const amount of amounts){if(remainder===0n)break;remainder-=min(remainder,amount);needed++;}
  if(needed>floor)floor=needed;
  if(total===totalBudget&&targets.length===amounts.length&&floor===BigInt(targets.length)&&targets.some((amount,i)=>amount!==amounts[i]))floor++;
  const rank=(id:bigint)=>frozenMemberRank(venue,epoch,id);
  const priority=(a:{id:bigint;rank:Buffer},b:{id:bigint;rank:Buffer})=>Buffer.compare(a.rank,b.rank)||order(a.id,b.id);
  const remaining=budgets.map(row=>({...row,used:0n,rank:rank(row.id)})).sort(priority);
  const positions=winners.map((row,i)=>({...row,charge:shares[i],rank:rank(row.id)})).sort(priority);
  let closed=0n;
  const pairs:bigint[][]=[];
  for(const winner of positions){
    let wanted=winner.charge,used=0n;
    for(const debtor of remaining){
      if(wanted===0n)break;
      if(debtor.lots*winner.lots>=0n)continue;
      const amount=min(min(debtor.budget,wanted),capacity(winner,min(magnitude(winner.lots),magnitude(debtor.lots))));
      if(amount===0n)continue;
      const lots=ceil(amount*winner.rate[1],winner.rate[0]);
      used+=lots;debtor.used+=lots;closed+=lots;
      if(used>magnitude(winner.lots)||debtor.used>magnitude(debtor.lots))return null;
      pairs.push([debtor.id,winner.id,amount,lots,mark-(winner.lots>0n?1n:-1n)*(amount/lots),amount%lots]);
      wanted-=amount;debtor.budget-=amount;
    }
    if(wanted!==0n)return null;
  }
  if(closed!==floor)return null;
  const capacities=winners.map((winner,i)=>[winner.id,caps[i],...winner.rate]);
  let digest=createHash('sha256').update('Rivalt/multi-lot-book/v1').update(Buffer.from(getAddressEncoder().encode(venue)))
    .update(word(epoch)).update(word(total)).update(word(BigInt(capacities.length))).update(word(BigInt(pairs.length))).digest();
  for(const row of [...capacities,...pairs])digest=createHash('sha256').update(digest).update(Buffer.concat(row.map(word))).digest();
  return {total,capacities,pairs,digest:digest.toString('hex')};
}
