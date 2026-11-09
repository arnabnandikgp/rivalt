import {expect,it} from 'vitest';
import {quantityCandidates} from './quantity-candidates.js';

it('starts at actual remaining exposure and bounds local probes over the complete numeric domain',()=>{
  expect([...quantityCandidates(9n)]).toEqual([9n,4n,2n,1n]);
  const million=[...quantityCandidates(1_000_000n)];
  expect(million[0]).toBe(1_000_000n);expect(million.at(-1)).toBe(1n);expect(million).toHaveLength(20);
  const maximum=[...quantityCandidates(100_000_000n)];expect(maximum).toHaveLength(27);
  expect([...quantityCandidates(100_000_001n)]).toEqual(maximum);
  expect([...quantityCandidates(0n)]).toEqual([]);
});
