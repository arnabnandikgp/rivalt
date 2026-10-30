import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNoopSigner } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { testAddress } from '../../packages/sdk/test-support/liquidity-fixture.js';
import { CanonicalConformance } from './canonical-maker-conformance.js';

it('matches isolated Anchor for nested identities, optional legs and flattened intents', async () => {
  const conformance = new CanonicalConformance();
  const common = { actor: createNoopSigner(testAddress(1)), venue: testAddress(2), custody: testAddress(3),
    safety: testAddress(4), market: testAddress(5), otherMarket: testAddress(6), ledger: testAddress(7),
    otherLedger: testAddress(8), vault: testAddress(9), trader: testAddress(10), registry: testAddress(11),
    firstCapital: testAddress(12), firstRegistration: testAddress(13), firstProgram: sdk.makerA.MAKER_A_PROGRAM_ADDRESS,
    firstProgramData: testAddress(14), firstConfig: testAddress(15), firstPrice: testAddress(16),
    eventAuthority: testAddress(17), program: sdk.CLEARING_PROGRAM_ADDRESS,
    guard: { safetyEpoch: 1n, venueTermsEpoch: 2n, nonce: 3n, stateVersion: 4n },
    startSlot: 5n, expirySlot: 150n, lots: 2n };
  const leg = { lots: 1n, authorityEpoch: 21n, controlEpoch: 22n, shapeEpoch: 23n, depthEpoch: 24n };
  for (const two of [false, true]) {
    const accounts = { ...common, lots: two ? 2n : 1n, legs: two ? [leg, leg] : [leg],
      secondCapital: two ? testAddress(18) : undefined, secondRegistration: two ? testAddress(19) : undefined,
      secondProgram: two ? sdk.makerB.MAKER_B_PROGRAM_ADDRESS : undefined,
      secondProgramData: two ? testAddress(20) : undefined, secondConfig: two ? testAddress(21) : undefined,
      secondPrice: two ? testAddress(22) : undefined };
    for (const generation of [null, 1n]) conformance.record([sdk.getExecuteLiquidityRouteInstruction({ ...accounts,
      domain: new Uint8Array(32).fill(31), termsEpoch: 32n, configEpoch: 33n, side: 0,
      allInLimit: 120_033n, maxFee: 25n, reduceOnly: false, generation })]);
    conformance.record([sdk.getExecuteLiquidityOrderInstruction({ ...accounts, id: 34n, version: 35n, filled: 36n })]);
  }
  conformance.record([sdk.getActivateLiquidityInstruction({ authority: common.actor, venue: common.venue,
    custody: common.custody, safety: common.safety, btc: common.market, eth: common.otherMarket,
    btcLedger: common.ledger, ethLedger: common.otherLedger, vault: common.vault,
    eventAuthority: common.eventAuthority, program: common.program, resolution: testAddress(23) })]);
  const directory = mkdtempSync(join(tmpdir(), 'rivalt-route-parity-'));
  try {
    const result = await conformance.finish(directory, [], async () => null);
    expect(result[0].instructions).toBe(7);
  } finally { rmSync(directory, { recursive: true }); }
});
