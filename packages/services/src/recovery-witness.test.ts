import {expect,it} from 'vitest';
import {recoveryRateWitness,type FrozenRecoveryBook} from './recovery-witness.js';

const scale = 1_000_000_000n;
function book(claims:bigint[][], cash:bigint[], insurance=[0n,0n]):FrozenRecoveryBook {
  return {pools:[0n,0n], insurance, rows:Array.from({length:8}, (_,index) => ({
    id:BigInt(index+1)*10n, cash:cash[index]??0n, claims:claims[index]??[0n,0n],
  }))};
}

it('retains each market’s original cash collection through both mixed-radix charges', () => {
  const original = book([[-12n*scale,-6n*scale],[12n*scale,0n],[0n,6n*scale]],[9n]);
  const edges = [{debtor:10n,winner:20n,market:0,maximum:3n},{debtor:10n,winner:30n,market:1,maximum:2n}];
  // Nine funded atoms cover six BTC and three ETH. Rank 7 takes two BTC
  // atoms and one ETH atom. Rates become 6/10 and 3/5.
  expect(recoveryRateWitness(original, [], 0n).rates).toEqual([2n,1n,1n]);
  const effective = recoveryRateWitness(original, edges, 7n);
  expect(effective.rates).toEqual([5n,3n,3n]);
  expect(Array.from(effective.orders[0])).toEqual([1,0,2,3,4,5,6,7]);
  expect(Array.from(effective.orders[1])).toEqual([2,0,1,3,4,5,6,7]);
  // Rank 6 leaves ETH unchanged. Keeping the original 6/3 split gives
  // 6/10 and 3/6, which distinguishes this rule from reallocating the nine.
  expect(recoveryRateWitness(original, edges, 6n).rates).toEqual([10n,6n,5n]);
  expect(()=>recoveryRateWitness(original, edges, 12n)).toThrow(/dimensions/);
  expect(original.rows[0].claims).toEqual([-12n*scale,-6n*scale]);
});

it('refuses incomplete books and rates that need a second insurance pass', () => {
  const original = book([[0n,0n],[2n*scale/5n,scale/5n],[-3n*scale/5n,3n*scale/5n],[scale/5n,-4n*scale/5n]],
    [2n,2n,1n,2n],[1n,1n]);
  expect(()=>recoveryRateWitness(original, [], 0n)).toThrow(/another insurance pass/);
  expect(()=>recoveryRateWitness({...original,rows:original.rows.slice(1)}, [], 0n)).toThrow(/eight/);
  expect(()=>recoveryRateWitness({...original,rows:[...original.rows].reverse()}, [], 0n)).toThrow(/increasing/);
});
