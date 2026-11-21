import {expect,it} from 'vitest';
import {address} from '@solana/kit';
import {getPagedRecoverySearchEncoder} from '@rivalt/sdk/paged-recovery';
import {minimumPagedSearchBytes,pagedRateWitness} from './paged-recovery-proof.js';
import {excludedRecoveryEnd} from './recovery-coverage.js';
import {recoveryBudget} from './recovery-selection.js';

it('keeps feasible tied or better schedules after every cursor, including radix wraps',()=>{
  const edges=[
    {market:0,debtor:2n,winner:5n,maximum:2n},
    {market:0,debtor:2n,winner:6n,maximum:3n},
    {market:1,debtor:3n,winner:6n,maximum:2n},
  ];
  const scores:(bigint|null)[]=[];
  for(let first=0n;first<=2n;first++)for(let second=0n;second<=3n;second++)for(let third=0n;third<=2n;third++)
    scores.push(first+second<=2n && third<=1n ? first+second+third : null);
  for(const scoreNum of [0n,3n,5n,6n,9n])for(let cursor=0;cursor<scores.length;cursor++){
    const end=Number(excludedRecoveryEnd({edges,budgets:[[2n,0n],[0n,1n]],rows:[{id:2n},{id:3n}],
      count:BigInt(scores.length),cursor:BigInt(cursor),scoreNum,scoreDen:2n}));
    expect(end).toBeGreaterThanOrEqual(cursor-1);
    expect(end).toBeLessThan(scores.length);
    expect(scores.slice(cursor,end+1).every(score=>score===null || score*2n<scoreNum)).toBe(true);
    const current=scores[cursor];
    if(current===null || current*2n<scoreNum)expect(end).toBeGreaterThanOrEqual(cursor);
    else expect(end).toBe(cursor-1);
  }
});
it('requires an explicit bounded sponsor work budget',()=>{
  expect(recoveryBudget(undefined)).toBe(0);
  expect(recoveryBudget('2548')).toBe(2548);
  for(const input of ['0','-1','1.5','9007199254740993','1e3','65537'])expect(()=>recoveryBudget(input)).toThrow();
});

it('classifies insufficient search storage using a valid minimum-width generated account',()=>{
  const pair=()=>[0n,0n],ratio={numerator:0n,denominator:1n};
  for(const count of [9,75,76,128]) {
    const rows=Array.from({length:count},(_,id)=>({id,cash:0n,claims:pair(),lots:pair(),histories:[new Uint8Array(),new Uint8Array()]}));
    const order=Uint8Array.from(rows.map(row=>row.id));
    const fields={prepared:address('11111111111111111111111111111111'),epoch:1,revision:1,
      proposed:0,count:1,cursor:0,stage:2,scoreNum:0,scoreDen:1,remainingInsurance:pair(),retainedFees:pair(),
      original:{rates:[[1,1,1]],orders:[order,order]},rows,cash:rows.map(()=>0n),movements:rows.map(pair),
      budgets:rows.map(pair),weights:rows.map(pair),priority:{fractions:[ratio,ratio],deviation:[ratio,ratio],costs:[pair(),pair()]}};
    const encoder=getPagedRecoverySearchEncoder();
    const bytes=encoder.encode({...fields,edges:[]});
    if(count===75){
      const edges=[1,2,3].map(winner=>({market:0,debtor:0,winner,maximum:1}));
      expect(bytes.length).toBe(10171);
      expect(encoder.encode({...fields,edges}).length).toBe(10246);
    }
    expect(minimumPagedSearchBytes(BigInt(count))).toBe(BigInt(bytes.length));
    expect(bytes.length>10240).toBe(count>=76);
  }
});

it('rejects an exact but unencodable BTC/ETH rate before ranking candidate schedules',()=>{
  const btc=4_294_967_291n*1_000_000_000n,eth=4_294_967_311n*1_000_000_000n;
  const rows=[[-btc,0n],[btc,0n],[0n,-eth],[0n,eth]].map((claims,index)=>({
    id:BigInt(index),cash:index%2===0?1n:0n,claims,
  }));
  // The market rates are 1/4,294,967,291 and 1/4,294,967,311.
  // Their coprime denominators require a shared factor strictly above 2^64.
  expect(()=>pagedRateWitness({rows,pools:[0n,0n],insurance:[0n,0n]},[],0n)).toThrow(/wire width/);
});
