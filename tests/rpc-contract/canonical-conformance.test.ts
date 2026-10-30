import { expect, it } from 'vitest';
import { createNoopSigner } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { CanonicalConformance } from './canonical-maker-conformance.js';

it('records the canonical name by discriminator without a generation suffix', () => {
  const key = sdk.CLEARING_PROGRAM_ADDRESS;
  const instruction = sdk.getInitializeLiquidityInstruction({ authority: createNoopSigner(key), venue: key,
    custody: key, market: key, safety: key, registry: key, eventAuthority: key, program: key });
  const conformance = new CanonicalConformance();
  conformance.record([instruction]);
  expect(conformance.modules[0].instructions).toHaveLength(1);
  expect(conformance.modules[0].instructions[0].name).toBe('initializeLiquidity');
  expect(conformance.modules[0].instructions[0].expected.data).toBe(Buffer.from(instruction.data).toString('hex'));
});

it('cannot report instruction parity for an empty selection', async () => {
  await expect(new CanonicalConformance().finish('unused', [], async () => null))
    .rejects.toThrow('No instructions captured for Anchor conformance');
});
