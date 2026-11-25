import assert from 'node:assert/strict';
import { compareFlat } from './comparison-reference.js';

// Enumerate quantities independently. Small books include ties, exhausted makers
// and a cheaper maker too shallow to fit under the leg limit.
let cases = 0;
for (const depths of [[1, 3, 2, 4], [0, 0, 2, 3], [2, 2, 2, 2]]) {
  for (const prices of [[5001, 5000, 4999, 5000], [3, 4, 1, 6]]) {
    const offers = depths.map((depth, id) => ({ id, depth: BigInt(depth), price: BigInt(prices[id]) }));
    for (const side of [0, 1] as const) for (let cap = 1; cap <= 4; cap++) {
      const optimal = new Map<number, bigint>();
      function enumerate(id: number, legs: number, quantity: number, gross: bigint) {
        if (id === depths.length) {
          const prior = optimal.get(quantity);
          if (prior === undefined || (side === 0 ? gross < prior : gross > prior)) optimal.set(quantity, gross);
          return;
        }
        for (let take = 0; take <= depths[id]; take++) {
          const used = legs + Number(take > 0);
          if (used <= cap) enumerate(id + 1, used, quantity + take, gross + BigInt(take * prices[id]));
        }
      }
      enumerate(0, 0, 0, 0n);
      for (let size = 1; size <= 12; size++) {
        const actual = compareFlat(offers, side, BigInt(size), cap);
        const expected = optimal.get(size);
        assert.equal(actual?.gross, expected);
        if (actual && expected !== undefined) {
          const fee = expected / 5000n + BigInt(expected % 5000n !== 0n);
          assert.equal(actual.allIn, side === 0 ? expected + fee : expected - fee);
          assert(actual.legs.length <= cap);
        }
        cases++;
      }
    }
  }
}
console.log(cases, 'independent exhaustive quantity comparisons passed');
