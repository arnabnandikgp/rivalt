// Narrow P32 journal adapter, deliberately not a public account projection.
// P33 owns production consumers. This fixture verifies actual critical event
// bytes, ordering, SQL atomicity, checkpoints and replay without enabling them.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as sdk from '@rivalt/sdk';
import { eventPayloads, hash, json, type JournalEvent } from '../../packages/indexer/src/events.js';
import { JournalStore, type JournalBinding } from '../../packages/indexer/src/store.js';
import type { WireRpc } from './wire.js';

export type PrototypeState = { sequence: string; digest: string; kinds: Record<string, number> };
export type PrototypeBinding = JournalBinding & { schema: 4; venue: string; scope: 'p32-journal-only' };
const idl = JSON.parse(readFileSync('packages/sdk/idl/clearing.json', 'utf8'));
const decoders = idl.events.map((event: { name: string; discriminator: number[] }) => {
  const factory = (sdk as Record<string, any>)[`get${event.name}EventDecoder`];
  assert.equal(typeof factory, 'function', `Generated decoder for ${event.name}`);
  return { name: event.name, discriminator: Buffer.from(event.discriminator), decoder: factory() };
}) as { name: string; discriminator: Buffer; decoder: { read(bytes: Uint8Array, offset: number): [any, number] } }[];

export function decodePrototype(signature: string, transaction: any, authority: string, venue: string): JournalEvent[] {
  return eventPayloads(signature, transaction, authority).map(({ outer, inner, payload }) => {
    const entry = decoders.find(item => payload.subarray(0, 8).equals(item.discriminator));
    assert(entry, 'Unknown critical prototype event schema');
    const [value, end] = entry.decoder.read(payload, 0);
    assert.equal(end, payload.length, 'Complete critical payload');
    const data = JSON.parse(json(value));
    assert.equal(data.venue, venue, 'Exact prototype venue');
    assert.equal(BigInt(data.slot), BigInt(transaction.slot), 'Fetched event slot');
    assert(BigInt(data.sequence) > 0n, 'Critical sequence is explicit');
    return { signature, outer, inner, ordinal: 0, slot: transaction.slot, blockTime: transaction.blockTime,
      type: entry.name, data, bytes: payload.toString('base64') };
  });
}

const empty = (): PrototypeState => ({ sequence: '0', digest: '0'.repeat(64), kinds: {} });
export const digestEvents = (events: JournalEvent[]) => {
  let digest = '0'.repeat(64);
  for (const event of [...events].sort((left, right) => BigInt(left.data.sequence) < BigInt(right.data.sequence) ? -1 : 1)) {
    digest = createHash('sha256').update(Buffer.from(digest, 'hex')).update(Buffer.from(event.bytes, 'base64')).digest('hex');
  }
  return digest;
};
export class PrototypeJournal extends JournalStore<PrototypeState, PrototypeBinding, JournalEvent> {
  constructor(url: string, runId: string) {
    super(url, runId, { schema: 4, empty, project(state, event, binding) {
      assert.equal(event.data.venue, binding.venue);
      assert.equal(BigInt(event.data.sequence), BigInt(state.sequence) + 1n, 'Prototype critical sequence gap');
      state.digest = createHash('sha256').update(Buffer.from(state.digest, 'hex')).update(Buffer.from(event.bytes, 'base64')).digest('hex');
      state.sequence = String(event.data.sequence);
      state.kinds[event.type] = (state.kinds[event.type] ?? 0) + 1;
    } });
  }
}

export async function fetchPrototypeHistory(rpc: WireRpc, custody: string, authority: string, venue: string) {
  const signatures: { signature: string; slot: number }[] = [];
  let before: string | undefined;
  for (let page = 0; page < 100; page++) {
    const rows = await rpc.call('getSignaturesForAddress', [custody, { commitment: 'finalized', limit: 37, ...(before ? { before } : {}) }]);
    signatures.push(...rows);
    if (rows.length < 37) break;
    before = rows.at(-1).signature;
    assert(page < 99, 'Finite history bound');
  }
  assert(signatures.length > 0);
  assert.equal(new Set(signatures.map(row => row.signature)).size, signatures.length, 'No pagination duplicates');
  const transactions: { signature: string; tx: any }[] = [];
  const events: JournalEvent[] = [];
  for (const item of [...signatures].reverse()) {
    const tx = await rpc.call('getTransaction', [item.signature, { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 1 }]);
    assert(tx, 'Missing finalized history');
    transactions.push({ signature: item.signature, tx });
    events.push(...decodePrototype(item.signature, tx, authority, venue));
  }
  const ordered = [...events].sort((left, right) => BigInt(left.data.sequence) < BigInt(right.data.sequence) ? -1 : 1);
  ordered.forEach((event, index) => assert.equal(BigInt(event.data.sequence), BigInt(index + 1)));
  return { transactions, events: ordered, head: signatures[0], digest: digestEvents(ordered) };
}

export async function prototypeBinding(rpc: WireRpc, history: Awaited<ReturnType<typeof fetchPrototypeHistory>>,
  venue: string, domain: string): Promise<PrototypeBinding> {
  const first = history.events[0];
  // This test-only digest projection uses current IDL names. The production
  // account projection separately preserves its persisted schema-tag mapping.
  assert.equal(first.type, 'AccountCustodyChanged');
  assert.equal(first.data.schemaVersion, 3); assert.equal(first.data.profileVersion, 4);
  const transaction = history.transactions.find(item => item.signature === first.signature)!;
  return { schema: 4, scope: 'p32-journal-only', genesis: await rpc.call('getGenesisHash', []),
    domain, anchor: first.signature, anchorHash: hash(transaction.tx), program: sdk.CLEARING_PROGRAM_ADDRESS, venue };
}
