import {createHash} from 'node:crypto';
import {address} from '@solana/kit';
import {expect,it} from 'vitest';
import {btcCutoff,frozenWinner} from './btc-allocation.js';

const venue=address('11111111111111111111111111111111');
it('selects the same cutoff as buying individually ranked marginal units',()=>{
  for(const epoch of [1n,2n]) {
    const winners=[[1n,7n,3n],[9n,4n,4n],[43n,7n,1n],[32n,0n,3n]].map(([id,capacity,perLot])=>({
      id,capacity,lotsFor:(k:bigint)=>(k+perLot-1n)/perLot}));
    const priority=(id:bigint)=>{
      const fields=Buffer.alloc(16);fields.writeBigUInt64LE(epoch);fields.writeBigUInt64LE(id,8);
      return createHash('sha256').update('Rivalt/frozen-member-order/v1\0').update(Buffer.alloc(32)).update(fields).digest();
    };
    const units=winners.flatMap(w=>Array.from({length:Number(w.capacity)},(_,i)=>{
      const k=BigInt(i+1);return {id:w.id,unit:k,cap:w.capacity,extra:w.lotsFor(k)-w.lotsFor(k-1n),digest:priority(w.id)};
    }));
    units.sort((a,b)=>Number((2n*a.unit-1n)*b.cap-(2n*b.unit-1n)*a.cap)||Number(a.extra-b.extra)||Buffer.compare(a.digest,b.digest));
    for(let loss=0;loss<=units.length+1;loss++) {
      const end=units[Math.min(loss,units.length)-1];
      const expected=end?[end.unit,end.cap,end.extra,end.id]:[0n,0n,0n,0n];
      expect(btcCutoff(venue,epoch,BigInt(loss),winners.toReversed())).toEqual(expected);
    }
  }
});
it('quotes the matched unpaid share after earlier payments and compares nearly equal u64 weights',()=>{
  const eligible=frozenWinner(9n,3n,20_000_000_000n,100n,{entryScaled:94_000_000_000n,paidScaled:13_000_000_000n,denominator:1n});
  expect(eligible.capacity).toBe(0n);
  const partial=frozenWinner(9n,3n,20_000_000_000n,100n,{entryScaled:282_000_000_000n,paidScaled:13_000_000_000n,denominator:3n});
  expect(partial.capacity).toBe(5n);expect(partial.lotsFor(4n)).toBe(3n);
  const largest=2n**64n-1n;
  const winners=[largest,largest-1n].map((capacity,i)=>({id:BigInt(i),capacity,lotsFor:(k:bigint)=>k}));
  expect(btcCutoff(venue,5n,1n,winners)).toEqual([1n,largest,1n,0n]);
});
