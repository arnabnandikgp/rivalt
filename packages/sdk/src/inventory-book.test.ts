import {address} from '@solana/kit';
import {expect,it} from 'vitest';
import {frozenMemberRank,inventoryBookPlan} from './frozen-order.node.js';

const venue=address('11111111111111111111111111111111'),epoch=1n;
const order=(a:bigint,b:bigint)=>Buffer.compare(frozenMemberRank(venue,epoch,a),frozenMemberRank(venue,epoch,b));

it('reserves the only large budget for a later winner and omits empty lots',()=>{
  const [firstDebtor,secondDebtor,emptyDebtor]=[0n,1n,2n].sort(order);
  const [firstWinner,secondWinner,emptyWinner]=[3n,4n,5n].sort(order);
  const budgets=[{id:firstDebtor,amount:8n},{id:secondDebtor,amount:2n},{id:emptyDebtor,amount:0n}];
  const capacities=[{id:secondWinner,amount:7n},{id:emptyWinner,amount:0n},{id:firstWinner,amount:2n}];
  const expected=[[secondDebtor,firstWinner,2n,98n],[firstDebtor,secondWinner,7n,93n]];
  const plan=inventoryBookPlan(venue,epoch,budgets,capacities,-1n,100n);
  expect(plan.pairs).toEqual(expected);
  expect(plan.total).toEqual(9n);
  expect(inventoryBookPlan(venue,epoch,budgets.reverse(),capacities.reverse(),-1n,100n)).toEqual(plan);
  const empty=inventoryBookPlan(venue,epoch,budgets.map(member=>({...member,amount:0n})),capacities,-1n,100n);
  expect(empty.pairs).toEqual([]);
  expect(empty.digest).not.toEqual(plan.digest);
});
