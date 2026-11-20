import assert from 'node:assert/strict';
import type * as sdk from '@rivalt/sdk';

/** Find the longest prefix that clearing can exclude by charge ceilings or
 * debtor budgets. Widening an interval only relaxes its min/max bounds. Equal
 * recovery still needs the full financial comparison. */
export function excludedRecoveryEnd(search:Pick<sdk.RecoverySearch,'cursor'|'count'|'edges'|'budgets'|'scoreNum'|'scoreDen'> & {rows:readonly {id:bigint}[]}) {
  const {cursor,count,edges,rows,budgets,scoreNum,scoreDen}=search;
  assert(cursor>=0n && cursor<count && scoreDen>0n,'Invalid recovery cursor');
  const ordinals=new Map(rows.map((row,index)=>[row.id,index]));
  const excluded=(last:bigint)=>{
    const lower=rows.map(()=>[0n,0n]),upper=rows.map(()=>[0n,0n]);
    let stride=1n;
    for(let index=edges.length-1;index>=0;index--){
      const {maximum,debtor,market}=edges[index];
      const ordinal=ordinals.get(debtor);
      assert(ordinal!==undefined && (market===0||market===1),'Foreign recovery dimension');
      const cycle=stride*(maximum+1n), wraps=cursor/cycle!==last/cycle;
      lower[ordinal][market]+=wraps?0n:(cursor%cycle)/stride;
      upper[ordinal][market]+=wraps?maximum:(last%cycle)/stride;
      stride=cycle;
    }
    let total=0n;
    for(const [index,row] of budgets.entries())for(const [market,budget] of row.entries()){
      if(lower[index][market]>budget)return true;
      total+=upper[index][market]<budget?upper[index][market]:budget;
    }
    return total*scoreDen<scoreNum;
  };
  let end=cursor-1n, high=count-1n;
  while(end<high){
    const middle=(end+high+1n)/2n;
    if(excluded(middle))end=middle;
    else high=middle-1n;
  }
  return end;
}
