import { expect, it } from 'vitest';
import { directoryAllocation } from './directory-allocation.js';

function book(prices: number[], lower = 1n) {
  const gross = [0n];
  for (const price of prices) gross.push(gross.at(-1)! + BigInt(price));
  return { lower, upper: BigInt(prices.length), quote: (lots: bigint) => gross[Number(lots)] };
}

it('returns the best directory price when the exact fill fits the signed width', () => {
  for (const side of [0, 1] as const) for (let variant = 0; variant < 12; variant++) {
    const prices = Array.from({ length: 5 }, (_, maker) => Array.from({ length: 1+(maker+variant)%5 }, (_, index) =>
      100+(side === 0 ? 1 : -1)*((maker+variant)%3+Math.floor(index/2)*(maker%3))));
    const sorted = prices.flat().sort((a,b) => side === 0 ? a-b : b-a);
    const books = prices.map(levels => book(levels));
    for (let size = 1; size <= sorted.length; size++) {
      const expected = sorted.slice(0,size).reduce((sum,value) => sum+BigInt(value),0n);
      for (const width of [2,3,4,5]) {
        const allocation = directoryAllocation(books,side,BigInt(size),width);
        if (allocation === null) {
          // At least one lot below cutoff per mandatory maker, plus the fewest books needed for tied capacity.
          const cutoff = sorted[size-1], mandatory = prices.map(levels => levels.filter(price => side === 0 ? price < cutoff : price > cutoff).length);
          const tied = prices.map(levels => levels.filter(price => price === cutoff).length);
          const full = mandatory.reduce((n,q,id)=>n+q+(q?tied[id]:0),0);
          let needed = size-full, count = mandatory.filter(Boolean).length;
          for(const depth of tied.filter((_,id)=>!mandatory[id]).sort((a,b)=>b-a)) {
            if(needed<=0)break;
            count++; needed-=depth;
          }
          expect(count).toBeGreaterThan(width);
        } else {
          expect(allocation.length).toBeLessThanOrEqual(width);
          expect(allocation.reduce((sum,[id,lots])=>sum+books[id].quote(lots),0n)).toBe(expected);
          expect(allocation.reduce((sum,[,lots])=>sum+lots,0n)).toBe(BigInt(size));
        }
      }
    }
  }
});

it('falls back for insufficient depth or a leg below its execution collar', () => {
  expect(directoryAllocation([null, book([100,101])],0,3n,3)).toBeNull();
  expect(directoryAllocation([book([100,101],2n),book([110])],0,1n,3)).toBeNull();
});
