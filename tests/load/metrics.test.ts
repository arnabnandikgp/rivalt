import { expect, it } from 'vitest';
import { distribution, summarize, type Attempt } from './metrics.js';
import { LiquidityIndexer } from '../../packages/indexer/src/index.js';
it('retains every offered, failed, pending and fault population without denominator inflation',()=>{
  const row=(status:string,extra:Partial<Attempt>={}):Attempt=>({id:status,phase:'x',actor:0,offeredAt:0,fault:false,status,...extra});
  const result=summarize([
    row('quote-unavailable'),row('unfilled-account-busy'),row('finalized',{signature:'a',eligible:true,fee:'5000'}),
    row('failed',{signature:'b',eligible:true,fee:'5000'}),row('unresolved',{signature:'c',eligible:true}),
    row('failed',{signature:'d',eligible:true,fault:true,fee:'10000'})]);
  expect(result.offered).toBe(6);expect(result.submitted).toBe(4);expect(result.normalEligible).toBe(3);
  expect(result.normalSuccessful).toBe(1);expect(result.normalSuccess).toBe(1/3);expect(result.fees).toBe('20000');
  expect(result.statusCounts.unresolved).toBe(1);
  expect(result.normalOffered).toBe(5);expect(result.normalAvailability).toBe(3/5);
});
it('uses a complete nearest-rank latency population and reports absent observations explicitly',()=>{
  expect(distribution([100,1,30,20,10])).toEqual({count:5,p50:20,p95:100,p99:100,max:100});
  expect(distribution([]).p95).toBeNull();expect(()=>distribution([NaN])).toThrow();
  expect(summarize([]).normalSuccess).toBeNull();
});
it('rejects unsafe/unbounded history options before opening a database',()=>{
  for(const limit of [0,-1,200001,Infinity,1.5,NaN])expect(()=>new LiquidityIndexer({rpcUrl:'http://127.0.0.1',wsUrl:'ws://127.0.0.1',databaseUrl:'unused',runId:'bounds',venue:'11111111111111111111111111111111',profile:'liquidity-execution-qualification',anchor:'unused',maxRecoveryTransactions:limit})).toThrow('Invalid bounded');
});
