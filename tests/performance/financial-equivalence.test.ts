import {expect,it} from 'vitest';
import {financialEquivalence} from './financial-equivalence.js';
const before={schemaVersion:7,roots:{old:{cash:'123',claim:'-5',carry:3,orders:[{lots:'2',price:'7'},{lots:'3',price:'8'}]}},
  markets:{old:{fundingTime:'100',validUntil:'300',fundingCheckpoint:'15'}},liquidity:{makers:{old:{approvedHash:'a'.repeat(64)}}}};
const after={schemaVersion:8,roots:{fresh:structuredClone(before.roots.old)},markets:{fresh:{fundingTime:'1100',validUntil:'302',fundingCheckpoint:'15'}},
  liquidity:{makers:{fresh:{approvedHash:'b'.repeat(64)}}}};
const roles=new Map([['old','fresh']]);
it('compares every value and labels changed slot/digest inputs as unmatched witnesses',()=>{
  const result=financialEquivalence(before,after,roles,1000n);expect(result.fullInputMatch).toBe(false);
  expect(result.witnesses.map(value=>value.kind)).toEqual(['slot','digest']);expect(result.comparedLeaves).toBe(12);
});
it.each(['cash','claim','carry'] as const)('rejects changed %s rather than only checking aggregate balances',field=>{
  const corrupted=structuredClone(after);(corrupted.roots.fresh as any)[field]=field==='carry'?2:'124';
  expect(()=>financialEquivalence(before,corrupted,roles,1000n)).toThrow(/financial\/state mismatch/);
});
it('rejects changed relative funding time, checkpoint, order ordering and unknown fields',()=>{
  const time=structuredClone(after);time.markets.fresh.fundingTime='1101';
  expect(()=>financialEquivalence(before,time,roles,1000n)).toThrow(/relative time changed/);
  const checkpoint=structuredClone(after);checkpoint.markets.fresh.fundingCheckpoint='16';
  expect(()=>financialEquivalence(before,checkpoint,roles,1000n)).toThrow(/financial\/state mismatch/);
  const orders=structuredClone(after);orders.roots.fresh.orders.reverse();
  expect(()=>financialEquivalence(before,orders,roles,1000n)).toThrow(/financial\/state mismatch/);
  expect(()=>financialEquivalence(before,{...after,unexpected:0},roles,1000n)).toThrow(/fields/);
});
