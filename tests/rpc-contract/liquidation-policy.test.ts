import {it,expect} from 'vitest';
import {emptyOrderBook,liquidationCandidate,maintenanceDeficit} from '@rivalt/sdk';
const S=1_000_000_000n;
const trader={id:0,cash:20000n,lots:10n,virtualScaled:-600000n*S,generation:1n,book:emptyOrderBook()};
const receiver={id:1,cash:100000n,lots:0n,virtualScaled:0n,generation:0n,book:emptyOrderBook()};
it('checks funded long/short liquidation previews against independent integer literals',()=>{
  expect(maintenanceDeficit(trader,57420n,58580n)).toBe(35090n*S);
  const result=liquidationCandidate(trader,receiver,4n,58000n,58000n,57420n,58580n,1n,1n,20n)!;
  expect([result.fee,result.target.cash,result.target.lots,result.target.virtualScaled,result.deficitAfter,result.receiver.cash]).toEqual([116n,19884n,6n,-368000n*S,21170n*S,100116n]);
  const short=liquidationCandidate({...trader,lots:-10n,virtualScaled:600000n*S},receiver,4n,62000n,62000n,61380n,62620n,1n,1n,20n)!;
  expect([short.fee,short.target.cash,short.target.lots,short.target.virtualScaled,short.deficitBefore,short.deficitAfter]).toEqual([124n,19876n,-6n,352000n*S,37510n*S,22630n*S]);
  expect(liquidationCandidate(trader,receiver,4n,52200n,58000n,57420n,58580n,1n,1n,20n)).toBeNull();
  expect(liquidationCandidate(trader,{...receiver,cash:100n},4n,58000n,58000n,57420n,58580n,1n,1n,20n)).toBeNull();
});
