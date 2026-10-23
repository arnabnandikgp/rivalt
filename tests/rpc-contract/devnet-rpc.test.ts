import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import * as sdk from '@rivalt/sdk';
import { DevnetRpc, persist } from './devnet-rpc.js';

const bundle = JSON.parse(readFileSync('docs/evidence/p13/acceptance/normal-observation-proof.json', 'utf8'));
const original = bundle.journal.find((e: any) => e.label.startsWith('sample-') && e.events.some((x: any) => x.type === 'oracle' && x.data.oracle.status === 2));
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true }); });
function pending(changed = false) {
  const journal = mkdtempSync(join(tmpdir(), 'rivalt-p13-finality-')); directories.push(journal);
  const e = original.events[0], tx = original.history;
  const keys = [...tx.transaction.message.accountKeys, ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])];
  const ix = tx.meta.innerInstructions.find((g: any) => g.index === e.outer).instructions[e.inner];
  const entry = structuredClone(original);
  entry.confirmed = { history: entry.history, events: structuredClone(entry.events) };
  if (changed) entry.confirmed.events[0].data.oracle.status = 0;
  delete entry.history; delete entry.events; delete entry.feeLamports; entry.finalized = false;
  persist(`${journal}/${entry.label}.json`, entry);
  const h = Object.assign(Object.create(DevnetRpc.prototype), {
    a: { program: bundle.report.program, eventAuthority: keys[ix.accounts[0]], guardProgram: 'gUq9vLuLsncqn1JGR753q9XZkypWUoMZ6CKquiCk6EF' }, journal,
    checks: [{ label: entry.label, result: 'confirmed-awaiting-finality' }],
    rpc: { call: vi.fn(async (method: string, params: any[]) => {
      expect(method).toBe('getTransaction'); expect(params[0]).toBe(entry.signature); expect(params[1].commitment).toBe('finalized');
      return params[1].encoding === 'json' ? tx : { transaction: [entry.wire, 'base64'] };
    }) },
  }) as DevnetRpc;
  return { h, entry, journal };
}
test('confirmed observations are promoted only after independent finalized history and exact wire retrieval', async () => {
  const { h, entry, journal } = pending();
  expect(h.checks[0].result).toBe('confirmed-awaiting-finality');
  await h.reconcileObservations();
  expect(h.checks[0].result).toBe('pass');
  const stored = JSON.parse(readFileSync(`${journal}/${entry.label}.json`, 'utf8'));
  expect(stored.finalized).toBe(true); expect(stored.events).toEqual(original.events);
});
test('a changed provisional observation cannot become successful acceptance', async () => {
  const { h } = pending(true);
  await expect(h.reconcileObservations()).rejects.toThrow('Finalized observation differs');
  expect(h.checks[0].result).toBe('confirmed-awaiting-finality');
  await expect(h.reconcileObservations()).rejects.toThrow('Finalized observation differs');
});
test('financial routes cannot opt into the observation-only submission path', async () => {
  const { h } = pending();
  await expect(h.sendObservation('forbidden-route', [{ programAddress: h.a.program, data: sdk.EXECUTE_ROUTE_DISCRIMINATOR }])).rejects.toThrow('Only guard publication');
  expect(h.rpc.call).not.toHaveBeenCalled();
});
