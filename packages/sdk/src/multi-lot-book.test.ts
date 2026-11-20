import {getAddressDecoder} from '@solana/kit';
import {expect,it} from 'vitest';
import {multiLotBookPlan,type MultiLotRow} from './multi-lot-book.node.js';

const venue=getAddressDecoder().decode(Buffer.from('1afa168bd35fe6afa0b249235f040980402897af284d218345c863a5cc7dea2e','hex'));
// Independently scored eight-member freeze. The four flat, zero-claim makers
// cannot affect selection. Both real winning roots hold two short lots.
const rows:MultiLotRow[]=[
  {id:0n,lots:-2n,face:20_004n,cash:1_000_000n,rate:[10_002n,1n]},
  {id:1n,lots:-2n,face:20_010n,cash:1_000_000n,rate:[10_005n,1n]},
  {id:6n,lots:2n,face:-20_004n,cash:19_996n,rate:[0n,1n]},
  {id:7n,lots:2n,face:-20_010n,cash:19_996n,rate:[0n,1n]},
];

it('preserves total gain, individual lot schedules and deterministic pair order',()=>{
  const result=multiLotBookPlan(venue,1n,50_000n,12n,rows)!;
  expect(result.total).toBe(9n);
  expect(result.pairs).toEqual([
    [6n,0n,3n,1n,50_003n,0n],[7n,0n,1n,1n,50_001n,0n],[7n,1n,5n,1n,50_005n,0n],
  ]);
  expect(result.capacities).toEqual([[0n,20_004n,10_002n,1n],[1n,20_010n,10_005n,1n]]);
});

it('withholds a feasible allocation with tied optimal marginal costs',()=>{
  const tied=[rows[0],{...rows[1],face:20_004n,rate:rows[0].rate},rows[2],{...rows[3],face:-20_004n,cash:19_994n}];
  expect(multiLotBookPlan(venue,1n,50_000n,12n,tied)).toBeNull();
  expect(multiLotBookPlan(venue,1n,50_000n,12n,rows.slice(1))).toBeNull();
});
