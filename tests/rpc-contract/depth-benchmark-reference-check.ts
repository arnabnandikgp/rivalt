// Small exhaustive check of the independent flat-book reference used to judge the deployed router.
import assert from 'node:assert/strict';
import {referenceRoute, type Side} from './depth-benchmark-reference.js';
let comparisons = 0;
for (const prices of [[4_999n,5_001n,5_003n],[5_003n,5_001n,4_999n],[5_000n,5_000n,5_000n]]) {
  for (const depths of [[0,2,5],[2,3,4],[4,4,4]]) {
    const offers = prices.map((price,id)=>({id,price,depth:BigInt(depths[id])}));
    for (const side of [0,1] as Side[]) for (let lots=1; lots<=12; lots++) {
      const splits = [];
      for(let a=0;a<=depths[0];a++) for(let b=0;b<=depths[1];b++) {
        const c=lots-a-b, allocation=[a,b,c], ids=allocation.map((v,id)=>v?id:-1).filter(id=>id>=0);
        if(c<0 || c>depths[2] || ids.length>2) continue;
        const gross=allocation.reduce((sum,v,id)=>sum+BigInt(v)*prices[id],0n);
        const fee=gross/5000n+(gross%5000n===0n?0n:1n);
        splits.push({allocation,ids,score:side===0?gross+fee:fee-gross});
      }
      splits.sort((a,b)=>Number(a.score-b.score) || a.ids.length-b.ids.length ||
        a.ids[0]-b.ids[0] || (a.ids[1]??0)-(b.ids[1]??0) || b.allocation[a.ids[0]]-a.allocation[a.ids[0]]);
      const expected=splits[0];
      const actual=referenceRoute(offers,side,BigInt(lots));
      assert.deepEqual(actual?.legs.map(leg=>[leg.id,Number(leg.lots)])??null,
        expected?.ids.map(id=>[id,expected.allocation[id]])??null);
      comparisons++;
    }
  }
}
console.log(comparisons,'flat-book allocations agreed with exhaustive enumeration');
