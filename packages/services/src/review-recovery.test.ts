import { describe, expect, it, vi } from 'vitest';
import { getProgramDerivedAddress } from '@solana/kit';
import { Keypair } from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import { Runtime } from './runtime.js';

const key = await Keypair.generate();
const market = (await sdk.findLegacyMarketPda())[0];
const program = sdk.CLEARING_PROGRAM_ADDRESS;
const eventAuthority = (await getProgramDerivedAddress({ programAddress: program, seeds: [Buffer.from('__event_authority')] }))[0];
const ix = await sdk.getSetCustodyPauseInstructionAsync({ authority: key, paused: true, eventAuthority, program });
function enqueueRuntime(statuses: string[]) {
  const rows = statuses.map(status => ({ status }));
  const get = vi.fn(async (id: string) => rows[id.includes(':retry:') ? Number(id.split(':').at(-1)) : 0] ?? null);
  const put = vi.fn();
  const getLatestBlockhash = vi.fn(async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n }));
  const runtime = Object.assign(Object.create(Runtime.prototype), { queue: { get, put }, connection: { getLatestBlockhash } }) as Runtime;
  return { runtime, get, put, getLatestBlockhash };
}
describe('immutable operator retry policy', () => {
  for (const status of ['pending', 'unresolved', 'finalized']) it(`does not replace ${status} signed authority`, async () => {
    const t = enqueueRuntime(['failed', status]);
    await t.runtime.enqueue('funding:7', [ix], key, 'funding', { kind: 'sequence', account: market, value: '9' });
    expect(t.getLatestBlockhash).not.toHaveBeenCalled();
    expect(t.put).not.toHaveBeenCalled();
  });
  it('allocates a new ID after proven failures without rewriting the old attempts', async () => {
    const t = enqueueRuntime(['failed', 'expired-unexecuted']);
    await t.runtime.enqueue('keeper:7:collect:1', [ix], key, 'keeper', { kind: 'sequence', account: market, value: '7' });
    expect(t.put).toHaveBeenCalledTimes(1);
    expect(t.put.mock.calls[0][0]).toBe('keeper:7:collect:1:retry:2');
    expect(t.put.mock.calls[0][2]).toEqual({ kind: 'sequence', account: market, value: '7' });
  });
  it('bounds attempts before signing or reserving another fee', async () => {
    const t = enqueueRuntime(Array(16).fill('failed'));
    await expect(t.runtime.enqueue('funding:7', [ix], key, 'funding', null)).rejects.toThrow('retry limit');
    expect(t.put).not.toHaveBeenCalled();
    expect(t.getLatestBlockhash).not.toHaveBeenCalled();
  });
});
function riskRuntime(header: any, count: number) {
  const enqueue = vi.fn();
  const query = vi.fn(async (sql: string) => sql.includes('count(*)') ? { rows: [{ count }] } : { rowCount: 0 });
  const snapshot = { market, m: { mode: 3, sequence: 11n }, now: 100n,
    risk: { oracle: { sources: [market, market, market, market] } }, resolutionState: { header } };
  const runtime = Object.assign(Object.create(Runtime.prototype), { options: {}, runId: 'test', budgets: { operator: 5_000_000n },
    queue: { budget: vi.fn() }, store: { pool: { query } }, snapshot: async () => snapshot, enqueue }) as Runtime;
  return { runtime, enqueue, query };
}
describe('bounded completed-resolution checks', () => {
  it('stops after qualification even when the authority delays beyond freshness', async () => {
    const t = riskRuntime({ stage: 12, epoch: 2n, recoverySince: 70n, recoveryLast: 76n }, 4);
    await t.runtime.riskWork(key); expect(t.enqueue).not.toHaveBeenCalled();
  });
  it('stops at the durable per-epoch cap, including after process restart', async () => {
    for (let restart = 0; restart < 2; restart++) {
      const t = riskRuntime({ stage: 12, epoch: 2n, recoverySince: 0n, recoveryLast: 96n }, 8);
      await t.runtime.riskWork(key); expect(t.enqueue).not.toHaveBeenCalled();
      expect(t.query.mock.calls[1][0]).toContain('starts_with');
    }
  });
  it('allows an incomplete window below the cap using the same ID for the same chain state', async () => {
    const t = riskRuntime({ stage: 12, epoch: 2n, recoverySince: 94n, recoveryLast: 96n }, 7);
    await t.runtime.riskWork(key); await t.runtime.riskWork(key);
    expect(t.enqueue).toHaveBeenCalledTimes(2);
    expect(t.enqueue.mock.calls[0][0]).toBe('risk:check:2:12:96:11');
    expect(t.enqueue.mock.calls[1][0]).toBe(t.enqueue.mock.calls[0][0]);
    expect(sdk.getRecoverResolutionInstructionDataDecoder().decode(t.enqueue.mock.calls[0][1][1].data).resume).toBe(false);
  });
  it('respects the minimum interval before another paid check', async () => {
    const t = riskRuntime({ stage: 12, epoch: 2n, recoverySince: 99n, recoveryLast: 99n }, 1);
    await t.runtime.riskWork(key); expect(t.enqueue).not.toHaveBeenCalled();
  });
});
