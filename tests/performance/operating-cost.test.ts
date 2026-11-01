import { expect, it } from 'vitest';
import { operatingDay, transactionCost } from './operating-cost.js';
it('v0 bids use requested limits with integer ceiling, while v1 bids are explicit lamports', () => {
  expect(transactionCost(1n, 5000n, 200_000n, { version: 0, microLamportsPerRequestedCu: 1001n }))
    .toEqual({ base: 5000n, priority: 201n, total: 5201n });
  expect(transactionCost(2n, 5000n, 800_000n, { version: 1, explicitPriorityLamports: 123n }))
    .toEqual({ base: 10000n, priority: 123n, total: 10123n });
});
it('keeps maker-paid updates separate from venue costs and excludes insurance from nominal revenue', () => {
  const result = operatingDay({ makers: 6n, markets: 2n, makerCadenceMs: 1000n, fundingCadenceMs: 2000n,
    makerFeeLamports: 5000n, fundingFeeLamports: 5000n, otherVenueLamports: 0n, collateralAtomsPerSol: 100_000_000n });
  expect(result).toEqual({ makerSubmissions: 518400n, fundingSubmissions: 86400n, makerLamports: 2_592_000_000n,
    venueLamports: 432_000_000n, venueCostCollateralAtoms: 43_200_000n, nominalBreakEvenVolumeAtoms: 288_000_000_000n });
});
it('does not round away fractional daily submissions or collateral costs', () => {
  const result = operatingDay({ makers: 1n, markets: 1n, makerCadenceMs: 86_400_001n, fundingCadenceMs: 86_400_001n,
    makerFeeLamports: 1n, fundingFeeLamports: 1n, otherVenueLamports: 0n, collateralAtomsPerSol: 1n });
  expect(result.makerSubmissions).toBe(1n); expect(result.venueCostCollateralAtoms).toBe(1n);
  expect(result.nominalBreakEvenVolumeAtoms).toBe(6667n);
});
it('rejects negative bids and undefined cadences', () => {
  expect(() => transactionCost(1n, 5000n, 800_000n, { version: 1, explicitPriorityLamports: -1n })).toThrow();
  expect(() => operatingDay({ makers: 1n, markets: 1n, makerCadenceMs: 0n, fundingCadenceMs: 2000n,
    makerFeeLamports: 5000n, fundingFeeLamports: 5000n, otherVenueLamports: 0n, collateralAtomsPerSol: 1n })).toThrow();
});
