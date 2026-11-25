import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

// Each caller already signed, simulated and subscribed to its original signature.
// Wake senders in offer order at the first observed processed-slot transition.
export function presignedBurst(size: number, readSlot: () => Promise<number>) {
  const waiting = new Map<number, {resolve: () => void; reject: (reason: Error) => void}>();
  let failure: Error | undefined;
  let release: {previousSlot: number; slot: number; at: number} | undefined;
  function abort(reason: unknown) {
    failure ??= reason instanceof Error ? reason : new Error(String(reason));
    for (const sender of waiting.values()) sender.reject(failure);
  }
  async function releaseAtSlotChange() {
    const previousSlot = await readSlot(), deadline = performance.now() + 5000;
    let slot = previousSlot;
    while (slot === previousSlot) {
      assert(performance.now() < deadline, 'No processed slot change for the signed burst');
      await delay(5);
      slot = await readSlot();
    }
    assert(slot > previousSlot);
    if (failure) throw failure;
    release = {previousSlot, slot, at: performance.now()};
    for (let id = 0; id < size; id++) waiting.get(id)!.resolve();
  }
  function ready(id: number) {
    if (failure) return Promise.reject(failure);
    assert(Number.isInteger(id) && id >= 0 && id < size && !waiting.has(id));
    return new Promise<void>((resolve, reject) => {
      waiting.set(id, {resolve, reject});
      if (waiting.size === size) void releaseAtSlotChange().catch(abort);
    });
  }
  return {ready, abort, released() { assert(release); return release; }};
}
