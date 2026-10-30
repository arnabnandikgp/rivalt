import {it,expect} from 'vitest';
import {effectiveFunding,oracleMode,accruedBalance} from '@rivalt/sdk';
it('derives current modes and funding without extending invalid gaps or transferring fractions',()=>{
  const m={mode:2,fundingIndexScaled:237500n,configEpoch:2n},r={validFrom:10n,validUntil:1000n,oracle:{sampledAt:100n,heldUntil:106n,heldEpoch:2n,heldSlot:900n,fundingBase:0n,premiumScaled:285000000n,status:2,sourceDeadline:120n,lastQualified:100n}};
  expect(effectiveFunding(m,r,103n,100n)).toBe(237500n);
  expect(effectiveFunding(m,r,106n,100n)).toBe(475000n);
  expect(effectiveFunding(m,r,110n,100n)).toBe(475000n);
  expect(effectiveFunding(m,r,131n,100n)).toBe(237500n);
  expect(effectiveFunding({...m,configEpoch:3n},r,105n,100n)).toBe(237500n);
  expect(oracleMode(m,r,111n,100n)).toBe('Normal');expect(oracleMode(m,r,112n,100n)).toBe('Degraded');expect(oracleMode(m,r,120n,100n)).toBe('NoCredibleBounds');
  expect(accruedBalance({lots:3n,virtualScaled:0n,fundingCheckpointScaled:0n},237500n).virtualScaled).toBe(-712500n);
  expect(accruedBalance({lots:0n,virtualScaled:-712500n,fundingCheckpointScaled:237500n},475000n).virtualScaled).toBe(-712500n);
});
