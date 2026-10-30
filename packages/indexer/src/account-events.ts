import * as sdk from '@rivalt/sdk';
import {eventPayloads, json, PROGRAM, type JournalEvent} from './events.js';
import {integer} from './rpc.js';

// Stable persisted journal/API tags retain their schema suffix; generated source
// names are canonical. Renaming a Rust event must not relabel stored originals.
const decoders = [
  ['LiquidityRegistryChangedV4', sdk.LIQUIDITY_REGISTRY_CHANGED_EVENT_DISCRIMINATOR, sdk.getLiquidityRegistryChangedEventDecoder()],
  ['LiquidityMakerChangedV4', sdk.LIQUIDITY_MAKER_CHANGED_EVENT_DISCRIMINATOR, sdk.getLiquidityMakerChangedEventDecoder()],
  ['FundingPublisherChangedV4', sdk.FUNDING_PUBLISHER_CHANGED_EVENT_DISCRIMINATOR, sdk.getFundingPublisherChangedEventDecoder()],
  ['FundingReportAcceptedV4', sdk.FUNDING_REPORT_ACCEPTED_EVENT_DISCRIMINATOR, sdk.getFundingReportAcceptedEventDecoder()],
  ['LiquidityRouteExecutedV4', sdk.LIQUIDITY_ROUTE_EXECUTED_EVENT_DISCRIMINATOR, sdk.getLiquidityRouteExecutedEventDecoder()],
  ['AccountAuthorityChangedV3', sdk.ACCOUNT_AUTHORITY_CHANGED_EVENT_DISCRIMINATOR, sdk.getAccountAuthorityChangedEventDecoder()],
  ['AccountBackingChangedV3', sdk.ACCOUNT_BACKING_CHANGED_EVENT_DISCRIMINATOR, sdk.getAccountBackingChangedEventDecoder()],
  ['AccountCustodyChangedV3', sdk.ACCOUNT_CUSTODY_CHANGED_EVENT_DISCRIMINATOR, sdk.getAccountCustodyChangedEventDecoder()],
  ['AccountFinancialChangedV3', sdk.ACCOUNT_FINANCIAL_CHANGED_EVENT_DISCRIMINATOR, sdk.getAccountFinancialChangedEventDecoder()],
  ['AccountLiquidatedV3', sdk.ACCOUNT_LIQUIDATED_EVENT_DISCRIMINATOR, sdk.getAccountLiquidatedEventDecoder()],
  ['AccountMakerChangedV3', sdk.ACCOUNT_MAKER_CHANGED_EVENT_DISCRIMINATOR, sdk.getAccountMakerChangedEventDecoder()],
  ['AccountOracleChangedV3', sdk.ACCOUNT_ORACLE_CHANGED_EVENT_DISCRIMINATOR, sdk.getAccountOracleChangedEventDecoder()],
  ['AccountOrderChangedV3', sdk.ACCOUNT_ORDER_CHANGED_EVENT_DISCRIMINATOR, sdk.getAccountOrderChangedEventDecoder()],
  ['AccountQualificationV3', sdk.ACCOUNT_QUALIFICATION_EVENT_DISCRIMINATOR, sdk.getAccountQualificationEventDecoder()],
  ['AccountResolutionAppliedV3', sdk.ACCOUNT_RESOLUTION_APPLIED_EVENT_DISCRIMINATOR, sdk.getAccountResolutionAppliedEventDecoder()],
  ['AccountResolutionCompletedV3', sdk.ACCOUNT_RESOLUTION_COMPLETED_EVENT_DISCRIMINATOR, sdk.getAccountResolutionCompletedEventDecoder()],
  ['AccountResolutionFrozenV3', sdk.ACCOUNT_RESOLUTION_FROZEN_EVENT_DISCRIMINATOR, sdk.getAccountResolutionFrozenEventDecoder()],
  ['AccountResolutionOrderV3', sdk.ACCOUNT_RESOLUTION_ORDER_EVENT_DISCRIMINATOR, sdk.getAccountResolutionOrderEventDecoder()],
  ['AccountResolutionPlannedV3', sdk.ACCOUNT_RESOLUTION_PLANNED_EVENT_DISCRIMINATOR, sdk.getAccountResolutionPlannedEventDecoder()],
  ['AccountResolutionProgressV3', sdk.ACCOUNT_RESOLUTION_PROGRESS_EVENT_DISCRIMINATOR, sdk.getAccountResolutionProgressEventDecoder()],
  ['AccountResolutionProposalV3', sdk.ACCOUNT_RESOLUTION_PROPOSAL_EVENT_DISCRIMINATOR, sdk.getAccountResolutionProposalEventDecoder()],
  ['AccountResolutionRatesV3', sdk.ACCOUNT_RESOLUTION_RATES_EVENT_DISCRIMINATOR, sdk.getAccountResolutionRatesEventDecoder()],
  ['AccountResolutionRoundedV3', sdk.ACCOUNT_RESOLUTION_ROUNDED_EVENT_DISCRIMINATOR, sdk.getAccountResolutionRoundedEventDecoder()],
  ['AccountResolutionValuedV3', sdk.ACCOUNT_RESOLUTION_VALUED_EVENT_DISCRIMINATOR, sdk.getAccountResolutionValuedEventDecoder()],
  ['AccountRetirementProgressV3', sdk.ACCOUNT_RETIREMENT_PROGRESS_EVENT_DISCRIMINATOR, sdk.getAccountRetirementProgressEventDecoder()],
  ['AccountRouteExecutedV3', sdk.ACCOUNT_ROUTE_EXECUTED_EVENT_DISCRIMINATOR, sdk.getAccountRouteExecutedEventDecoder()],
  ['AccountSafetyRecoveryV3', sdk.ACCOUNT_SAFETY_RECOVERY_EVENT_DISCRIMINATOR, sdk.getAccountSafetyRecoveryEventDecoder()],
  ['AccountsRetiredV3', sdk.ACCOUNTS_RETIRED_EVENT_DISCRIMINATOR, sdk.getAccountsRetiredEventDecoder()],
  ['RetiredReserveWithdrawnV3', sdk.RETIRED_RESERVE_WITHDRAWN_EVENT_DISCRIMINATOR, sdk.getRetiredReserveWithdrawnEventDecoder()],
 ] as const;
export type AccountEvent = JournalEvent & {type: typeof decoders[number][0]};

/** Shared financial schemas do not imply interchangeable deployment profiles. */
export function decodeAccounts(signature: string, transaction: any, authority: string,
  venue: string, program: string = PROGRAM, profile: 3 | 4 = 3): AccountEvent[] {
  return eventPayloads(signature, transaction, authority, program).flatMap(({outer, inner, payload}) => {
    const entry = decoders.find(([, discriminator]) => payload.subarray(0,8).equals(Buffer.from(discriminator)));
    if (!entry) throw new Error('Unknown critical account event schema');
    const [type, , decoder] = entry;
    if (type.endsWith('V4') && profile !== 4 || profile === 4 &&
      ['AccountMakerChangedV3', 'AccountRouteExecutedV3'].includes(type)) throw new Error('Foreign account event profile');
    const [value, end] = decoder.read(payload, 0);
    if (end !== payload.length) throw new Error('Trailing account event bytes');
    const data = JSON.parse(json(value));
    if (BigInt(data.slot) !== BigInt(transaction.slot)) throw new Error('Account event slot mismatch');
    if (type === 'AccountCustodyChangedV3' && (data.schemaVersion !== 3 || data.profileVersion !== profile))
      throw new Error('Unsupported account event version');
    if (data.venue !== venue) return [];
    return [{signature, outer, inner, ordinal:0, slot:transaction.slot,
      blockTime:transaction.blockTime === null ? null : integer(transaction.blockTime), type, data, bytes:payload.toString('base64')}];
  });
}
