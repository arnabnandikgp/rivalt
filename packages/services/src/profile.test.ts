import { describe, expect, it } from 'vitest';
import { localBudgets } from './profile.js';

describe('explicit local fee profile',()=>{
  it('preserves smoke budgets and gives the declared sampler a bounded full-day reserve',()=>{
    const defaultCaps=localBudgets();expect(defaultCaps.operator).toBe(5_000_000n);expect(defaultCaps.maker).toBe(1_000_000n);
    const caps=localBudgets('soak24','http://127.0.0.1:18899');
    const oneDaySamples=86400n/2n,actualFee=5000n;
    expect(caps.operator>=2n*oneDaySamples*actualFee).toBe(true);
    expect(caps.operator).toBeLessThan(1_000_000_000n);expect(Object.isFrozen(caps)).toBe(true);
  });
  it('cannot select an unbounded or remote long-run budget',()=>{
    for(const name of ['production','5000000000','','SOAK24'])expect(()=>localBudgets(name)).toThrow();
    expect(()=>localBudgets('soak24','https://api.devnet.solana.com')).toThrow();
    expect(()=>localBudgets('soak24','http://127.0.0.1.evil.test')).toThrow();
  });
});
