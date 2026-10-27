import * as sdk from '@rivalt/sdk';
import {eventPayloads, json, PROGRAM, type JournalEvent} from './events.js';
import {integer} from './rpc.js';

const decoders = [
  ['AccountAuthorityChangedV3', sdk.ACCOUNT_AUTHORITY_CHANGED_V3_EVENT_DISCRIMINATOR, sdk.getAccountAuthorityChangedV3EventDecoder()],
  ['AccountBackingChangedV3', sdk.ACCOUNT_BACKING_CHANGED_V3_EVENT_DISCRIMINATOR, sdk.getAccountBackingChangedV3EventDecoder()],
  ['AccountCustodyChangedV3', sdk.ACCOUNT_CUSTODY_CHANGED_V3_EVENT_DISCRIMINATOR, sdk.getAccountCustodyChangedV3EventDecoder()],
  ['AccountFinancialChangedV3', sdk.ACCOUNT_FINANCIAL_CHANGED_V3_EVENT_DISCRIMINATOR, sdk.getAccountFinancialChangedV3EventDecoder()],
  ['AccountLiquidatedV3', sdk.ACCOUNT_LIQUIDATED_V3_EVENT_DISCRIMINATOR, sdk.getAccountLiquidatedV3EventDecoder()],
  ['AccountMakerChangedV3', sdk.ACCOUNT_MAKER_CHANGED_V3_EVENT_DISCRIMINATOR, sdk.getAccountMakerChangedV3EventDecoder()],
  ['AccountOracleChangedV3', sdk.ACCOUNT_ORACLE_CHANGED_V3_EVENT_DISCRIMINATOR, sdk.getAccountOracleChangedV3EventDecoder()],
  ['AccountOrderChangedV3', sdk.ACCOUNT_ORDER_CHANGED_V3_EVENT_DISCRIMINATOR, sdk.getAccountOrderChangedV3EventDecoder()],
  ['AccountQualificationV3', sdk.ACCOUNT_QUALIFICATION_V3_EVENT_DISCRIMINATOR, sdk.getAccountQualificationV3EventDecoder()],
  ['AccountResolutionAppliedV3', sdk.ACCOUNT_RESOLUTION_APPLIED_V3_EVENT_DISCRIMINATOR, sdk.getAccountResolutionAppliedV3EventDecoder()],
  ['AccountResolutionCompletedV3', sdk.ACCOUNT_RESOLUTION_COMPLETED_V3_EVENT_DISCRIMINATOR, sdk.getAccountResolutionCompletedV3EventDecoder()],
  ['AccountResolutionFrozenV3', sdk.ACCOUNT_RESOLUTION_FROZEN_V3_EVENT_DISCRIMINATOR, sdk.getAccountResolutionFrozenV3EventDecoder()],
  ['AccountResolutionOrderV3', sdk.ACCOUNT_RESOLUTION_ORDER_V3_EVENT_DISCRIMINATOR, sdk.getAccountResolutionOrderV3EventDecoder()],
  ['AccountResolutionPlannedV3', sdk.ACCOUNT_RESOLUTION_PLANNED_V3_EVENT_DISCRIMINATOR, sdk.getAccountResolutionPlannedV3EventDecoder()],
  ['AccountResolutionProgressV3', sdk.ACCOUNT_RESOLUTION_PROGRESS_V3_EVENT_DISCRIMINATOR, sdk.getAccountResolutionProgressV3EventDecoder()],
  ['AccountResolutionProposalV3', sdk.ACCOUNT_RESOLUTION_PROPOSAL_V3_EVENT_DISCRIMINATOR, sdk.getAccountResolutionProposalV3EventDecoder()],
  ['AccountResolutionRatesV3', sdk.ACCOUNT_RESOLUTION_RATES_V3_EVENT_DISCRIMINATOR, sdk.getAccountResolutionRatesV3EventDecoder()],
  ['AccountResolutionRoundedV3', sdk.ACCOUNT_RESOLUTION_ROUNDED_V3_EVENT_DISCRIMINATOR, sdk.getAccountResolutionRoundedV3EventDecoder()],
  ['AccountResolutionValuedV3', sdk.ACCOUNT_RESOLUTION_VALUED_V3_EVENT_DISCRIMINATOR, sdk.getAccountResolutionValuedV3EventDecoder()],
  ['AccountRetirementProgressV3', sdk.ACCOUNT_RETIREMENT_PROGRESS_V3_EVENT_DISCRIMINATOR, sdk.getAccountRetirementProgressV3EventDecoder()],
  ['AccountRouteExecutedV3', sdk.ACCOUNT_ROUTE_EXECUTED_V3_EVENT_DISCRIMINATOR, sdk.getAccountRouteExecutedV3EventDecoder()],
  ['AccountSafetyRecoveryV3', sdk.ACCOUNT_SAFETY_RECOVERY_V3_EVENT_DISCRIMINATOR, sdk.getAccountSafetyRecoveryV3EventDecoder()],
  ['AccountsRetiredV3', sdk.ACCOUNTS_RETIRED_V3_EVENT_DISCRIMINATOR, sdk.getAccountsRetiredV3EventDecoder()],
  ['RetiredReserveWithdrawnV3', sdk.RETIRED_RESERVE_WITHDRAWN_V3_EVENT_DISCRIMINATOR, sdk.getRetiredReserveWithdrawnV3EventDecoder()],
 ] as const;
export type AccountEvent = JournalEvent & {type: typeof decoders[number][0]};

/** Only authenticated, successful CPI payloads can affect schema-3 state. */
export function decodeAccounts(signature: string, transaction: any, authority: string,
  venue: string, program: string = PROGRAM): AccountEvent[] {
  return eventPayloads(signature, transaction, authority, program).flatMap(({outer, inner, payload}) => {
    const entry = decoders.find(([, discriminator]) => payload.subarray(0,8).equals(Buffer.from(discriminator)));
    if (!entry) throw new Error('Unknown critical account event schema');
    const [type, , decoder] = entry;
    const [value, end] = decoder.read(payload, 0);
    if (end !== payload.length) throw new Error('Trailing account event bytes');
    const data = JSON.parse(json(value));
    if (BigInt(data.slot) !== BigInt(transaction.slot)) throw new Error('Account event slot mismatch');
    if (type === 'AccountCustodyChangedV3' && (data.schemaVersion !== 3 || data.profileVersion !== 3))
      throw new Error('Unsupported account event version');
    if (data.venue !== venue) return [];
    return [{signature, outer, inner, ordinal:0, slot:transaction.slot,
      blockTime:transaction.blockTime === null ? null : integer(transaction.blockTime), type, data, bytes:payload.toString('base64')}];
  });
}
