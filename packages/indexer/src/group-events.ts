import * as sdk from '@rivalt/sdk';
import { eventPayloads, json, PROGRAM, type JournalEvent } from './events.js';
import { integer } from './rpc.js';

const decoders = [
  ['group-custody', sdk.GROUP_CUSTODY_CHANGED_V2_EVENT_DISCRIMINATOR, sdk.getGroupCustodyChangedV2EventDecoder()],
  ['group-maker', sdk.GROUP_MAKER_CHANGED_V2_EVENT_DISCRIMINATOR, sdk.getGroupMakerChangedV2EventDecoder()],
  ['group-oracle', sdk.GROUP_ORACLE_CHANGED_V2_EVENT_DISCRIMINATOR, sdk.getGroupOracleChangedV2EventDecoder()],
  ['group-order', sdk.GROUP_ORDER_CHANGED_V2_EVENT_DISCRIMINATOR, sdk.getGroupOrderChangedV2EventDecoder()],
  ['group-route', sdk.GROUP_ROUTE_EXECUTED_V2_EVENT_DISCRIMINATOR, sdk.getGroupRouteExecutedV2EventDecoder()],
  ['margin-order', sdk.MARGIN_ORDER_CHANGED_V2_EVENT_DISCRIMINATOR, sdk.getMarginOrderChangedV2EventDecoder()],
  ['margin-route', sdk.MARGIN_ROUTE_EXECUTED_V2_EVENT_DISCRIMINATOR, sdk.getMarginRouteExecutedV2EventDecoder()],
  ['margin-authority', sdk.MARGIN_AUTHORITY_CHANGED_V2_EVENT_DISCRIMINATOR, sdk.getMarginAuthorityChangedV2EventDecoder()],
  ['margin-netting', sdk.MARGIN_CLAIMS_NETTED_V2_EVENT_DISCRIMINATOR, sdk.getMarginClaimsNettedV2EventDecoder()],
  ['group-safety', sdk.GROUP_SAFETY_CHANGED_V2_EVENT_DISCRIMINATOR, sdk.getGroupSafetyChangedV2EventDecoder()],
  ['group-liquidation', sdk.GROUP_LIQUIDATION_V2_EVENT_DISCRIMINATOR, sdk.getGroupLiquidationV2EventDecoder()],
  ['group-resolution', sdk.GROUP_RESOLUTION_PROGRESS_V2_EVENT_DISCRIMINATOR, sdk.getGroupResolutionProgressV2EventDecoder()],
] as const;
export type GroupEvent = JournalEvent & { type: typeof decoders[number][0] };

/** A schema-2 run has one immutable group binding and one global sequence.
 * Other groups can share a program, but V1/unknown critical schemas fail closed. */
export function decodeGroup(signature: string, transaction: any, authority: string,
  group: string, program: string = PROGRAM): GroupEvent[] {
  return eventPayloads(signature, transaction, authority, program).flatMap(({outer, inner, payload}) => {
    const entry = decoders.find(([, discriminator]) => payload.subarray(0, 8).equals(Buffer.from(discriminator)));
    if (!entry) throw new Error('Unknown critical group event schema');
    const [type, , decoder] = entry;
    const [value, end] = decoder.read(payload, 0);
    if (end !== payload.length) throw new Error('Trailing group event bytes');
    const data = JSON.parse(json(value));
    if (BigInt(data.slot) !== BigInt(transaction.slot)) throw new Error('Group event slot mismatch');
    if (type === 'group-custody' && (data.schemaVersion !== 2 || data.profileVersion !== 2))
      throw new Error('Unsupported group event version');
    if (data.group !== group) return [];
    return [{ signature, outer, inner, ordinal: 0, slot: transaction.slot,
      blockTime: transaction.blockTime === null ? null : integer(transaction.blockTime), type, data,
      bytes: payload.toString('base64') }];
  });
}
