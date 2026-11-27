import * as sdk from '@rivalt/sdk';
import {projectSettlement, type PagedSettlement} from './settlement-projection.js';
import type {Canonical} from './canonical.js';
import {json} from './events.js';
import type {RevisionVector} from './scoped-history.js';
import type {AccountEvent} from './account-events.js';
import {projectLiquidity, type LiquidityState} from './liquidity-projection.js';

type Fields<T> = Canonical<Omit<T, 'discriminator' | 'bump' | 'vaultBump'>>;
export type AccountRoot = Fields<sdk.MarginAccount>;
export type AccountMarket = Fields<sdk.Market>;
type Row = {member:string; cashBefore:string; lots:string[]; generations:string[]; claimsScaled:string[];
  collected:string; originalRevision?:string; activationGeneration?:string; flows?:string[]; cashAfter?:string; applied?:boolean};
export type AccountResolution = {
  epoch:string; stage:number; cursor:string; count:string; registryHash:string; membershipEpoch:string;
  safetyEpoch:string; termsEpoch:string; configEpochs:string[]; sourceObservations:string[]; sourceDeadlines:string[];
  prices:string[]; funding:string[]; frozenAt:string; cashBefore:string; poolsBefore:string[];
  insuranceBefore:string[]; feesBefore:string[]; allocatedBefore:string; budgets:string[]; insuranceSpent:string[];
  inventoryBook?:{multiLot?:boolean;digest:string;total:string;capacities:string[][];pairs:string[][]};
  sharedInventory?:{members:string[];charges:string[];eligible:string[];prices:string[]};
  jointPayment?:{payment:string;chargeAtoms:string[];insuranceSpent:string[];memberIds:string[];deltas:string[][]};
  boundRecovery?:{search:string;schedule:string;schedulesChecked:string;chargeAtoms:string[];insuranceSpent:string[];memberIds:string[];claimDeltas:string[][];movements:string[][];finalCash:string[]};
  foreignCreditors?:{members:string[];charges:string[];eligible:string[];matchedLots:string[];basePrices:string[];extraTickLots:string[]};
  linkedAllocation?:{attempt:string;debtorId:string;shares:string[];targets:string[];cursor:string;recovered:string[];status:number;charges:Record<string,string[]>};
  allocation?:{attempt:string;debtorId:string;shortfall:string;cursor:string;recovered:string;capacity:string;status:number;charges:Record<string,string>};
  joint?:{debtorId:string;winners:string[];shares:string[];charges:string[];eligible:string[];matchedLots:string[];basePrices:string[];extraTickLots:string[]};
  pair?:{debtorId:string;winnerId:string;charge:string;price:string;unpaidGainCap:string;matchedLots?:string;extraTickLots?:string};
  evaluation:number; clippedMask:number; rows:Record<string,Row>; remainingCash:string; appliedCash:string;
  remainingLots:string[]; remainingGross:string[]; remainingClaims:string[];
};
export type AccountState = {
  /** Local durable payload cursor, never an on-chain ordering proof. */
  sequence:string; revisions:RevisionVector; venue:Fields<sdk.Venue>|null; custody:Fields<sdk.Custody>|null; safety:Fields<sdk.VenueSafety>|null;
  membershipVersion:string|null; registeredCount:string; nextMemberId:string;
  identities:Record<string,string>; tombstones:Record<string,Fields<sdk.MarginTombstone>>;
  storageTombstones:Record<string,Fields<sdk.StorageTombstone>>; members:string[]; portfolios:Record<string,Fields<sdk.Portfolio>>;
  roots:Record<string,AccountRoot>; markets:Record<string,AccountMarket>;
  listings?:Record<string,Fields<sdk.MarketListing>>;
  listedFunding?:Record<string,Fields<sdk.ListedFunding>>;
  listingIndices?:Record<string,Fields<sdk.ListingIndex>>;
  listedSymbols?:Record<string,Fields<sdk.ListedSymbol>>;
  ledgers:Record<string,Fields<sdk.MarketLedger>>;
  backing:Record<string,Fields<sdk.SettlementCertificate>>;
  retirement:Fields<sdk.RetirementCertificate>|null; resolution:AccountResolution|null;
  liquidity?:LiquidityState;
  pagedSettlement?:PagedSettlement;
};
export const emptyAccounts = ():AccountState => ({sequence:'0',revisions:{},venue:null,custody:null,safety:null,membershipVersion:null,
  registeredCount:'0',nextMemberId:'0',identities:{},tombstones:{},storageTombstones:{},members:[],portfolios:{},roots:{},markets:{},ledgers:{},backing:{},retirement:null,resolution:null});
export const accountFields = <T>(value:T):Fields<T> => {
  const {discriminator,bump,vaultBump,...fields}=JSON.parse(json(value)); return fields;
};
const blank = <T>(decoder:{fixedSize:number;decode(bytes:Uint8Array):T}) => accountFields(decoder.decode(new Uint8Array(decoder.fixedSize)));
export function accountCheck(condition:unknown, reason:string):asserts condition {
  if (!condition) throw new Error(`Account projection: ${reason}`);
}
export function present<T>(value:T|null|undefined, reason:string):T {
  accountCheck(value != null, `missing ${reason}`); return value;
}
const equal = (left:unknown,right:unknown,reason:string) => accountCheck(json(left)===json(right),reason);
const pick = (value:any, fields:readonly string[]) => Object.fromEntries(fields.map(field=>[field,value[field]]));
const venueFields=['schemaVersion','profileVersion','domain','authority','feeAuthority','reserveAuthority','reserveDestinationOwner',
  'quoteMint','vault','markets','marketCount','termsEpoch','configEpoch','insuranceFeeShareBps'] as const;
const rootIdentity=['schemaVersion','venue','portfolio','owner','subaccountIndex','id','mode','isolatedMarketIndex','role','lifecycle','activationGeneration'] as const;
const scale=1_000_000_000n;
const abs=(value:bigint)=>value<0n?-value:value;

/** Only event fields are authoritative here. Canonical PDAs and complete decoded
 * financial accounts are checked separately against finalized RPC bytes. */
export function projectAccounts(state:AccountState,event:AccountEvent,venue:string,domain:string,profile:4=4,artifactSet?:string) {
  accountCheck(profile===4&&!!state.liquidity,'explicit projection profile');
  const change=structuredClone(event.data);
  accountCheck(change.venue===venue,'event venue');
  const currentVenue=()=>present(state.venue,'venue');
  const custody=()=>present(state.custody,'custody');
  const safety=()=>present(state.safety,'safety');
  const resolution=()=>{const value=present(state.resolution,'resolution');equal(value.epoch,change.epoch,'resolution epoch');return value;};
  const market=(value:any,key?:string)=>{
    const canonical=currentVenue().markets[value.index];
    accountCheck(value.schemaVersion===10 && value.venue===venue && [0,1].includes(value.index),'market identity');
    accountCheck(!key||key===canonical,'market key');
    const previous=present(state.markets[canonical],'market');
    equal(pick(value,['symbol','lotsPerUnit','crossEligible']),pick(previous,['symbol','lotsPerUnit','crossEligible']),'immutable market');
    state.markets[canonical]=accountFields<sdk.Market>(value);
  };
  const root=(value:any,key?:string)=>{
    const canonical=state.identities[value.id],previous=present(state.roots[canonical],'root');
    accountCheck(!key||key===canonical,'root key');
    equal(pick(value,rootIdentity),pick(previous,rootIdentity),'immutable root identity');
    state.roots[canonical]=accountFields<sdk.MarginAccount>(value);
  };
  const ledger=(value:any)=>{
    accountCheck([0,1].includes(value.marketIndex)&&currentVenue().markets[value.marketIndex]===value.market,'ledger market');
    const {ledger:key,...fields}=value;
    state.ledgers[key]={schemaVersion:10,revision:state.ledgers[key]?.revision??'0',venue,...fields};
  };
  const partialLedgers=(values:any[])=>{
    accountCheck(Array.isArray(values)&&values.length<=2
      &&values.every((value,index)=>[0,1].includes(value.marketIndex)&&(index===0||values[index-1].marketIndex<value.marketIndex)),
      'bounded ordered partial ledger snapshots');
    values.forEach(ledger);
  };
  const partialMarkets=(values:any[])=>{
    accountCheck(Array.isArray(values)&&values.length<=2
      &&values.every((value,index)=>[0,1].includes(value.index)&&(index===0||values[index-1].index<value.index)),
      'bounded ordered partial market snapshots');
    values.forEach(value=>market(value));
  };
  switch(event.type) {
    case 'ListedFundingChanged': {
      const listing=present(state.listings?.[change.listing],'funding listing');
      const liquidity=present(state.liquidity,'liquidity');
      const index=present(Object.values(state.listingIndices??{}).find(value=>value.listing===change.listing),'listed sources');
      const configuration=change.publisher, values=change.values;
      const previous=liquidity.publishers[change.configuration];
      state.listedFunding??={};
      const prior=state.listedFunding[change.funding];
      accountCheck(artifactSet===sdk.LISTED_FUNDING_ARTIFACT_SET && listing.status===1 && configuration.schemaVersion===10
        && configuration.venue===venue && configuration.market===change.listing && configuration.revision===(previous?.revision??'0')
        && Object.values(liquidity.registries).some(value=>value.market===change.listing && value.sealed)
        && !!previous===!!prior && values.fundingIndexScaled==='0' && values.oracle.coveredSeconds==='0','inactive listed funding state');
      equal(values.oracle.sources,index.sources,'immutable listed funding sources');
      const sequence=BigInt(previous?.lastSequence??'0'),epoch=BigInt(previous?.authorityEpoch??'0');
      const report=change.report.__option==='Some'?change.report.value:null;
      if(report) {
        accountCheck(previous?.enabled && configuration.publisher===previous.publisher && configuration.enabled
          && BigInt(configuration.authorityEpoch)===epoch && report.authorityEpoch===previous.authorityEpoch
          && report.version===1 && report.domain===domain && report.market===change.listing
          && BigInt(configuration.lastSequence)===sequence+1n && report.sequence===configuration.lastSequence
          && report.expectedObservationSequence===prior?.values.observationSequence
          && values.fundingTime===values.oracle.sampledAt && report.expectedConfigEpoch==='1' && report.expectedTermsEpoch==='1'
          && configuration.lastObservedSlot===report.observedSlot && BigInt(report.observedSlot)>BigInt(previous.lastObservedSlot)
          && configuration.lastObservedTime===report.observedTime && BigInt(report.observedTime)>=BigInt(previous.lastObservedTime)
          && (report.outcome!==0 || (values.referencePrice===report.referencePrice && values.oracle.quantity===report.quantity
            && values.oracle.bid===report.bid && values.oracle.ask===report.ask)),'attested listed funding report');
        liquidity.reports[change.listing]={publisher:configuration.publisher,slot:String(event.slot),report:accountFields<sdk.FundingReport>(report)};
      } else {
        accountCheck(BigInt(configuration.authorityEpoch)===epoch+1n && BigInt(configuration.lastSequence)===sequence
          && configuration.lastObservedSlot===change.slot && values.oracle.quantity==='0','listed publisher control');
      }
      accountCheck(BigInt(values.observationSequence)===(prior?BigInt(prior.values.observationSequence)+1n:0n),'listed observation sequence');
      state.listedFunding[change.funding]={schemaVersion:1,revision:prior?.revision??'0',listing:change.listing,values};
      liquidity.publishers[change.configuration]=accountFields<sdk.FundingPublisher>(configuration);
      break;
    }
    case 'ListedLiquiditySealed': {
      const listing=present(state.listings?.[change.listing],'listed market');
      const liquidity=present(state.liquidity,'liquidity');
      const directory=change.state;
      const members=Object.entries(liquidity.makers).filter(([,maker])=>maker.market===change.listing)
        .sort(([,left],[,right])=>left.instance-right.instance);
      accountCheck(sdk.hasListedDirectory(artifactSet) && listing.status===0 && directory.venue===venue
        && directory.market===change.listing && directory.schemaVersion===10 && directory.sealed===true
        && !liquidity.registries[change.registry] && directory.count===members.length && members.length===3
        && members.every(([key,maker],index)=>maker.instance===index && key===directory.registrations[index])
        && new Set(members.map(([,maker])=>maker.capital)).size===members.length
        && new Set(members.map(([,maker])=>maker.pricingProgram)).size===2,'complete listed maker directory');
      liquidity.registries[change.registry]=accountFields<sdk.LiquidityRegistry>(directory);
      listing.status=1;
      break;
    }
    case 'ListedMakerAdmitted': {
      const maker=change.state,liquidity=present(state.liquidity,'liquidity');
      const capital=present(state.roots[maker.capital],'listed maker capital');
      accountCheck(sdk.hasListedMaker(artifactSet) && state.listings?.[maker.market]?.status===0
        && maker.venue===venue && maker.schemaVersion===10 && sdk.isListedMakerCapital(capital)
        && capital.lifecycle===2 && BigInt(capital.cash)>0n && capital.owner===maker.owner
        && state.revisions[change.capitalBinding]?.kind===8 && state.revisions[change.registration]?.kind===15
        && !liquidity.makers[change.registration] && !Object.values(liquidity.makers).some(previous=>previous.capital===maker.capital)
        && [sdk.makerA.MAKER_A_PROGRAM_ADDRESS,sdk.makerB.MAKER_B_PROGRAM_ADDRESS].includes(maker.pricingProgram)
        && maker.authorityEpoch==='1' && maker.depthEpoch==='1' && maker.buyConsumed==='0' && maker.sellConsumed==='0'
        && !maker.quarantined,'listed maker admission');
      liquidity.makers[change.registration]=accountFields<sdk.MakerRegistration>(maker);
      break;
    }
    case 'ListingIndexChanged': {
      const listing=state.listings?.[change.listing];
      accountCheck((artifactSet===sdk.LISTING_INDEX_ARTIFACT_SET || sdk.hasListedMaker(artifactSet)) && listing && (listing.status===0 || (listing.status===1 && sdk.hasListedDirectory(artifactSet))) &&
        change.sources[0]===listing.oracleFeed && new Set(change.sources).size===4,'listed index sources');
      state.listingIndices??={};
      const previous=state.listingIndices[change.index];
      if(previous) {
        equal(previous.listing,change.listing,'index listing');
        equal(previous.sources,change.sources,'immutable listing sources');
        accountCheck(BigInt(change.sampledAt)>BigInt(previous.sampledAt) &&
          BigInt(change.deadline)>BigInt(change.sampledAt) && BigInt(change.lower)>0n &&
          BigInt(change.lower)<=BigInt(change.reference) && BigInt(change.reference)<=BigInt(change.upper) &&
          change.sourceSequences.every((seq:string,i:number)=>BigInt(seq)>0n && BigInt(seq)>=BigInt(previous.sourceSequences[i])) &&
          change.sourceSequences.some((seq:string,i:number)=>seq!==previous.sourceSequences[i]),'qualified listing observation');
      } else {
        accountCheck([change.sampledAt,change.deadline,change.reference,change.lower,change.upper,...change.sourceSequences]
          .every(value=>value==='0'),'empty listing index at binding');
      }
      state.listingIndices[change.index]={schemaVersion:1,revision:previous?.revision??'0',listing:change.listing,
        sources:change.sources,sourceSequences:change.sourceSequences,sampledAt:change.sampledAt,deadline:change.deadline,
        reference:change.reference,lower:change.lower,upper:change.upper};
      break;
    }
    case 'MarketListingRegistered': {
      accountCheck((artifactSet===sdk.INACTIVE_LISTING_ARTIFACT_SET || artifactSet===sdk.LISTING_INDEX_ARTIFACT_SET || sdk.hasListedMaker(artifactSet)) && change.status===0 &&
        change.marketId>=2 && change.quoteMint===currentVenue().quoteMint && BigInt(change.lotsPerUnit)>0n,
        'inactive market listing identity');
      state.listings??={};
      state.listedSymbols??={};
      accountCheck(!state.listings[change.listing] && !state.listedSymbols[change.symbolBinding], 'duplicate market listing');
      const header={schemaVersion:1,revision:'0'};
      state.listings[change.listing]={...header,venue,marketId:change.marketId,symbol:change.symbol,
        lotsPerUnit:change.lotsPerUnit,quoteMint:change.quoteMint,oraclePublisher:change.oraclePublisher,
        oracleFeed:change.oracleFeed,status:change.status};
      state.listedSymbols[change.symbolBinding]={...header,listing:change.listing};
      break;
    }
    case 'MakerFillContinuation':
      // The invocation decoder joins these maker entries onto the first receipt.
      accountCheck(sdk.hasMultiMaker(artifactSet),'multi-maker deployment');
      break;
    case 'AccountCustodyChangedV3': {
      accountCheck(change.schemaVersion===10&&change.profileVersion===sdk.ACCOUNT_PROFILE&&change.domain===domain,'custody version/domain');
      accountCheck(Number.isInteger(change.kind)&&change.kind>=0&&change.kind<=10,'custody kind');
      if(change.kind===0) {
        accountCheck(!state.venue&&state.sequence==='0','duplicate initialization');
        state.safety={schemaVersion:10,revision:'0',venue,mode:0,paused:false,epoch:'1',resolutionEpoch:'0',recoverySince:'0',recoveryLast:'0'};
        state.custody={schemaVersion:10,revision:'0',venue,allocatedVault:'0'};
      } else {
        const immutable=['domain','authority','feeAuthority','reserveAuthority','reserveDestinationOwner','quoteMint','vault','insuranceFeeShareBps'];
        equal(pick(currentVenue(),immutable),pick(change,immutable),'immutable venue');
      }
      state.venue={...pick(change,venueFields),revision:state.venue?.revision??'0'} as Fields<sdk.Venue>;
      if(change.allocatedVault.__option==='Some')custody().allocatedVault=change.allocatedVault.value;
      Object.assign(safety(),{mode:change.mode,paused:change.paused,epoch:change.safetyEpoch});
      if(change.membershipVersion.__option==='Some')state.membershipVersion=change.membershipVersion.value;
      if(change.kind===1) {
        accountCheck(!state.markets[change.subject]&&[0,1].includes(change.index),'market registration');
        equal(currentVenue().markets[change.index],change.subject,'registered market');
        const symbol=Buffer.alloc(8);symbol.write(change.index===0?'BTC':'ETH');
        state.markets[change.subject]={...blank(sdk.getMarketDecoder()),schemaVersion:10,venue,index:change.index,
          symbol:symbol.toString('hex'),lotsPerUnit:change.index===0?'1000000':'100000',crossEligible:true,termsEpoch:'1',configEpoch:'1'};
      }
      if(change.kind===2) {
        accountCheck(!state.portfolios[change.subject]&&change.index>=0&&change.index<4,'portfolio registration');
        state.portfolios[change.subject]={schemaVersion:10,revision:'0',venue,owner:change.actor,index:change.index,activeChildren:0};
      }
      accountCheck(change.members.length<=2&&new Set(change.members.map((member:any)=>member.margin)).size===change.members.length,'custody member shape');
      for(const member of change.members) {
        const {margin,...identity}=member;
        if(change.kind===3) {
          const portfolio=present(state.portfolios[member.portfolio],'portfolio');
          accountCheck(member.id===state.nextMemberId&&!state.identities[member.id]&&margin===change.subject&&!state.roots[margin],'stable root ID');
          if(sdk.isListedMakerCapital(member)) accountCheck(sdk.hasListedMaker(artifactSet),'listed maker deployment');
          accountCheck(member.owner===portfolio.owner&&member.subaccountIndex<=8&&member.lifecycle===1&&member.activationGeneration==='0'
            &&!Object.values(state.roots).some(root=>root.portfolio===member.portfolio&&root.subaccountIndex===member.subaccountIndex),'child identity');
          portfolio.activeChildren++;
          state.identities[member.id]=margin;
          state.nextMemberId=(BigInt(state.nextMemberId)+1n).toString();
          state.registeredCount=(BigInt(state.registeredCount)+1n).toString();
          state.roots[margin]={...blank(sdk.getMarginAccountDecoder()),...identity,schemaVersion:10,venue,delegateEpoch:'1'};
        } else {
          const previous=present(state.roots[margin],'custody root');
          equal(pick(previous,rootIdentity.slice(2)),pick(member,rootIdentity.slice(2)),'immutable custody root');
          previous.cash=member.cash;previous.stateVersion=member.stateVersion;
        }
      }
      if(change.memberCount.__option==='Some')equal(change.memberCount.value,String(state.members.length),'complete financial count');
      if(change.registeredCount.__option==='Some')equal(change.registeredCount.value,state.registeredCount,'registered count');
      if(change.nextMemberId.__option==='Some')equal(change.nextMemberId.value,state.nextMemberId,'monotone identity cursor');
      partialLedgers(change.ledgers);
      break;
    }
    case 'MarginMembershipChanged': {
      const previous=present(state.roots[change.margin],'membership root');
      equal([change.id,change.portfolio,change.owner],[previous.id,previous.portfolio,previous.owner],'membership identity');
      accountCheck(previous.cash==='0'&&previous.reserved==='0'&&previous.positions.every(position=>position.lots==='0'&&position.virtualScaled==='0')
        &&previous.book.orders.every(({order})=>![1,2].includes(order.state)&&order.reserve==='0')
        &&previous.book.protections.every(pair=>pair.protection.remaining==='0')&&previous.delegate==='11111111111111111111111111111111'
        &&previous.delegateExpirySlot==='0','empty lifecycle root');
      accountCheck(previous.lifecycle===1&&[2,3].includes(change.lifecycle)||previous.lifecycle===2&&change.lifecycle===1,'legal lifecycle transition');
      for(const counter of ['nonce','stateVersion','delegateEpoch'])equal(BigInt(change[counter]),BigInt(previous[counter as keyof typeof previous] as string)+1n,'lifecycle replay counter');
      equal(BigInt(change.activationGeneration),BigInt(previous.activationGeneration)+(change.lifecycle===2?1n:0n),'activation generation');
      equal(BigInt(change.membershipEpoch),BigInt(present(state.membershipVersion,'membership epoch'))+(change.lifecycle===3?0n:1n),'financial membership epoch');
      if(change.lifecycle===2)state.members.push(change.margin);
      else if(change.lifecycle===1) {
        accountCheck(state.members.includes(change.margin),'exiting financial member');
        state.members=state.members.filter(key=>key!==change.margin);
      } else {
        state.tombstones[change.margin]={schemaVersion:10,revision:previous.revision,venue,portfolio:previous.portfolio,owner:previous.owner,
          child:previous.subaccountIndex,id:previous.id,activationGeneration:previous.activationGeneration};
        delete state.roots[change.margin];
        const portfolio=present(state.portfolios[previous.portfolio],'retiring portfolio');
        accountCheck(portfolio.activeChildren>0,'active child underflow');portfolio.activeChildren--;
        state.registeredCount=(BigInt(state.registeredCount)-1n).toString();
      }
      if(change.lifecycle!==3)Object.assign(previous,pick(change,['lifecycle','activationGeneration','nonce','stateVersion','delegateEpoch']));
      state.members.sort((left,right)=>BigInt(state.roots[left].id)<BigInt(state.roots[right].id)?-1:1);
      state.membershipVersion=change.membershipEpoch;
      equal(change.registeredCount,state.registeredCount,'remaining registered count');equal(change.financialCount,String(state.members.length),'remaining financial count');
      equal(change.nextId,state.nextMemberId,'identity cursor');break;
    }
    case 'RecoveryStorageRefunded': {
      accountCheck(safety().mode===4&&!safety().paused,'terminal workspace refund');
      const revision=present(state.revisions[change.allocation],'refund revision');
      accountCheck(revision.kind===27&&[17,18,21,22,23].includes(change.originalKind)&&!state.storageTombstones[change.allocation],'once-only workspace refund');
      state.storageTombstones[change.allocation]={schemaVersion:10,revision:revision.revision,venue,originalKind:change.originalKind,completedEpoch:change.completedEpoch,register:change.register,pageIndex:change.pageIndex};
      break;
    }
    case 'AccountOracleChangedV3':market(change.state,change.market);break;
    case 'AccountAuthorityChangedV3':root(change.state,change.margin);break;
    case 'AccountOrderChangedV3':
      root(change.state,change.margin);partialMarkets(change.markets);break;
    case 'AccountQualificationV3':
      safety().mode=1;safety().epoch=change.safetyEpoch;change.markets.forEach((value:any)=>market(value));break;
    case 'AccountFinancialChangedV3':
      accountCheck([0,1,2,3,4,5,6].includes(change.kind)&&change.roots.length===change.rootStates.length,'financial shape');
      change.rootStates.forEach((value:any,index:number)=>root(value,change.roots[index]));
      partialMarkets(change.markets);partialLedgers(change.ledgers);
      accountCheck((change.allocatedVault.__option==='Some')===[0,6].includes(change.kind)
        && change.allocatedVault.__option===change.actualVault.__option,'financial token scope');
      if(change.allocatedVault.__option==='Some')custody().allocatedVault=change.allocatedVault.value;equal(safety().epoch,change.safetyEpoch,'financial safety epoch');break;
    case 'AccountBackingChangedV3':
      accountCheck(change.state.schemaVersion===10&&change.state.venue===venue,'backing identity');
      // BackingSnapshot intentionally omits the journal revision. The enclosing
      // authenticated footer supplies its predecessor, including initialization.
      accountCheck(state.revisions[change.certificate]?.kind===9,'backing revision identity');
      state.backing[change.certificate]={...accountFields<sdk.SettlementCertificate>(change.state),
        revision:state.revisions[change.certificate].revision};
      accountCheck(change.margin.__option===change.rootState.__option,'backing root option pair');
      if(change.ledger.__option==='Some')partialLedgers([change.ledger.value]);
      if(change.margin.__option==='Some') {
        accountCheck(change.ledger.__option==='Some','backing root requires summary');
        root(change.rootState.value,change.margin.value);
      }
      break;
    case 'AccountLiquidatedV3':
      accountCheck(change.target!==change.receiver&&BigInt(change.deficitAfter)<BigInt(change.deficitBefore),'liquidation progress');
      root(change.targetState,change.target);root(change.receiverState,change.receiver);
      partialMarkets(change.markets);partialLedgers(change.ledgers);
      equal(safety().epoch,change.safetyEpoch,'liquidation safety');break;
    case 'MultiLotBookVerified':
    case 'InventoryBookVerified':
    case 'SharedInventoryVerified':
    case 'IndexedSettlementBound':
    case 'JointClaimsCopied':
    case 'PagedRecoverySelectionBound':
    case 'RecoverySelectionBound':
    case 'ForeignCreditorsVerified':
    case 'FrozenJointReductionVerified':
    case 'FrozenLinkedAllocationRow':
    case 'FrozenBtcAllocationRow':
    case 'FrozenBtcReductionVerified':
    case 'FrozenPairVerified':
    case 'SettlementPlanProgress':
    case 'SettlementMarginApplied':projectSettlement(state,event,root,artifactSet);break;
    case 'AccountResolutionFrozenV3': {
      delete state.pagedSettlement;
      const previous=state.resolution;
      if(previous && previous.epoch===change.epoch)accountCheck(previous.stage===1&&change.stage===2,'frozen valuation continuation');
      else equal(BigInt(change.epoch),BigInt(safety().resolutionEpoch)+1n,'new resolution epoch');
      equal(change.count,String(state.members.length),'frozen complete cohort');
      state.resolution={...pick(change,['epoch','stage','count','registryHash','safetyEpoch','termsEpoch','configEpochs','sourceObservations','sourceDeadlines',
        'prices','funding','frozenAt']) as any,cursor:'0',membershipEpoch:present(state.membershipVersion,'frozen membership epoch'),cashBefore:change.cash,poolsBefore:change.pools,insuranceBefore:change.insurance,
        feesBefore:change.fees,allocatedBefore:change.allocated,budgets:change.insurance,insuranceSpent:['0','0'],evaluation:0,clippedMask:0,
        rows:{},remainingCash:change.cash,appliedCash:'0',remainingLots:['0','0'],remainingGross:change.gross,
        remainingClaims:change.pools.map((value:string)=>(BigInt(value)*scale).toString())};
      Object.assign(safety(),{mode:2,paused:true,epoch:change.safetyEpoch,resolutionEpoch:change.epoch,recoverySince:'0',recoveryLast:'0'});
      currentVenue().termsEpoch=change.termsEpoch;change.markets.forEach((value:any)=>market(value));break;
    }
    case 'AccountResolutionValuedV3': {
      const current=resolution();accountCheck(current.stage===2&&!current.rows[change.id]&&state.identities[change.id]===change.member,'valued row identity');
      const source=state.roots[change.member];equal(change.cash,source.cash,'frozen row cash');
      current.rows[change.id]={member:change.member,cashBefore:change.cash,lots:change.lots,generations:change.generations,claimsScaled:change.claimsScaled,collected:change.collected};break;
    }
    case 'AccountResolutionProgressV3': {
      const current=resolution();Object.assign(current,{stage:change.nextStage,cursor:change.nextCursor,evaluation:change.evaluation,clippedMask:change.clippedMask});break;
    }
    case 'AccountResolutionProposalV3':resolution().stage=change.nextStage;resolution().cursor='0';break;
    case 'AccountResolutionRatesV3': {
      const current=resolution();accountCheck([1,2,3].includes(change.outcome),'rate outcome');
      Object.assign(current,{stage:change.outcome===3?6:4,cursor:'0',evaluation:change.nextEvaluation,clippedMask:change.clippedMask,
        budgets:change.budgets,insuranceSpent:change.insuranceSpent});break;
    }
    case 'AccountResolutionPlannedV3': {
      const current=resolution();equal(present(current.rows[change.id],'planned row').member,change.member,'planned identity');break;
    }
    case 'AccountResolutionOrderV3':resolution();break;
    case 'AccountResolutionRoundedV3': {
      const current=resolution();accountCheck(current.stage===8&&current.cursor===change.start,'round cursor');
      current.stage=change.complete?9:8;current.cursor=change.complete?'0':(BigInt(change.start)+1n).toString();break;
    }
    case 'AccountResolutionAppliedV3': {
      const current=resolution(),row=present(current.rows[change.id],'applied row');
      accountCheck(current.stage===9&&!row.applied&&row.member===change.member,'once-only application');
      equal(row.cashBefore,change.cashBefore,'applied original cash');equal(change.state.cash,change.cashAfter,'applied new cash');
      Object.assign(row,{flows:change.flows,cashAfter:change.cashAfter,applied:true});root(change.state,change.member);
      Object.assign(current,{remainingCash:change.remainingCash,appliedCash:change.appliedCash,remainingLots:change.remainingLots,
        remainingGross:change.remainingGross,remainingClaims:change.remainingClaims});
      currentVenue().markets.forEach((key,index)=>state.markets[key].grossLots=change.remainingGross[index]);break;
    }
    case 'AccountResolutionCompletedV3': {
      const current=resolution();accountCheck([10,11].includes(change.stage),'resolution completion stage');
      // Fixed [u8;2] is canonical hex in the journal, unlike numeric vectors.
      // Indexing its characters silently turns e.g. 0300 into string carries.
      accountCheck(typeof change.insuranceFeeRemainders==='string'&&/^[0-9a-f]{4}$/.test(change.insuranceFeeRemainders),'resolution fee carry encoding');
      const feeCarries=Buffer.from(change.insuranceFeeRemainders,'hex');
      accountCheck(feeCarries.every(value=>value<4),'resolution fee carry bound');
      current.stage=change.stage;current.safetyEpoch=change.safetyEpoch;
      equal(totalAccountCash(state).toString(),change.cash,'complete root cash');custody().allocatedVault=change.allocated;
      Object.assign(safety(),{mode:change.mode,epoch:change.safetyEpoch,paused:change.mode===2});
      for(const value of Object.values(state.ledgers)) {
        const index=value.marketIndex;Object.assign(value,{settlement:change.pools[index],insurance:change.insurance[index],fees:change.fees[index],
          version:change.ledgerVersions[index],liabilityVersion:change.liabilityVersions[index],insuranceFeeRemainder:feeCarries[index]});
      }break;
    }
    case 'AccountSafetyRecoveryV3':
      resolution().stage=change.stage;
      if(change.kind===1){resolution().termsEpoch=change.termsEpoch;resolution().safetyEpoch=change.safetyEpoch;}
      Object.assign(safety(),{mode:change.mode,paused:change.paused,epoch:change.safetyEpoch,recoverySince:change.recoverySince,recoveryLast:change.recoveryLast});
      Object.assign(currentVenue(),pick(change,['termsEpoch','configEpoch']));
      equal(totalAccountCash(state).toString(),change.totalCash,'recovered root cash');custody().allocatedVault=change.allocatedVault;change.markets.forEach((value:any)=>market(value));break;
    case 'AccountRetirementProgressV3':
      state.retirement={schemaVersion:10,revision:state.retirement?.revision??Object.values(state.revisions).find(value=>value.kind===13)?.revision??'0',venue,safetyEpoch:change.safetyEpoch,membershipVersion:change.membershipVersion,
        cash:change.cash,count:change.count,next:change.next,complete:change.complete,membership:change.membership};break;
    case 'AccountsRetiredV3':
      if(safety().mode===3)present(state.resolution,'terminal resolution').stage=13;
      Object.assign(safety(),{mode:4,paused:false,epoch:change.safetyEpoch});currentVenue().termsEpoch=change.termsEpoch;
      equal(totalAccountCash(state).toString(),change.totalCash,'retired cash');equal(custody().allocatedVault,change.allocatedVault,'retired vault');break;
    case 'RetiredReserveWithdrawnV3': {
      const value=present(Object.values(state.ledgers).find(ledger=>ledger.marketIndex===change.marketIndex),'reserve ledger');
      accountCheck(safety().mode===4,'terminal reserve withdrawal');
      Object.assign(value,{insurance:change.insurance,fees:change.fees,insuranceFeeRemainder:change.feeRemainder,version:change.ledgerVersion});
      custody().allocatedVault=change.allocatedVault;break;
    }
    default:
      accountCheck(profile===4,'unsupported account projection event');
      projectLiquidity(state,event,{root,market,ledger},artifactSet);
  }
  state.sequence=(BigInt(state.sequence)+1n).toString();
  reconcileAccountLedger(state);
}

/** Derived only from the complete projected cohort; never withdrawal authority.
 * During Apply this is the mixed original/applied sum, not spendable cash. */
export function totalAccountCash(state:AccountState):bigint {
  return state.members.reduce((sum,key)=>sum+BigInt(present(state.roots[key],'member').cash),0n);
}

/** Independent whole-cohort equalities, including mixed roots during Apply. */
export function reconcileAccountLedger(state:AccountState) {
  const venue=present(state.venue,'venue'),custody=present(state.custody,'custody'),safety=present(state.safety,'safety');
  const roots=state.members.map(key=>present(state.roots[key],'member'));
  equal(BigInt(Object.keys(state.identities).length),BigInt(state.nextMemberId),'complete allocated identities');
  equal(BigInt(Object.keys(state.roots).length),BigInt(state.registeredCount),'complete unretired identities');
  accountCheck(new Set(Object.values(state.identities)).size===Object.keys(state.identities).length,'distinct identity roots');
  for(const [key,root] of Object.entries(state.roots)) {
    accountCheck(state.identities[root.id]===key&&[1,2].includes(root.lifecycle),'root identity membership');
    accountCheck(state.members.includes(key)===(root.lifecycle===2),'complete financial membership');
    if(root.lifecycle===1)accountCheck(root.cash==='0'&&root.reserved==='0'&&root.positions.every(position=>position.lots==='0'&&position.virtualScaled==='0'),
      'registered financial exclusion');
  }
  for(const [key,root] of Object.entries(state.tombstones))accountCheck(state.identities[root.id]===key&&!state.roots[key]&&!state.members.includes(key),'permanent retired identity');
  const ledgers=Object.values(state.ledgers);
  const pools=ledgers.reduce((sum,value)=>sum+BigInt(value.settlement)+BigInt(value.insurance)+BigInt(value.fees),0n);
  const accountedCash=BigInt(custody.allocatedVault)-pools;
  accountCheck(accountedCash>=0n,'cash conservation');
  accountCheck(ledgers.length===venue.marketCount&&new Set(ledgers.map(value=>value.marketIndex)).size===ledgers.length,'complete market ledgers');
  ledgers.forEach(value=>accountCheck(value.insuranceFeeRemainder>=0&&value.insuranceFeeRemainder<4,'fee carry bound'));
  const pagedApply=state.resolution?.stage===14&&state.pagedSettlement?.stage===9;
  const partial=state.resolution?.stage===9||pagedApply?state.resolution:null;
  equal(roots.reduce((sum,root)=>sum+BigInt(root.cash),0n),partial?BigInt(partial.remainingCash)+BigInt(partial.appliedCash):accountedCash,'root cash sum');
  roots.forEach((root)=>{
    accountCheck(root.schemaVersion===10&&state.identities[root.id]!==undefined&&root.lifecycle===2&&BigInt(root.activationGeneration)>0n&&root.positions.length===2&&root.book.orders.length===4&&root.book.protections.length===2,'bounded root');
    accountCheck([0,1].includes(root.mode)&&(root.mode===0?root.subaccountIndex===0&&root.isolatedMarketIndex===255&&root.role!==1:
      root.subaccountIndex>=1&&root.subaccountIndex<=8&&([0,1].includes(root.isolatedMarketIndex)||sdk.isListedMakerCapital(root))),'margin mode');
    if(root.mode===1)root.positions.forEach((position,index)=>{
      if(index!==root.isolatedMarketIndex)accountCheck(Object.values(position).every(value=>value==='0'),'foreign isolated position');
    });
    let reserved=0n;
    for(const {order,marketIndex} of root.book.orders) {
      if(![1,2].includes(order.state)){equal(order.reserve,'0','inactive order reserve');continue;}
      accountCheck([0,1].includes(marketIndex)&&(root.mode===0||root.isolatedMarketIndex===marketIndex),'order market');
      accountCheck(BigInt(order.filled)<BigInt(order.lots)&&BigInt(order.feeCharged)===(BigInt(order.notional)+4999n)/5000n,'order prefix');
      reserved+=BigInt(order.reserve);
    }
    equal(reserved,BigInt(root.reserved),'cached order sum');
  });
  for(let index=0;index<venue.marketCount;index++) {
    const market=present(state.markets[venue.markets[index]],'market');
    const ledger=present(ledgers.find(value=>value.marketIndex===index),'ledger');
    const lots=roots.reduce((sum,root)=>sum+BigInt(root.positions[index].lots),0n);
    equal(lots,partial?BigInt(partial.remainingLots[index]):0n,'net exposure');
    equal(roots.reduce((sum,root)=>sum+abs(BigInt(root.positions[index].lots)),0n),BigInt(market.grossLots),'gross exposure');
    let claims=roots.reduce((sum,root)=>{const position=root.positions[index];return sum+BigInt(position.virtualScaled)+BigInt(position.lots)*BigInt(position.fundingCheckpointScaled);},0n);
    if(partial)claims+=lots*(BigInt(partial.prices[index])*scale-BigInt(partial.funding[index]));
    equal(claims,partial?BigInt(partial.remainingClaims[index]):BigInt(ledger.settlement)*scale,'market claims conservation');
  }
  if(safety.mode===2) {
    const current=present(state.resolution,'frozen resolution');
    accountCheck(safety.paused&&current.count===String(state.members.length),'frozen cohort');
    if(current.stage<=9||pagedApply) {
      equal(accountedCash.toString(),current.cashBefore,'frozen cash bucket');equal(custody.allocatedVault,current.allocatedBefore,'frozen vault');
      for(const ledger of ledgers)equal([ledger.settlement,ledger.insurance,ledger.fees],
        [current.poolsBefore[ledger.marketIndex],current.insuranceBefore[ledger.marketIndex],current.feesBefore[ledger.marketIndex]],'frozen protected buckets');
    }
  }
}
