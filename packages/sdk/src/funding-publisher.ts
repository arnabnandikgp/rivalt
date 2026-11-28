import {listingOracle} from './market-listing.js';
import {readCoherentAccounts} from './coherent-accounts.js';
import {hasCapacityLayout,hasFundingLayout,type MarginLayout} from './profit-attribution.js';
import {decodeCapacityAnchor,makerRegistrationPdas,marketFromExecutionLanes} from './market-capacity.js';
import { BTC_LOTS_PER_UNIT, ETH_LOTS_PER_UNIT, FUNDING_REFERENCE_NOTIONAL } from './price-policy.js';
import { AccountRole,type Instruction,type Address, type FixedSizeDecoder, type ReadonlyUint8Array } from '@solana/kit';
import * as clearing from './generated/index.js';
import { ACCOUNT_CLOCK } from './account-snapshot.js';
import { deriveAccountVenue, deriveAccountMarket, deriveVenueComponent } from './account-addresses.js';
import { authenticateLiquidityMarket, discoverLiquidityAccounts, type LiquidityAccountMap } from './liquidity-adapter.js';
import { allocateFundingSide } from './funding-impact.js';
import { fundingReference } from './funding-sources.js';
import { fromBase64, hex, requireValue, rpcInteger, type UserRpc } from './wallet-client.js';

function decode<Value>(account: LiquidityAccountMap extends ReadonlyMap<Address, infer Value> ? Value : never,
  discriminator: ReadonlyUint8Array, decoder: FixedSizeDecoder<Value>): Value {
  requireValue(account?.owner === clearing.CLEARING_PROGRAM_ADDRESS && !account.executable && account.data?.[1] === 'base64',
    'Missing or foreign funding dependency.');
  const raw = fromBase64(account.data[0]);
  requireValue(raw.length === decoder.fixedSize && hex(raw.slice(0, 8)) === hex(discriminator), 'Invalid funding dependency schema.');
  return decoder.decode(raw);
}

/** D76 snapshot digest v1: SHA256(UTF8(JSON([domain, context-slot decimal,
 * key-sorted [key,owner,executable,base64-bytes] rows; missing accounts are null]))).
 * Retain the rows locally for audit. This digest is a reference, never a proof. */
export async function fundingSnapshotDigest(contextSlot: bigint, accounts: LiquidityAccountMap) {
  const rows = [...accounts].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => [key, value ? [value.owner, value.executable, value.data[0]] : null]);
  const bytes = new TextEncoder().encode(JSON.stringify(['rivalt-funding-snapshot-v1', contextSlot.toString(), rows]));
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/** Build an unsigned report from one final RPC batch. Discovery supplies only
 * account addresses; all values used for the report come from the final batch.
 * A missing/invalid maker prevents complete coverage, even with zero capacity.
 * No caller-supplied quote, risk value or financial-admission predicate is used. */
export async function readFundingReport(rpc: Pick<UserRpc, 'call'>, venue: Address, marketIndex: 0 | 1,
  commitment: 'confirmed' | 'finalized' = 'confirmed', marginLayout: MarginLayout = 'selected') {
  requireValue(marketIndex === 0 || marketIndex === 1, 'Unsupported funding market.');
  const [[market, marketBump], [safety, safetyBump], [custody]] = await Promise.all([
    deriveAccountMarket(venue, marketIndex), deriveVenueComponent(venue, 'safety'), deriveVenueComponent(venue, 'custody'),
  ]);
  const [configuration, configurationBump] = await clearing.findFundingPublisherPda({ market });
  const sourceDiscovery = await rpc.call('getMultipleAccounts', [[market], { encoding: 'base64', commitment }]);
  requireValue(sourceDiscovery.value?.length === 1, 'Incomplete funding source discovery.');
  const decodeMarket = (account: LiquidityAccountMap extends ReadonlyMap<Address, infer Value> ? Value : never) => {
    if (!hasCapacityLayout(marginLayout)) return decode(account, clearing.MARKET_DISCRIMINATOR, clearing.getMarketDecoder());
    requireValue(account?.owner === clearing.CLEARING_PROGRAM_ADDRESS && !account.executable && account.data[1] === 'base64',
      'Missing or foreign funding market.');
    return decodeCapacityAnchor(fromBase64(account!.data[0]),hasFundingLayout(marginLayout)).market;
  };
  const discoveredMarket = decodeMarket(sourceDiscovery.value[0]);
  let discovery: Awaited<ReturnType<typeof discoverLiquidityAccounts>> | null = null;
  let coverageReason: string | null = null;
  try { discovery = await discoverLiquidityAccounts(rpc, venue, market, commitment, marginLayout); }
  catch { coverageReason = 'invalid-maker-discovery'; }
  const [registry] = await clearing.findLiquidityRegistryPda({ market });
  const registrationPdas=hasFundingLayout(marginLayout)?await makerRegistrationPdas(market):[];
  const checkpointAccounts=registrationPdas.map(([key])=>key);
  const keys = [...new Set([...checkpointAccounts,venue, market, configuration, safety, ACCOUNT_CLOCK, registry,
    ...discoveredMarket.oracle.sources, ...discovery?.keys ?? [], ...discovery?.capitals ?? []])];
  requireValue(keys.length <= 33 + 5 * (discovery?.capitals.length ?? 0), 'Funding snapshot exceeds bounded dependency set.');
  const discoveredSlot = rpcInteger(sourceDiscovery.context.slot);
  const minContextSlot = discovery && discovery.contextSlot > discoveredSlot ? discovery.contextSlot : discoveredSlot;
  const response = await readCoherentAccounts(rpc,keys,commitment,minContextSlot);
  const contextSlot = rpcInteger(response.context.slot);
  requireValue(response.value?.length === keys.length && contextSlot >= minContextSlot, 'Incomplete or regressed funding snapshot.');
  const accounts: LiquidityAccountMap = new Map(keys.map((key, index) => [key, response.value[index]]));
  const venueState = decode(accounts.get(venue) ?? null, clearing.VENUE_DISCRIMINATOR, clearing.getVenueDecoder());
  let marketState = decodeMarket(accounts.get(market) ?? null);
  const safetyState = decode(accounts.get(safety) ?? null, clearing.VENUE_SAFETY_DISCRIMINATOR, clearing.getVenueSafetyDecoder());
  const configurationState = decode(accounts.get(configuration) ?? null, clearing.FUNDING_PUBLISHER_DISCRIMINATOR,
    clearing.getFundingPublisherDecoder());
  const [venueKey, venueBump] = await deriveAccountVenue(Uint8Array.from(venueState.domain));
  requireValue(venueKey === venue && venueState.bump === venueBump && venueState.schemaVersion === 10
    && [6,7].includes(venueState.profileVersion) && venueState.marketCount === 2 && venueState.insuranceFeeShareBps === 2500
    && venueState.markets[marketIndex] === market && marketState.schemaVersion === 10 && marketState.venue === venue
    && marketState.index === marketIndex && marketState.bump === marketBump && marketState.crossEligible
    && marketState.lotsPerUnit === [BTC_LOTS_PER_UNIT, ETH_LOTS_PER_UNIT][marketIndex], 'Invalid funding venue/market identity.');
  requireValue(marketState.oracle.sources.every((key, index) => key === discoveredMarket.oracle.sources[index]), 'Source bindings changed during discovery.');
  requireValue(safetyState.schemaVersion === 10 && safetyState.venue === venue && safetyState.bump === safetyBump
    && !safetyState.paused && [0, 1].includes(safetyState.mode), 'Funding publication is suspended.');
  requireValue(configurationState.schemaVersion === 10 && configurationState.venue === venue && configurationState.market === market
    && configurationState.bump === configurationBump && configurationState.enabled && configurationState.authorityEpoch > 0n,
    'Funding publisher is not authorized.');
  const {slot,now}=fundingClock(accounts);
  if(marginLayout==='market-lanes'||marginLayout==='ledger-lanes'){
    const marketBytes=fromBase64(accounts.get(market)!.data[0]);
    const registrations=registrationPdas.map(([key,bump])=>{
      const row=accounts.get(key);
      requireValue(row?.owner===clearing.CLEARING_PROGRAM_ADDRESS&&!row.executable&&row.data[1]==='base64','Missing funding checkpoint.');
      return {bytes:fromBase64(row!.data[0]),bump};
    });
    marketState=marketFromExecutionLanes(market,marketBytes,registrations,slot,safetyState.mode===1,marginLayout==='ledger-lanes');
  }
  const calculated=await publishedReport({venueState,venue,market,marketIndex,configurationState,marketState,
    contextSlot,accounts,slot,now,marginLayout,discovery,coverageReason});
  return { ...calculated, checkpointAccounts, configuration, configurationState, marketState, contextSlot, accounts,
    instructionAccounts: { venue, market, custody, safety, configuration,
      primaryAsset: marketState.oracle.sources[0], primaryCollateral: marketState.oracle.sources[1],
      guardAsset: marketState.oracle.sources[2], guardCollateral: marketState.oracle.sources[3] } };
}

/** Funding checkpoints follow the fixed publication accounts in market instance order. */
export function withFundingCheckpoints(instruction:Instruction,addresses:readonly Address[]):Instruction {
  if(!addresses.length)return instruction;
  return {...instruction,accounts:[...instruction.accounts??[],...addresses.map(address=>({address,role:AccountRole.READONLY}))]};
}

function fundingClock(accounts:LiquidityAccountMap) {
  const rawClock = accounts.get(ACCOUNT_CLOCK);
  requireValue(rawClock?.owner === 'Sysvar1111111111111111111111111111111111111' && !rawClock.executable
    && rawClock.data[1] === 'base64', 'Invalid funding Clock owner.');
  const clockBytes = fromBase64(rawClock.data[0]);
  requireValue(clockBytes.length === 40, 'Invalid funding Clock layout.');
  const clock = new DataView(clockBytes.buffer, clockBytes.byteOffset, clockBytes.byteLength);
  const slot = clock.getBigUint64(0, true), now = clock.getBigInt64(32, true);
  return {slot,now};
}

type FundingMarket=Pick<clearing.Market,'index'|'lotsPerUnit'|'oracle'|'observationSequence'|'configEpoch'|'termsEpoch'>;
async function publishedReport({venue,market,marketIndex,venueState,configurationState,marketState,contextSlot,accounts,
  slot,now,marginLayout,discovery,coverageReason,listedAssetId}:{
  venue:Address;market:Address;marketIndex:number;venueState:clearing.Venue;configurationState:clearing.FundingPublisher;
  marketState:FundingMarket;contextSlot:bigint;accounts:LiquidityAccountMap;slot:bigint;now:bigint;marginLayout:MarginLayout;
  discovery:Awaited<ReturnType<typeof discoverLiquidityAccounts>>|null;coverageReason:string|null;listedAssetId?:Uint8Array;
}) {
  // RPC context orders reads; the authenticated Clock supplies report time/slot.
  // Surfpool 1.6.1 returns Clock.slot=context.slot+1 in the same batch. Do not
  // replace Clock with RPC metadata. Clearing still rejects future observations.
  requireValue(slot > configurationState.lastObservedSlot && now > 0n
    && now >= configurationState.lastObservedTime, 'Funding snapshot predates the publisher fence.');
  const report: clearing.FundingReport = {
    version: 1, domain: Uint8Array.from(venueState.domain), market, authorityEpoch: configurationState.authorityEpoch,
    sequence: configurationState.lastSequence + 1n, expectedObservationSequence: marketState.observationSequence,
    expectedConfigEpoch: marketState.configEpoch, expectedTermsEpoch: marketState.termsEpoch,
    observedSlot: slot, observedTime: now, validUntilSlot: 0n, validUntilTime: 0n,
    referencePrice: 0n, quantity: 0n, bid: 0n, ask: 0n, outcome: 1,
    inputDigest: await fundingSnapshotDigest(contextSlot, accounts),
  };
  const reference = await fundingReference(marketState, accounts, now,listedAssetId);
  let allocations: { bid: ReturnType<typeof allocateFundingSide>; ask: ReturnType<typeof allocateFundingSide> } | null = null;
  if (reference !== null) {
    report.outcome = 2;
    if (discovery) {
      try {
        const { adapters } = await authenticateLiquidityMarket({ marginLayout, venue, market, marketIndex, domain: venueState.domain, slot, now, contextSlot }, accounts);
        const unavailable = adapters.find(maker => maker.unavailable !== null);
        if (unavailable) coverageReason = `${unavailable.registrationState.instance}:${unavailable.unavailable}`;
        else {
          const quantity = (FUNDING_REFERENCE_NOTIONAL + reference - 1n) / reference;
          const curves = adapters.map(maker => ({ shape: maker.shape, anchor: maker.price.anchor,
            inventory: maker.inventory,
            buyConsumed: maker.registrationState.buyConsumed, sellConsumed: maker.registrationState.sellConsumed }));
          allocations = { bid: allocateFundingSide(curves, reference, quantity, 1), ask: allocateFundingSide(curves, reference, quantity, 0) };
          report.outcome = 3;
          if (allocations.bid && allocations.ask && allocations.ask.gross >= allocations.bid.gross) {
            report.outcome = 0;
            report.referencePrice = reference; report.quantity = quantity;
            report.bid = allocations.bid.gross; report.ask = allocations.ask.gross;
            report.validUntilSlot = adapters.reduce((end, maker) => maker.validUntilSlot < end ? maker.validUntilSlot : end, slot + 150n);
            report.validUntilTime = adapters.reduce((end, maker) => maker.validUntilTime < end ? maker.validUntilTime : end, now + 6n);
          }
        }
      } catch { coverageReason = 'invalid-maker-snapshot'; }
    }
  }
  return {report,allocations,coverageReason};
}

/** Read the registered sources, restricted publisher, and every configured maker in one bank. */
export async function readListedFundingReport(rpc:Pick<UserRpc,'call'>,venue:Address,marketId:number,
  commitment:'confirmed'|'finalized'='confirmed') {
  requireValue(Number.isInteger(marketId) && marketId>=2 && marketId<=65535,'Invalid listed market ID.');
  const [listing,listingBump]=await clearing.findListingPda({venue,marketId});
  const [[safety,safetyBump],[configuration,configurationBump],[funding,fundingBump],[listingIndex,indexBump],[registry]]=
    await Promise.all([deriveVenueComponent(venue,'safety'),clearing.findListedFundingPublisherPda({listing}),
      clearing.findFundingPda({listing}),clearing.findListingIndexPda({listing}),clearing.findLiquidityRegistryPda({market:listing})]);
  const sourceDiscovery=await rpc.call('getAccountInfo',[listingIndex,{encoding:'base64',commitment}]);
  const decodeIndex=(account:Parameters<typeof decode>[0])=>decode(account,clearing.LISTING_INDEX_DISCRIMINATOR,clearing.getListingIndexDecoder());
  const sourceKeys=decodeIndex(sourceDiscovery.value).sources;
  let discovery:Awaited<ReturnType<typeof discoverLiquidityAccounts>>|null=null;
  let coverageReason:string|null=null;
  try {discovery=await discoverLiquidityAccounts(rpc,venue,listing,commitment,'ledger-lanes');}
  catch {coverageReason='invalid-maker-discovery';}
  const keys=[...new Set([venue,listing,listingIndex,funding,safety,configuration,registry,ACCOUNT_CLOCK,
    ...sourceKeys,...discovery?.keys??[],...discovery?.capitals??[]])];
  const sourceSlot=rpcInteger(sourceDiscovery.context.slot);
  const minimum=discovery && discovery.contextSlot>sourceSlot?discovery.contextSlot:sourceSlot;
  const response=await readCoherentAccounts(rpc,keys,commitment,minimum);
  const contextSlot=rpcInteger(response.context.slot);
  requireValue(response.value?.length===keys.length && contextSlot>=minimum,'Incomplete listed funding snapshot.');
  const accounts:LiquidityAccountMap=new Map(keys.map((key,i)=>[key,response.value[i]]));
  const record=decode(accounts.get(listing)??null,clearing.MARKET_LISTING_DISCRIMINATOR,clearing.getMarketListingDecoder());
  const venueState=decode(accounts.get(venue)??null,clearing.VENUE_DISCRIMINATOR,clearing.getVenueDecoder());
  const [venueKey,venueBump]=await deriveAccountVenue(Uint8Array.from(venueState.domain));
  const index=decodeIndex(accounts.get(listingIndex)??null);
  const state=decode(accounts.get(funding)??null,clearing.LISTED_FUNDING_DISCRIMINATOR,clearing.getListedFundingDecoder());
  const safetyState=decode(accounts.get(safety)??null,clearing.VENUE_SAFETY_DISCRIMINATOR,clearing.getVenueSafetyDecoder());
  const configurationState=decode(accounts.get(configuration)??null,clearing.FUNDING_PUBLISHER_DISCRIMINATOR,clearing.getFundingPublisherDecoder());
  requireValue(venueKey===venue && venueState.bump===venueBump && venueState.schemaVersion===10 && ((venueState.profileVersion===6 && record.status===1) || (venueState.profileVersion===7 && record.status===2))
    && venueState.marketCount===2 && venueState.insuranceFeeShareBps===2500 && record.schemaVersion===1 && record.bump===listingBump
    && record.marketId===marketId && record.venue===venue && record.quoteMint===venueState.quoteMint,'Invalid funding listing.');
  const ticker=new TextDecoder().decode(Uint8Array.from(record.symbol)).replace(/\0+$/,'');
  const {feed,feedId}=await listingOracle(ticker,record.oraclePublisher);
  requireValue(index.schemaVersion===1 && index.listing===listing && index.bump===indexBump && index.sources[0]===feed
    && record.oracleFeed===feed && state.schemaVersion===1 && state.listing===listing && state.bump===fundingBump
    && index.sources.every((key,i)=>key===sourceKeys[i] && key===state.values.oracle.sources[i]),'Invalid listed source binding.');
  requireValue(safetyState.schemaVersion===10 && safetyState.venue===venue && safetyState.bump===safetyBump && !safetyState.paused
    && [0,1].includes(safetyState.mode) && configurationState.schemaVersion===10 && configurationState.venue===venue
    && configurationState.market===listing && configurationState.bump===configurationBump && configurationState.enabled
    && configurationState.authorityEpoch>0n,'Listed funding publication is suspended.');
  const {slot,now}=fundingClock(accounts);
  const marketState={...state.values,index:marketId,lotsPerUnit:record.lotsPerUnit,termsEpoch:1n,configEpoch:1n,
    oracle:{...state.values.oracle,sourceSequences:state.values.oracle.sourceSequences.map((seq,i)=>seq>index.sourceSequences[i]?seq:index.sourceSequences[i])}};
  const calculated=await publishedReport({venueState,venue,market:listing,marketIndex:marketId,configurationState,marketState,
    contextSlot,accounts,slot,now,marginLayout:'ledger-lanes',discovery,coverageReason,listedAssetId:feedId});
  return {...calculated,configurationState,contextSlot,accounts,instructionAccounts:{venue,safety,listing,listingIndex,funding,configuration,
    primaryAsset:sourceKeys[0],primaryCollateral:sourceKeys[1],guardAsset:sourceKeys[2],guardCollateral:sourceKeys[3]}};
}
