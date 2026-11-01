import * as sdk from '@rivalt/sdk';
import {eventPayloads, json, PROGRAM, type JournalEvent} from './events.js';
import {scopedInvocations, decodeTransition, type ScopedInvocation} from './scoped-events.js';
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
  ['AccountSafetyRecoveryV3', sdk.ACCOUNT_SAFETY_RECOVERY_EVENT_DISCRIMINATOR, sdk.getAccountSafetyRecoveryEventDecoder()],
  ['AccountsRetiredV3', sdk.ACCOUNTS_RETIRED_EVENT_DISCRIMINATOR, sdk.getAccountsRetiredEventDecoder()],
  ['RetiredReserveWithdrawnV3', sdk.RETIRED_RESERVE_WITHDRAWN_EVENT_DISCRIMINATOR, sdk.getRetiredReserveWithdrawnEventDecoder()],
 ] as const;
export type AccountEvent = JournalEvent & {type: typeof decoders[number][0]};

export type AccountInvocation = ScopedInvocation & {events:AccountEvent[]};

/** Inspection can derive a candidate domain from an emitted footer, but the
 * complete ancestry/privileges are authenticated again before returning it.
 * The persistent journal always supplies its immutable deployment binding. */
export function eventDomain(signature:string,transaction:any,authority:string,venue:string,program:string=PROGRAM) {
  const domains=new Set<string>();
  for(const {payload} of eventPayloads(signature,transaction,authority,program)) {
    if(!payload.subarray(0,8).equals(Buffer.from(sdk.ACCOUNT_TRANSITION_EVENT_DISCRIMINATOR)))continue;
    const footer=decodeTransition(payload);if(footer.venue===venue)domains.add(footer.domain);
  }
  if(domains.size!==1)throw new Error('Missing or conflicting deployment domain');
  return [...domains][0];
}
export function decodeAccountInvocations(signature:string,transaction:any,transactionIndex:number,
  binding:{program:string;eventAuthority:string;venue:string;domain:string}):AccountInvocation[] {
  return scopedInvocations(signature,transaction,transactionIndex,binding).map(invocation=>({
    ...invocation,events:invocation.payloads.map(({inner,bytes},ordinal)=>{
      const payload=Buffer.from(bytes,'base64');
      const entry=decoders.find(([,tag])=>payload.subarray(0,8).equals(Buffer.from(tag)));
      if(!entry)throw new Error('Unknown critical account event schema');
      const [type,,decoder]=entry,[value,end]=decoder.read(payload,0);
      if(end!==payload.length)throw new Error('Trailing account event bytes');
      const data=JSON.parse(json(value));
      if(BigInt(data.slot)!==invocation.slot||data.venue!==binding.venue)throw new Error('Account event slot/venue mismatch');
      if(type==='AccountCustodyChangedV3'&&(data.schemaVersion!==7||data.profileVersion!==4||data.domain!==binding.domain))
        throw new Error('Unsupported account event version/domain');
      return {signature,outer:invocation.outer,inner,ordinal,slot:transaction.slot,
        blockTime:transaction.blockTime===null?null:integer(transaction.blockTime),type,data,bytes};
    })
  }));
}
export function decodeAccounts(signature:string,transaction:any,authority:string,venue:string,
  program:string=PROGRAM,profile:4=4):AccountEvent[] {
  if(profile!==4)throw new Error('Unsupported account event profile');
  if(transaction?.meta?.err!==null) {
    if(!transaction?.meta||transaction.transaction?.signatures?.[0]!==signature||!Object.hasOwn(transaction.meta,'err'))
      throw new Error('Missing transaction metadata/identity');
    return [];
  }
  // Other venues have no effects in this view. Authentication remains mandatory
  // when any footer claims the requested deployment.
  const payloads=eventPayloads(signature,transaction,authority,program);
  if(!payloads.some(({payload})=>payload.subarray(0,8).equals(Buffer.from(sdk.ACCOUNT_TRANSITION_EVENT_DISCRIMINATOR))
    &&decodeTransition(payload).venue===venue))throw new Error('Missing scoped footer for deployment');
  return decodeAccountInvocations(signature,transaction,0,{program,eventAuthority:authority,venue,
    domain:eventDomain(signature,transaction,authority,venue,program)}).flatMap(invocation=>invocation.events);
}
