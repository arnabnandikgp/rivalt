import {expect,it} from 'vitest';
import {excludedRecoveryEnd} from './recovery-proof-worker.js';
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
