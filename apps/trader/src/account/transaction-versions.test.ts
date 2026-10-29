import {expect,it} from 'vitest';
import {supportsAccountTransactions} from './transaction-versions.js';

it('admits profile 4 only when both compiled transaction formats can be signed',()=>{
  for(const versions of [undefined,new Set<number>(),new Set([0]),new Set([1])])
    expect(supportsAccountTransactions(4,versions)).toBe(false);
  expect(supportsAccountTransactions(4,new Set([0,1]))).toBe(true);
  expect(supportsAccountTransactions(3,new Set([0]))).toBe(true);
  expect(supportsAccountTransactions(3,new Set([1]))).toBe(false);
});
