import * as paged from '@rivalt/sdk/paged-recovery';
import * as sdk from '@rivalt/sdk';
import {eventPayloads, json, PROGRAM, type JournalEvent} from './events.js';
import {scopedInvocations, decodeTransition, type ScopedInvocation} from './scoped-events.js';
import type {ScopedRetirement} from './scoped-history.js';
import {integer} from './rpc.js';

// Stable persisted journal/API tags retain their schema suffix; generated source
// names are canonical. Renaming a Rust event must not relabel stored originals.
const decoders = [
  ['ListedLiquiditySealed',sdk.LISTED_LIQUIDITY_SEALED_EVENT_DISCRIMINATOR,sdk.getListedLiquiditySealedEventDecoder()],
  ['ListedMakerAdmitted',sdk.LISTED_MAKER_ADMITTED_EVENT_DISCRIMINATOR,sdk.getListedMakerAdmittedEventDecoder()],
  ['ListingIndexChanged',sdk.LISTING_INDEX_CHANGED_EVENT_DISCRIMINATOR,sdk.getListingIndexChangedEventDecoder()],
  ['MarketListingRegistered',sdk.MARKET_LISTING_REGISTERED_EVENT_DISCRIMINATOR,sdk.getMarketListingRegisteredEventDecoder()],
  ['MakerFillContinuation',sdk.MAKER_FILL_CONTINUATION_EVENT_DISCRIMINATOR,sdk.getMakerFillContinuationEventDecoder()],
  ['JointClaimsCopied',sdk.JOINT_CLAIMS_COPIED_EVENT_DISCRIMINATOR,sdk.getJointClaimsCopiedEventDecoder()],
  ['PagedRecoverySelectionBound',paged.PAGED_RECOVERY_SELECTION_BOUND_EVENT_DISCRIMINATOR,paged.getPagedRecoverySelectionBoundEventDecoder()],
  ['RecoverySelectionBound',sdk.RECOVERY_SELECTION_BOUND_EVENT_DISCRIMINATOR,sdk.getRecoverySelectionBoundEventDecoder()],
  ['MultiLotBookVerified',sdk.MULTI_LOT_BOOK_VERIFIED_EVENT_DISCRIMINATOR,sdk.getMultiLotBookVerifiedEventDecoder()],
  ['InventoryBookVerified',sdk.INVENTORY_BOOK_VERIFIED_EVENT_DISCRIMINATOR,sdk.getInventoryBookVerifiedEventDecoder()],
  ['SharedInventoryVerified',sdk.SHARED_INVENTORY_VERIFIED_EVENT_DISCRIMINATOR,sdk.getSharedInventoryVerifiedEventDecoder()],
  ['ForeignCreditorsVerified',sdk.FOREIGN_CREDITORS_VERIFIED_EVENT_DISCRIMINATOR,sdk.getForeignCreditorsVerifiedEventDecoder()],
  ['FrozenJointReductionVerified',sdk.FROZEN_JOINT_REDUCTION_VERIFIED_EVENT_DISCRIMINATOR,sdk.getFrozenJointReductionVerifiedEventDecoder()],
  ['FrozenLinkedAllocationRow',sdk.FROZEN_LINKED_ALLOCATION_ROW_EVENT_DISCRIMINATOR,sdk.getFrozenLinkedAllocationRowEventDecoder()],
  ['FrozenBtcAllocationRow',sdk.FROZEN_BTC_ALLOCATION_ROW_EVENT_DISCRIMINATOR,sdk.getFrozenBtcAllocationRowEventDecoder()],
  ['FrozenBtcReductionVerified',sdk.FROZEN_BTC_REDUCTION_VERIFIED_EVENT_DISCRIMINATOR,sdk.getFrozenBtcReductionVerifiedEventDecoder()],
  ['FrozenPairVerified',sdk.FROZEN_PAIR_VERIFIED_EVENT_DISCRIMINATOR,sdk.getFrozenPairVerifiedEventDecoder()],
  ['MarginMembershipChanged', sdk.MARGIN_MEMBERSHIP_CHANGED_EVENT_DISCRIMINATOR, sdk.getMarginMembershipChangedEventDecoder()],
  ['RecoveryStorageRefunded', sdk.RECOVERY_STORAGE_REFUNDED_EVENT_DISCRIMINATOR, sdk.getRecoveryStorageRefundedEventDecoder()],
  ['IndexedSettlementBound',sdk.INDEXED_SETTLEMENT_BOUND_EVENT_DISCRIMINATOR,sdk.getIndexedSettlementBoundEventDecoder()],
  ['SettlementPlanProgress', sdk.SETTLEMENT_PLAN_PROGRESS_EVENT_DISCRIMINATOR, sdk.getSettlementPlanProgressEventDecoder()],
  ['SettlementMarginApplied', sdk.SETTLEMENT_MARGIN_APPLIED_EVENT_DISCRIMINATOR, sdk.getSettlementMarginAppliedEventDecoder()],
  ['LiquidityRegistryChangedV4', sdk.LIQUIDITY_REGISTRY_CHANGED_EVENT_DISCRIMINATOR, sdk.getLiquidityRegistryChangedEventDecoder()],
  ['LiquidityMakerChangedV4', sdk.LIQUIDITY_MAKER_CHANGED_EVENT_DISCRIMINATOR, sdk.getLiquidityMakerChangedEventDecoder()],
  ['FundingPublisherChangedV4', sdk.FUNDING_PUBLISHER_CHANGED_EVENT_DISCRIMINATOR, sdk.getFundingPublisherChangedEventDecoder()],
  ['FundingReportAcceptedV4', sdk.FUNDING_REPORT_ACCEPTED_EVENT_DISCRIMINATOR, sdk.getFundingReportAcceptedEventDecoder()],
  ['LiquidityRouteFeeRecorded', sdk.LIQUIDITY_ROUTE_FEE_RECORDED_EVENT_DISCRIMINATOR, sdk.getLiquidityRouteFeeRecordedEventDecoder()],
  ['MarketCheckpointed',sdk.MARKET_CHECKPOINTED_EVENT_DISCRIMINATOR,sdk.getMarketCheckpointedEventDecoder()],
  ['LedgerLaneFilled',sdk.LEDGER_LANE_FILLED_EVENT_DISCRIMINATOR,sdk.getLedgerLaneFilledEventDecoder()],
  ['MarketLaneFilled',sdk.MARKET_LANE_FILLED_EVENT_DISCRIMINATOR,sdk.getMarketLaneFilledEventDecoder()],
  ['MarketFeesClassified', sdk.MARKET_FEES_CLASSIFIED_EVENT_DISCRIMINATOR, sdk.getMarketFeesClassifiedEventDecoder()],
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
  binding:{program:string;eventAuthority:string;venue:string;domain:string;artifactSet?:string}):AccountInvocation[] {
  return scopedInvocations(signature,transaction,transactionIndex,{...binding,indexedDefault:binding.artifactSet===sdk.INDEXED_DEFAULT_ARTIFACT_SET||binding.artifactSet===sdk.INDEXED_APPLICATION_ARTIFACT_SET||binding.artifactSet===sdk.LISTED_DIRECTORY_ARTIFACT_SET,verifiedCoverage:sdk.hasDirectCredit(binding.artifactSet)||binding.artifactSet===sdk.VERIFIED_COVERAGE_ARTIFACT_SET,shadowCoverage:binding.artifactSet===sdk.SHADOW_COVERAGE_ARTIFACT_SET||binding.artifactSet===sdk.MAINTAINED_COVERAGE_ARTIFACT_SET}).map(invocation=>{
    const events:AccountEvent[]=invocation.payloads.map(({inner,bytes},ordinal)=>{
      const payload=Buffer.from(bytes,'base64');
      const entry=decoders.find(([,tag])=>payload.subarray(0,8).equals(Buffer.from(tag)));
      if(!entry)throw new Error('Unknown critical account event schema');
      const [type,,decoder]=entry,[value,end]=decoder.read(payload,0);
      if(end!==payload.length)throw new Error('Trailing account event bytes');
      const data=JSON.parse(json(value));
      if(BigInt(data.slot)!==invocation.slot||data.venue!==binding.venue)throw new Error('Account event slot/venue mismatch');
      if(type==='AccountCustodyChangedV3'&&(data.schemaVersion!==10||data.profileVersion!==6||data.domain!==binding.domain))
        throw new Error('Unsupported account event version/domain');
      return {signature,outer:invocation.outer,inner,ordinal,slot:transaction.slot,
        blockTime:transaction.blockTime===null?null:integer(transaction.blockTime),type,data,bytes};
    });
    const continuations=events.filter(event=>event.type==='MakerFillContinuation');
    if(continuations.length) {
      const first=events[0], trade=first.data;
      if(invocation.instruction!==sdk.hex(sdk.EXECUTE_MULTI_ROUTE_DISCRIMINATOR) ||
        first.type!=='LiquidityRouteFeeRecorded' || events.length!==1+continuations.length || continuations.length>2 ||
        trade.legs.length!==2 || trade.rootStates.length!==3 || trade.makerStates.length!==2)
        throw new Error('Invalid multi-maker receipt header');
      for(const [index,continuation] of continuations.entries()) {
        const part=continuation.data;
        if(continuation.ordinal!==index+1 || part.nonce!==trade.nonce || part.market!==trade.market ||
          part.firstLeg!==trade.legs.length || part.legs.length<1 || part.legs.length>3 ||
          index+1<continuations.length && part.legs.length!==3 ||
          part.rootStates.length!==part.legs.length || part.makerStates.length!==part.legs.length)
          throw new Error('Discontinuous multi-maker receipt');
        trade.legs.push(...part.legs);
        trade.rootStates.push(...part.rootStates);
        trade.makerStates.push(...part.makerStates);
      }
    }
    const retirements:ScopedRetirement[]=[];
    for(const write of invocation.writes) {
      if(write.kind===26) {
        const change=events.filter(event=>event.type==='MarginMembershipChanged'&&event.data.margin===write.account&&event.data.lifecycle===3);
        if(invocation.instruction!==sdk.hex(sdk.RETIRE_MARGIN_DISCRIMINATOR)||change.length!==1||write.before==='0')
          throw new Error('Unproven margin retirement kind transition');
        retirements.push({account:write.account,from:5,to:26});
      } else if(write.kind===27) {
        const change=events.filter(event=>event.type==='RecoveryStorageRefunded'&&event.data.allocation===write.account);
        if(invocation.instruction!==sdk.hex(sdk.REFUND_RECOVERY_ALLOCATION_DISCRIMINATOR)||change.length!==1||write.before==='0'
          ||![17,18,21,22,23].includes(change[0].data.originalKind))throw new Error('Unproven storage retirement kind transition');
        retirements.push({account:write.account,from:change[0].data.originalKind,to:27});
      }
    }
    return {...invocation,events,retirements};
  });
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
