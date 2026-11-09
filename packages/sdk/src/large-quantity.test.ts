import {expect,it} from 'vitest';
import {liquidityFixture} from '../test-support/liquidity-fixture.js';
import {allocateLiquidityRoute} from './liquidity-allocation.js';
import {quoteCanonical,validateCanonicalShape} from './canonical-quote.js';
import {MAX_ACTION_LOTS,MAX_MAKER_DEPTH_LOTS} from './quantity-limits.js';

function largeFixture() {
  const test=liquidityFixture();test.root.cash=10n**13n;test.input.allInLimit=10n**15n;test.input.maxFee=10n**15n;
  test.markets[0].grossLots=0n;
  for(const maker of test.makers){
    maker.capital.cash=10n**13n;
    maker.shape={...maker.shape,longCap:MAX_MAKER_DEPTH_LOTS,shortCap:MAX_MAKER_DEPTH_LOTS,
      bids:[{endLots:MAX_MAKER_DEPTH_LOTS,offset:10n,slope:0n}],asks:[{endLots:MAX_MAKER_DEPTH_LOTS,offset:10n,slope:0n}]};
  }
  return test;
}
it('quotes one million and the full numeric-domain quantity without per-lot enumeration',()=>{
  const {input}=largeFixture();
  for(const lots of [4097n,4609n,1_000_000n,MAX_ACTION_LOTS]){
    const result=allocateLiquidityRoute({...input,lots});
    // Flat ask 10,010 atoms, exact 2bps fee; all ties select singleton zero.
    const gross=10010n*lots,fee=(gross+4999n)/5000n;
    expect(result.allocation).toMatchObject({lots,grossQuote:gross,fee,allIn:gross+fee,legs:[{instance:0,lots}]});
    expect(result.metrics.quantityQuotes).toBeLessThan(400);
    expect(result.metrics.compositions).toBeLessThan(10);
  }
  expect(()=>allocateLiquidityRoute({...input,lots:MAX_ACTION_LOTS+1n})).toThrow(/financial context/);
});
it('finds a single financially eligible quantity inside a million-lot maker interval',()=>{
  const {input,makers,markets}=largeFixture();makers[2].unavailable='quarantined';
  makers[0].capital.cash=500n;Object.assign(makers[0].capital.positions[0],{
    lots:700_000n,virtualScaled:-7_000_000_000n*10n**9n,generation:1n});
  markets[0].grossLots=1_400_000n;
  makers[1].shape={...makers[1].shape,asks:[{endLots:MAX_MAKER_DEPTH_LOTS,offset:30n,slope:0n}]};
  const result=allocateLiquidityRoute({...input,lots:1_000_000n});
  expect(result.allocation).toMatchObject({grossQuote:10_016_000_000n,fee:2_003_200n,legs:[
    {instance:0,lots:700_000n},{instance:1,lots:300_000n}]});
  expect(result.metrics.intervals).toBeLessThan(100);
  expect(result.metrics.quantityQuotes).toBeLessThan(3000);
});
it('rejects an unaffordable large trade by an interval bound without scanning quantities',()=>{
  const {input,root}=largeFixture();root.cash=1n;
  const result=allocateLiquidityRoute({...input,lots:1_000_000n});
  expect(result.allocation).toBeNull();expect(result.metrics.quantityQuotes).toBeLessThan(400);
});
it('retains exact consumed depth and full-width prefix arithmetic',()=>{
  const {makers}=largeFixture(),shape={...makers[0].shape,
    asks:[{endLots:MAX_MAKER_DEPTH_LOTS,offset:999_999n,slope:0n}]};
  // Gross prefix reaches 1e14; consumed 99,999,999 leaves one lot.
  expect(quoteCanonical(shape,1n,0,1n,0n,MAX_MAKER_DEPTH_LOTS-1n)).toEqual({gross:1_000_000n,remaining:0n});
  expect(quoteCanonical(shape,1n,0,MAX_MAKER_DEPTH_LOTS,0n,0n).gross).toBe(100_000_000_000_000n);
  expect(()=>validateCanonicalShape({...shape,asks:[{endLots:MAX_MAKER_DEPTH_LOTS+1n,offset:0n,slope:0n}]})).toThrow();
});
