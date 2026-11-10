import {expect,it,vi} from 'vitest';
vi.mock('./quantity-search.js',async importOriginal=>({
  ...await importOriginal<typeof import('./quantity-search.js')>(),
  LIQUIDITY_SEARCH_BUDGET:{intervals:0,quantityQuotes:1000},
}));
import {allocateLiquidityRoute} from './liquidity-allocation.js';
import {liquidityFixture} from '../test-support/liquidity-fixture.js';
import {LiquiditySearchLimitError} from './quantity-search.js';

it('does not return a feasible singleton when the pair search cannot certify optimality',()=>{
  const {input}=liquidityFixture();
  expect(()=>allocateLiquidityRoute({...input,lots:100n})).toThrow(LiquiditySearchLimitError);
});
