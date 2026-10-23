import { expect, it } from 'vitest';
import type { SignedIntent } from '@rivalt/sdk';
import { mergeReconciled, retain } from './receipts.js';
const receipt = (id: string, status: SignedIntent['status'] = 'pending') =>
  ({ id, status, signature: id, wire: id }) as SignedIntent;
it('a slow reconciliation retains a newly signed deposit and a more recent status', () => {
  const previous = [receipt('a')],
    final = receipt('a', 'finalized'),
    deposit = receipt('new');
  expect(mergeReconciled([...previous, deposit], previous, [final])).toEqual([final, deposit]);
  expect(mergeReconciled([final, deposit], previous, [receipt('a', 'confirmed')])).toEqual([final, deposit]);
});
it('history limits never discard unresolved signed transactions', () => {
  const unresolved = Array.from({ length: 60 }, (_, i) => receipt(String(i), 'unresolved'));
  const finished = Array.from({ length: 70 }, (_, i) => receipt(`done-${i}`, 'finalized'));
  expect(retain([...unresolved, ...finished])).toEqual([...unresolved, ...finished.slice(-50)]);
});
