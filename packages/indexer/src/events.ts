import { createHash } from 'node:crypto';
import { getBase58Encoder } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { integer } from './rpc.js';

export const PROGRAM = sdk.CLEARING_PROGRAM_ADDRESS;
export const json = (value: unknown): string => JSON.stringify(value, (_, x) =>
  typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? Buffer.from(x).toString('hex') :
    x?.type === 'Buffer' && Array.isArray(x.data) ? Buffer.from(x.data).toString('hex') : x);
export const hash = (value: unknown) => createHash('sha256').update(json(value)).digest('hex');
export type JournalEvent = { signature: string; outer: number; inner: number; ordinal: number; slot: number;
  blockTime: number | null; type: string; data: any; bytes: string };
export type Event = JournalEvent & { type: 'custody' | 'maker' | 'risk' | 'route' | 'settlement' | 'oracle' | 'order' | 'liquidation' | 'resolution' };
const decoders = [
  ['liquidation', sdk.LIQUIDATION_APPLIED_EVENT_DISCRIMINATOR, sdk.getLiquidationAppliedEventDecoder()],
  ['resolution', sdk.RESOLUTION_PROGRESS_EVENT_DISCRIMINATOR, sdk.getResolutionProgressEventDecoder()],
  ['order', sdk.ORDER_CHANGED_EVENT_DISCRIMINATOR, sdk.getOrderChangedEventDecoder()],
  ['custody', sdk.CUSTODY_CHANGED_EVENT_DISCRIMINATOR, sdk.getCustodyChangedEventDecoder()],
  ['maker', sdk.MAKER_CHANGED_EVENT_DISCRIMINATOR, sdk.getMakerChangedEventDecoder()],
  ['risk', sdk.TEST_RISK_PUBLISHED_EVENT_DISCRIMINATOR, sdk.getTestRiskPublishedEventDecoder()],
  ['route', sdk.ROUTE_EXECUTED_EVENT_DISCRIMINATOR, sdk.getRouteExecutedEventDecoder()],
  ['oracle', sdk.ORACLE_OBSERVED_EVENT_DISCRIMINATOR, sdk.getOracleObservedEventDecoder()],
  ['settlement', sdk.SETTLEMENT_CHANGED_EVENT_DISCRIMINATOR, sdk.getSettlementChangedEventDecoder()],
] as const;
const envelope = Buffer.from('e445a52e51cb9a1d', 'hex');

/** Authenticate the producer and CPI envelope before interpreting a schema.
 * A returned payload is never a log-string assertion or a reverted effect. */
export function eventPayloads(signature: string, tx: any, eventAuthority: string, program: string = PROGRAM) {
  if (!tx?.meta || tx.transaction?.signatures?.[0] !== signature) throw new Error('Missing transaction metadata/identity');
  integer(tx.slot);
  if (tx.meta.err !== null) return []; // Retained reverted event bytes are never projected.
  if (!Array.isArray(tx.meta.innerInstructions)) throw new Error('Missing inner instructions');
  const keys = [...tx.transaction.message.accountKeys, ...(tx.meta.loadedAddresses?.writable ?? []), ...(tx.meta.loadedAddresses?.readonly ?? [])];
  const events: { outer: number; inner: number; payload: Buffer }[] = [];
  for (const group of tx.meta.innerInstructions) {
    integer(group.index);
    for (const [inner, ix] of group.instructions.entries()) {
      if (keys[ix.programIdIndex] !== program) continue;
      const bytes = Buffer.from(getBase58Encoder().encode(ix.data));
      if (!bytes.subarray(0, 8).equals(envelope)) continue;
      if (ix.accounts.length !== 1 || keys[ix.accounts[0]] !== eventAuthority) throw new Error('Invalid event authority');
      const payload = bytes.subarray(8);
      // The nonfinancial P01 probe is the only deliberately ignored event schema.
      if (payload.subarray(0, 8).equals(Buffer.from(sdk.PROBE_RECORDED_EVENT_DISCRIMINATOR))) continue;
      events.push({ outer: group.index, inner, payload });
    }
  }
  return events;
}

export function decode(signature: string, tx: any, eventAuthority: string, program: string = PROGRAM): Event[] {
  return eventPayloads(signature, tx, eventAuthority, program).map(({outer, inner, payload}) => {
    const entry = decoders.find(([, disc]) => payload.subarray(0, 8).equals(Buffer.from(disc)));
    if (!entry) throw new Error('Unknown critical event schema');
    const [type, , decoder] = entry;
    const [value, end] = decoder.read(payload, 0);
    if (end !== payload.length) throw new Error('Trailing event bytes');
    const data = JSON.parse(json(value));
    if ((data.schemaVersion ?? data.version) !== 1 || (type === 'custody' && data.profileVersion !== 1)) throw new Error('Unsupported event version');
    if ('slot' in data && BigInt(data.slot) !== BigInt(tx.slot)) throw new Error('Event slot mismatch');
    return { signature, outer, inner, ordinal: 0, slot: tx.slot,
      blockTime: tx.blockTime === null ? null : integer(tx.blockTime), type, data, bytes: payload.toString('base64') };
  });
}
