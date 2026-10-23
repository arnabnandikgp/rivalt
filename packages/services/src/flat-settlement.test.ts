import { expect, it, vi } from 'vitest';
import { address } from '@solana/kit';
import { Keypair } from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import { Runtime } from './runtime.js';

it('collects an existing flat whole-atom loss during a source outage but refuses exposed, paused and frozen cohorts', async () => {
  const program = sdk.testDeployment('solana:devnet').clearing, options = { programAddress: program };
  const market = (await sdk.findMarketPda(options))[0];
  const participant = address('9EyFUQ1jcHMDnk1kGGs6yeamtdhzn4Us2mFwyZxCsCCU');
  const snapshot: any = { market, m: { mode: 2, paused: false, sequence: 44n },
    risk: { validFrom: 1n, validUntil: 0n, observationSequence: 22n, referencePrice: 81_900n },
    slot: 10n, sourceMode: 'NoCredibleBounds', members: [participant],
    participants: { [participant]: { id: 0, cash: 1000n, lots: 0n, virtualScaled: -3_500_000_000n } } };
  const enqueue = vi.fn();
  const runtime = Object.assign(Object.create(Runtime.prototype), { options, runId: 'test', budgets: { operator: 5_000_000n },
    queue: { budget: vi.fn() }, store: { pool: { query: vi.fn(async () => ({ rowCount: 0 })) } },
    snapshot: async () => snapshot, enqueue }) as Runtime;
  const key = await Keypair.generate();
  await runtime.settle(key);
  expect(enqueue).toHaveBeenCalledTimes(1);
  const ix = enqueue.mock.calls[0][1][0];
  expect(ix.programAddress).toBe(program);
  expect(sdk.getCollectLossInstructionDataDecoder().decode(ix.data)).toMatchObject({ amount: 3n, sequence: 44n, observation: 22n });
  for (const restriction of ['exposed', 'paused', 'frozen']) {
    enqueue.mockClear(); snapshot.m.mode = restriction === 'frozen' ? 3 : 2;
    snapshot.m.paused = restriction === 'paused'; snapshot.participants[participant].lots = restriction === 'exposed' ? 1n : 0n;
    await runtime.settle(key); expect(enqueue).not.toHaveBeenCalled();
  }
});
