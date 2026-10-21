import { createHash } from 'node:crypto';
import { getBase58Encoder } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { integer } from './rpc.js';

export const PROGRAM = sdk.CLEARING_PROGRAM_ADDRESS;
export const json = (value: unknown): string => JSON.stringify(value, (_, x) =>
  typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? Buffer.from(x).toString('hex') :
    x?.type === 'Buffer' && Array.isArray(x.data) ? Buffer.from(x.data).toString('hex') : x);
export const hash = (value: unknown) => createHash('sha256').update(json(value)).digest('hex');
export type Event = { signature: string; outer: number; inner: number; ordinal: number; slot: number;
  blockTime: number | null; type: 'custody' | 'maker' | 'risk' | 'route' | 'settlement' | 'oracle'; data: any; bytes: string };
const decoders = [
  ['custody', sdk.CUSTODY_CHANGED_EVENT_DISCRIMINATOR, sdk.getCustodyChangedEventDecoder()],
  ['maker', sdk.MAKER_CHANGED_EVENT_DISCRIMINATOR, sdk.getMakerChangedEventDecoder()],
  ['risk', sdk.TEST_RISK_PUBLISHED_EVENT_DISCRIMINATOR, sdk.getTestRiskPublishedEventDecoder()],
  ['route', sdk.ROUTE_EXECUTED_EVENT_DISCRIMINATOR, sdk.getRouteExecutedEventDecoder()],
  ['oracle', sdk.ORACLE_OBSERVED_EVENT_DISCRIMINATOR, sdk.getOracleObservedEventDecoder()],
  ['settlement', sdk.SETTLEMENT_CHANGED_EVENT_DISCRIMINATOR, sdk.getSettlementChangedEventDecoder()],
] as const;
const envelope = Buffer.from('e445a52e51cb9a1d', 'hex');

export function decode(signature: string, tx: any, eventAuthority: string): Event[] {
  if (!tx?.meta || tx.transaction?.signatures?.[0] !== signature) throw new Error('Missing transaction metadata/identity');
  integer(tx.slot);
  if (tx.meta.err !== null) return []; // Retained reverted event bytes are never projected.
  if (!Array.isArray(tx.meta.innerInstructions)) throw new Error('Missing inner instructions');
  const keys = [...tx.transaction.message.accountKeys, ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])];
  const events: Event[] = [];
  for (const group of tx.meta.innerInstructions) {
    integer(group.index);
    for (const [inner, ix] of group.instructions.entries()) {
      if (keys[ix.programIdIndex] !== PROGRAM) continue;
      const bytes = Buffer.from(getBase58Encoder().encode(ix.data));
      if (!bytes.subarray(0, 8).equals(envelope)) continue;
      if (ix.accounts.length !== 1 || keys[ix.accounts[0]] !== eventAuthority) throw new Error('Invalid event authority');
      const payload = bytes.subarray(8);
      // The nonfinancial P01 probe is the only deliberately ignored event schema.
      if (payload.subarray(0, 8).equals(Buffer.from(sdk.PROBE_RECORDED_EVENT_DISCRIMINATOR))) continue;
      const entry = decoders.find(([, disc]) => payload.subarray(0, 8).equals(Buffer.from(disc)));
      if (!entry) throw new Error('Unknown critical event schema');
      const [type, , decoder] = entry;
      const [value, end] = decoder.read(payload, 0);
      if (end !== payload.length) throw new Error('Trailing event bytes');
      const data = JSON.parse(json(value));
      if ((data.schemaVersion ?? data.version) !== 1 || (type === 'custody' && data.profileVersion !== 1)) throw new Error('Unsupported event version');
      if ('slot' in data && BigInt(data.slot) !== BigInt(tx.slot)) throw new Error('Event slot mismatch');
      events.push({ signature, outer: group.index, inner, ordinal: 0, slot: tx.slot,
        blockTime: tx.blockTime === null ? null : integer(tx.blockTime), type, data, bytes: payload.toString('base64') });
    }
  }
  return events;
}
