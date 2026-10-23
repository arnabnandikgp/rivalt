import type { SignedIntent } from '@rivalt/sdk';
export const terminal = (x: SignedIntent) => x.status === 'finalized' || x.status === 'failed';
/** Keep every unresolved signature, even when terminal history is trimmed. */
export const retain = (items: SignedIntent[]) =>
  items.filter((x) => !terminal(x)).concat(items.filter(terminal).slice(-50));
/** A delayed polling response must never erase a receipt saved during signing. */
export function mergeReconciled(current: SignedIntent[], previous: SignedIntent[], updates: SignedIntent[]) {
  return current.map((x) => {
    const before = previous.find((p) => p.id === x.id),
      updated = updates.find((p) => p.id === x.id);
    return before && updated && JSON.stringify(before) === JSON.stringify(x) ? updated : x;
  });
}
