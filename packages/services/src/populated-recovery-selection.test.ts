import {address} from '@solana/kit';
import {expect,it} from 'vitest';
import {populatedMarketOrder,populatedRecoveryProposal,type PopulatedRow} from './populated-recovery-selection.js';

const venue=address('11111111111111111111111111111111');
const atoms=1_000_000_000n;
function row(id:bigint,lots:bigint,budget:bigint,foreignDebt=0n):PopulatedRow {
  return {id,cash:0n,collected:0n,claims:[lots*atoms,-foreignDebt*atoms],lots:[lots,0n],
    originalDebtorBudgets:[budget,0n],recoveryLotRates:[[lots>0n?1n:0n,1n],[0n,1n]]};
}

it('protects the foreign creditor before choosing the two minimum-cost totals',()=>{
  const rows=[row(10n,-24n,12n),row(20n,12n,0n,8n),row(30n,12n,0n)];
  // Equal 12-atom weights ordinarily take six each. Only three atoms can
  // be taken from the holder whose gain pays a foreign creditor.
  const free=populatedMarketOrder(venue,1n,rows,0,12n,12n);
  expect(free.charges).toEqual([0n,6n,6n]);
  const capped=populatedMarketOrder(venue,1n,rows,0,3n,12n);
  expect(capped.charges).toEqual([0n,3n,9n]);
  expect(capped.cutoffs).toEqual([{unit:9n,capacity:12n,memberId:30n},{unit:3n,capacity:12n,memberId:20n}]);
  expect(capped.openings[0].members[0].location).toEqual({role:1,slot:0n});
  expect(capped.root.equals(free.root)).toBe(false);
});

it('excludes same-side and sub-atom opposing inventory from eligible gain',()=>{
  const rows=[row(1n,-2n,2n),row(2n,2n,0n),row(3n,2n,0n),row(4n,-4n,0n)];
  rows[2].recoveryLotRates=[[1n,3n],[0n,1n]];
  rows[3].claims=[4n*atoms,0n];rows[3].recoveryLotRates=[[1n,1n],[0n,1n]];
  const book=populatedMarketOrder(venue,7n,rows,0,0n,2n);
  expect(book.charges).toEqual([0n,2n,0n,0n]);
  expect(book.openings[0].members.map(member=>member.weight)).toEqual([0n,2n,0n,0n]);
  expect(book.pages.map(page=>page.entries.map(row=>row.memberId))).toEqual([[2n],[1n]]);
  rows[0].originalDebtorBudgets=[3n,0n];
  expect(()=>populatedMarketOrder(venue,7n,rows,0,0n,3n)).toThrow(/Insufficient eligible gain/);
});

it('keeps a flat debtor’s residual debt in the settlement after proving zero matched lots',()=>{
  const rows=Array.from({length:75},(_,id)=>row(BigInt(id),0n,0n));
  Object.assign(rows[0],{cash:20n,collected:20n,claims:[-100n*atoms,0n],originalDebtorBudgets:[80n,0n]});
  rows[1].claims=[100n*atoms,0n];
  const {markets,proposals}=populatedRecoveryProposal(venue,1n,rows,[0n,0n],[0n,0n],[0n,0n],[0n,0n]);
  expect(markets.every(market=>market.pages.length===0 && market.charges.every(charge=>charge===0n))).toBe(true);
  expect(rows[0].originalDebtorBudgets).toEqual([80n,0n]);
  // The only creditor has 100 atoms of face and 20 atoms of funding.
  const [{factor,rates}]=proposals;
  expect(rates[0][0]*5n).toBe(factor[0]);
  expect(()=>populatedMarketOrder(venue,1n,rows,0,0n,80n)).toThrow(/budgets disagree/);
});
