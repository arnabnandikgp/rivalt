// Lower bound at the end of derive_pairs. Real histories, rates, orders and edges
// occupy more bytes. This measures encoding size only, without executing a freeze.
import assert from 'node:assert/strict';
import {address} from '@solana/kit';
import {getPagedRecoverySearchEncoder} from '@rivalt/sdk/paged-recovery';

import {selectRecovery} from '../../packages/services/src/recovery-selection.js';
import {populatedMarketOrder} from '../../packages/services/src/populated-recovery-selection.js';

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

// Compare candidate selection on a sparse book at the same population as the
// wire-size boundary. The debtor has 20 atoms against a 100-atom flat debt.
// There is no open opposite inventory to charge for the remaining 80 atoms.
if(process.argv.includes('--compare-verifiers')) {
  const flatRows=Array.from({length:75},(_,i)=>({
    id:BigInt(i),cash:i===0?20n:0n,lots:[0n,0n],history:[new Uint8Array(),new Uint8Array()],
    claims:[i===0?-100_000_000_000n:i===1?100_000_000_000n:0n,0n],
  }));
  const venue=address('11111111111111111111111111111111');
  const sparseBook={rows:flatRows,marks:[60_000n,30_000n] as const,fees:[0n,0n] as const,
    insurance:[0n,0n] as const,pools:[0n,0n] as const};
  const selection=await selectRecovery(sparseBook,venue,1n,3_000,'paged');
  assert.deepEqual(selection,{rank:0n,count:1n,edges:[]});
  const originalRows=flatRows.map((row,i)=>({...row,collected:i===0?20n:0n,
    originalDebtorBudgets:[i===0?80n:0n,0n],recoveryLotRates:[[0n,1n],[0n,1n]]}));
  const sparse=populatedMarketOrder(venue,1n,originalRows,0,0n,0n);
  assert(sparse.charges.every(value=>value===0n) && sparse.pages.length===0);
  assert.equal(originalRows[0].originalDebtorBudgets[0],80n);
  console.log('75 flat members: both families agree on zero forced charges; 80 atoms remain uncollectible.');
}
