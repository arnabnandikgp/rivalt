// Lower bound at the end of derive_pairs. Real histories, rates, orders and edges
// occupy more bytes. This measures encoding size only, without executing a freeze.
import assert from 'node:assert/strict';
import {address} from '@solana/kit';
import {getPagedRecoverySearchEncoder} from '@rivalt/sdk/paged-recovery';

const encoder=getPagedRecoverySearchEncoder();
const ratio={numerator:0n,denominator:1n};
function lowerBound(members:number) {
  const pair=()=>[0n,0n];
  const rows=Array.from({length:members},(_,id)=>({
    id,cash:0n,claims:pair(),lots:pair(),histories:[new Uint8Array(),new Uint8Array()],
  }));
  return encoder.encode({
    prepared:address('11111111111111111111111111111111'),epoch:1n,revision:1n,
    proposed:0n,count:1n,cursor:0n,stage:2,scoreNum:0n,scoreDen:1n,
    remainingInsurance:pair(),retainedFees:pair(),original:{rates:[],orders:[new Uint8Array(),new Uint8Array()]},
    rows,edges:[],cash:rows.map(()=>0n),movements:rows.map(pair),budgets:rows.map(pair),weights:rows.map(pair),
    priority:{fractions:[ratio,ratio],deviation:[ratio,ratio],costs:[pair(),pair()]},
  }).length;
}
const allocated=10_240;
const empty=lowerBound(0),nine=lowerBound(9),selectedPopulation=lowerBound(128);
assert.equal(nine-empty,9*128);
assert.equal(selectedPopulation-empty,128*128);
assert(selectedPopulation>allocated);
console.log(JSON.stringify({allocated,empty,nine,selectedPopulation}));
