import {expect,it} from 'vitest';
import * as sdk from '@rivalt/sdk';
function position(){const book=sdk.emptyLegacyOrderBook();book.orders[0]={...book.orders[0],id:1n,version:1n,state:1,side:0,originalLots:10n,lots:10n,feeBudget:1000n,limit:66000n,startSlot:10n,expirySlot:100n,termsEpoch:1n};return {id:0,lots:0n,generation:0n,book};}
it('previews the literal worst-case reserve and preserves lifetime fee authorization after a partial',()=>{
  const p=position();expect(sdk.orderReserve(p,1n,20n,59400n,60600n)).toBe(127600n);
  expect(sdk.postOrderReserve(p,{lots:1n},1n,20n,59400n,60600n,{id:1n,lots:1n,gross:60010n,fee:13n})).toBe(114927n);
  expect(sdk.orderReserve(p,1n,20n,9900n,10100n)).toBe(572100n);
  expect(p.book.orders[0].filled).toBe(0n);expect(p.book.orders[0].feeCharged).toBe(0n);
});
it('preview clips shared protection by exposure and generation and excludes the exact expiry',()=>{
  const p=position();p.lots=6n;p.generation=3n;const o=p.book.orders[0];Object.assign(o,{side:1,reduceOnly:true,generation:3n,groupId:1n,limit:54000n});
  p.book.groups[0]={id:1n,version:1n,original:10n,remaining:4n,generation:3n,side:1};
  expect(sdk.orderRemaining(p,o,1n,20n)).toBe(4n);expect(sdk.orderReserve(p,1n,20n,59400n,60600n)).toBe(27400n);
  expect(sdk.postOrderReserve(p,{lots:0n},1n,20n,59400n,60600n)).toBe(0n);
  expect(sdk.orderRemaining({...p,generation:4n},o,1n,20n)).toBe(0n);
  expect(sdk.orderRemaining(p,o,1n,100n)).toBe(0n);expect(sdk.orderRemaining(p,o,2n,20n)).toBe(0n);
});
it('re-evaluates the central trigger on every partial, within inclusive start and exclusive expiry',()=>{
  const o=position().book.orders[0];Object.assign(o,{trigger:1,threshold:61000n,state:2});
  expect(sdk.orderTriggered(o,61000n,10n)).toBe(true);expect(sdk.orderTriggered(o,60999n,20n)).toBe(false);
  expect(sdk.orderTriggered(o,61000n,9n)).toBe(false);expect(sdk.orderTriggered(o,61000n,100n)).toBe(false);
});
