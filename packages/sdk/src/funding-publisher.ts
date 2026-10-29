import { type Address, type FixedSizeDecoder, type ReadonlyUint8Array } from '@solana/kit';
import * as clearing from './generated/index.js';
import { ACCOUNT_CLOCK } from './account-snapshot.js';
import { deriveAccountVenue, findMarketV3Pda, findVenueComponentV3Pda } from './account-addresses.js';
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
  commitment: 'confirmed' | 'finalized' = 'confirmed') {
  requireValue(marketIndex === 0 || marketIndex === 1, 'Unsupported funding market.');
  const [[market, marketBump], [safety, safetyBump], [custody]] = await Promise.all([
    findMarketV3Pda(venue, marketIndex), findVenueComponentV3Pda(venue, 'safety'), findVenueComponentV3Pda(venue, 'custody'),
  ]);
  const [configuration, configurationBump] = await clearing.findFundingPublisherV4Pda({ market });
  const sourceDiscovery = await rpc.call('getMultipleAccounts', [[market], { encoding: 'base64', commitment }]);
  requireValue(sourceDiscovery.value?.length === 1, 'Incomplete funding source discovery.');
  const discoveredMarket = decode(sourceDiscovery.value[0], clearing.MARKET_V3_DISCRIMINATOR, clearing.getMarketV3Decoder());
  let discovery: Awaited<ReturnType<typeof discoverLiquidityAccounts>> | null = null;
  let coverageReason: string | null = null;
  try { discovery = await discoverLiquidityAccounts(rpc, venue, market, commitment); }
  catch { coverageReason = 'invalid-maker-discovery'; }
  const [registry] = await clearing.findLiquidityRegistryV4Pda({ market });
  const keys = [...new Set([venue, market, configuration, safety, ACCOUNT_CLOCK, registry,
    ...discoveredMarket.oracle.sources, ...discovery?.keys ?? [], ...discovery?.capitals ?? []])];
  requireValue(keys.length <= 48, 'Funding snapshot exceeds bounded dependency set.');
  const discoveredSlot = rpcInteger(sourceDiscovery.context.slot);
  const minContextSlot = discovery && discovery.contextSlot > discoveredSlot ? discovery.contextSlot : discoveredSlot;
  const response = await rpc.call('getMultipleAccounts', [keys, { encoding: 'base64', commitment, minContextSlot: Number(minContextSlot) }]);
  const contextSlot = rpcInteger(response.context.slot);
  requireValue(response.value?.length === keys.length && contextSlot >= minContextSlot, 'Incomplete or regressed funding snapshot.');
  const accounts: LiquidityAccountMap = new Map(keys.map((key, index) => [key, response.value[index]]));
  const venueState = decode(accounts.get(venue) ?? null, clearing.VENUE_V3_DISCRIMINATOR, clearing.getVenueV3Decoder());
  const marketState = decode(accounts.get(market) ?? null, clearing.MARKET_V3_DISCRIMINATOR, clearing.getMarketV3Decoder());
  const safetyState = decode(accounts.get(safety) ?? null, clearing.SAFETY_V3_DISCRIMINATOR, clearing.getSafetyV3Decoder());
  const configurationState = decode(accounts.get(configuration) ?? null, clearing.FUNDING_PUBLISHER_V4_DISCRIMINATOR,
    clearing.getFundingPublisherV4Decoder());
  const [venueKey, venueBump] = await deriveAccountVenue(Uint8Array.from(venueState.domain));
  requireValue(venueKey === venue && venueState.bump === venueBump && venueState.schemaVersion === 3
    && venueState.profileVersion === 4 && venueState.marketCount === 2 && venueState.insuranceFeeShareBps === 2500
    && venueState.markets[marketIndex] === market && marketState.schemaVersion === 3 && marketState.venue === venue
    && marketState.index === marketIndex && marketState.bump === marketBump && marketState.crossEligible
    && marketState.lotsPerUnit === [1_000_000n, 100_000n][marketIndex], 'Invalid funding venue/market identity.');
  requireValue(marketState.oracle.sources.every((key, index) => key === discoveredMarket.oracle.sources[index]), 'Source bindings changed during discovery.');
  requireValue(safetyState.schemaVersion === 3 && safetyState.venue === venue && safetyState.bump === safetyBump
    && !safetyState.paused && [0, 1].includes(safetyState.mode), 'Funding publication is suspended.');
  requireValue(configurationState.schemaVersion === 4 && configurationState.venue === venue && configurationState.market === market
    && configurationState.bump === configurationBump && configurationState.enabled && configurationState.authorityEpoch > 0n,
    'Funding publisher is not authorized.');
  const rawClock = accounts.get(ACCOUNT_CLOCK);
  requireValue(rawClock?.owner === 'Sysvar1111111111111111111111111111111111111' && !rawClock.executable
    && rawClock.data[1] === 'base64', 'Invalid funding Clock owner.');
  const clockBytes = fromBase64(rawClock.data[0]);
  requireValue(clockBytes.length === 40, 'Invalid funding Clock layout.');
  const clock = new DataView(clockBytes.buffer, clockBytes.byteOffset, clockBytes.byteLength);
  const slot = clock.getBigUint64(0, true), now = clock.getBigInt64(32, true);
  // RPC context orders reads; the authenticated Clock supplies report time/slot.
  // Surfpool 1.6.1 returns Clock.slot=context.slot+1 in the same batch. Do not
  // replace Clock with RPC metadata. Clearing still rejects future observations.
  requireValue(slot > configurationState.lastObservedSlot && now > 0n
    && now >= configurationState.lastObservedTime, 'Funding snapshot predates the publisher fence.');
  const report: clearing.FundingReportV4 = {
    version: 1, domain: Uint8Array.from(venueState.domain), market, authorityEpoch: configurationState.authorityEpoch,
    sequence: configurationState.lastSequence + 1n, expectedObservationSequence: marketState.observationSequence,
    expectedConfigEpoch: marketState.configEpoch, expectedTermsEpoch: marketState.termsEpoch,
    observedSlot: slot, observedTime: now, validUntilSlot: 0n, validUntilTime: 0n,
    referencePrice: 0n, quantity: 0n, bid: 0n, ask: 0n, outcome: 1,
    inputDigest: await fundingSnapshotDigest(contextSlot, accounts),
  };
  const reference = await fundingReference(marketState, accounts, now);
  let allocations: { bid: ReturnType<typeof allocateFundingSide>; ask: ReturnType<typeof allocateFundingSide> } | null = null;
  if (reference !== null) {
    report.outcome = 2;
    if (discovery) {
      try {
        const { adapters } = await authenticateLiquidityMarket({ venue, market, marketIndex, domain: venueState.domain, slot, now, contextSlot }, accounts);
        const unavailable = adapters.find(maker => maker.unavailable !== null);
        if (unavailable) coverageReason = `${unavailable.registrationState.instance}:${unavailable.unavailable}`;
        else {
          const quantity = (6_000_000n + reference - 1n) / reference;
          allocations = { bid: allocateFundingSide(adapters, reference, quantity, 1), ask: allocateFundingSide(adapters, reference, quantity, 0) };
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
  return { report, configuration, configurationState, marketState, contextSlot, accounts, allocations, coverageReason,
    instructionAccounts: { venue, market, custody, safety, configuration,
      primaryAsset: marketState.oracle.sources[0], primaryCollateral: marketState.oracle.sources[1],
      guardAsset: marketState.oracle.sources[2], guardCollateral: marketState.oracle.sources[3] } };
}
