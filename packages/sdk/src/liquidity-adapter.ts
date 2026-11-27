import {LISTED_CAPITAL_TAG} from './market-listing.js';
import {registeredMakerPdas, MAX_REGISTERED_MAKERS} from './market-capacity.js';
import {decodeMakerFeeLane} from './market-fees.js';
import {feeLaneLayout,hasFeeLayout,decodeMarginForLayout,type MarginLayout} from './profit-attribution.js';
import { MAX_PRICE } from './price-policy.js';
import { address, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress, type Address, type ReadonlyUint8Array } from '@solana/kit';
import * as clearing from './generated/index.js';
import * as canonical from './generatedMakerA/index.js';
import { MAKER_B_PROGRAM_ADDRESS } from './generatedMakerB/index.js';
import { quoteCanonical, validateCanonicalShape, type CanonicalShape } from './canonical-quote.js';
import { deriveMarginAccount } from './account-addresses.js';
import { fromBase64, hex, requireValue, rpcInteger, type UserRpc } from './wallet-client.js';
import {MAX_MAKER_DEPTH_LOTS} from './quantity-limits.js';

const LOADER = address('BPFLoaderUpgradeab1e11111111111111111111111');
const KEY = getAddressEncoder();
export const LIQUIDITY_CAPABILITY = 1;
export const LIQUIDITY_MAKER_COUNT = 3;
export type LiquidityUnavailable = 'quarantined' | 'unapproved-code' | 'disabled' | 'stale-publication' | 'invalid-publication';
export type LiquidityAccountMap = ReadonlyMap<Address, { owner: string; executable: boolean; data: [string, string] } | null>;
export type LiquiditySnapshotIdentity = Readonly<{
  marginLayout?: MarginLayout; venue: Address; market: Address; marketIndex: number; domain: ReadonlyUint8Array;
  slot: bigint; now: bigint; contextSlot: bigint;
}>;

/** One admitted capability. Instance IDs identify capital, never a hard-coded A/B
 * pricing strategy. Unavailable makers remain in the discovery result with reasons.
 * Quote amounts are exact mathematical prices, not reservations or trade authority.
 */
export type LiquidityAdapter = Readonly<{
  capability: 1;
  registration: Address;
  registrationState: clearing.MakerRegistration;
  capital: clearing.MarginAccount;
  config: canonical.CurveState;
  price: canonical.PriceState;
  shape: CanonicalShape;
  snapshot: LiquiditySnapshotIdentity;
  unavailable: LiquidityUnavailable | null;
  validUntilSlot: bigint;
  validUntilTime: bigint;
  quote(side: 0 | 1, lots: bigint): Readonly<{ gross: bigint; remaining: bigint }>;
  request(side: 0 | 1, lots: bigint): canonical.MakerQuoteRequestArgs;
  /** Price-region/depth hints only. Health feasibility need not be a prefix. */
  depthHints(side: 0 | 1): readonly bigint[];
}>;

function bytes(accounts: LiquidityAccountMap, key: Address, owner: Address): Uint8Array {
  const account = accounts.get(key);
  requireValue(account?.owner === owner && account.data?.[1] === 'base64', 'Missing or foreign liquidity dependency.');
  return fromBase64(account.data[0]);
}
function decode<Value>(raw: ReadonlyUint8Array, discriminator: ReadonlyUint8Array,
  decoder: { fixedSize: number; decode(bytes: ReadonlyUint8Array): Value }): Value {
  requireValue(raw.length === decoder.fixedSize && hex(raw.slice(0,8)) === hex(discriminator), 'Invalid liquidity account layout.');
  return decoder.decode(raw);
}
function freezeState<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    for (const item of Object.values(value)) freezeState(item);
    Object.freeze(value);
  }
  return value;
}
export function canonicalShapeFromAccount(state: canonical.LiquidityShape): CanonicalShape {
  requireValue(state.bidCount <= 8 && state.askCount <= 8 && state.bids.length === 8 && state.asks.length === 8,
    'Invalid canonical region count.');
  for (const [regions, count] of [[state.bids, state.bidCount], [state.asks, state.askCount]] as const) {
    requireValue(regions.slice(count).every(region => region.endLots === 0n && region.offset === 0n && region.slope === 0n),
      'Nonzero unused canonical region.');
  }
  const shape = { ...state, bids: state.bids.slice(0,state.bidCount), asks: state.asks.slice(0,state.askCount) };
  validateCanonicalShape(shape);
  return shape;
}

/** Discovery chooses dependencies only. Every value is read and authenticated
 * again in the final financial batch; discovery never supplies a quote value. */
export async function discoverLiquidityAccounts(rpc: Pick<UserRpc, 'call'>, venue: Address, market: Address,
  commitment: 'confirmed' | 'finalized', layout?:MarginLayout) {
  const [registry] = await clearing.findLiquidityRegistryPda({ market });
  const registryResponse = await rpc.call('getMultipleAccounts',[[registry],{encoding:'base64',commitment}]);
  const registryAccount = new Map([[registry,registryResponse.value?.[0]]]);
  const directory = decode(bytes(registryAccount,registry,clearing.CLEARING_PROGRAM_ADDRESS),
    clearing.LIQUIDITY_REGISTRY_DISCRIMINATOR,clearing.getLiquidityRegistryDecoder());
  requireValue(directory.schemaVersion === 10 && directory.sealed && directory.market === market && directory.venue === venue,
    'Invalid sealed maker directory.');
  const registrations = (await registeredMakerPdas(market,directory.count)).map(([key])=>key);
  const minContextSlot = Number(rpcInteger(registryResponse.context.slot));
  const discovery = await rpc.call('getMultipleAccounts',[registrations,{encoding:'base64',commitment,minContextSlot}]);
  requireValue(discovery.value?.length === registrations.length && rpcInteger(discovery.context.slot) >= BigInt(minContextSlot),
    'Incomplete liquidity discovery.');
  const accounts: LiquidityAccountMap = new Map(registrations.map((key,index) => [key,discovery.value[index]]));
  const capitals: Address[] = [], dependencies: Address[] = [registry,...registrations];
  for (const [instance,key] of registrations.entries()) {
    const raw = bytes(accounts,key,clearing.CLEARING_PROGRAM_ADDRESS);
    const state = hasFeeLayout(layout)?decodeMakerFeeLane(raw,feeLaneLayout(layout)).state:decode(raw,clearing.MAKER_REGISTRATION_DISCRIMINATOR,
      clearing.getMakerRegistrationDecoder());
    requireValue(state.schemaVersion === 10 && state.venue === venue && state.market === market && state.instance === instance,
      'Foreign liquidity discovery.');
    const [binding] = await getProgramDerivedAddress({ programAddress: clearing.CLEARING_PROGRAM_ADDRESS,
      seeds: [new TextEncoder().encode('capital-v3'), KEY.encode(state.capital)] });
    capitals.push(state.capital);
    dependencies.push(state.config,state.price,state.pricingProgram,state.programData,binding);
  }
  requireValue(new Set(capitals).size === registrations.length, 'Aliased discovered maker capital.');
  return { capitals, keys: [...new Set(dependencies)], contextSlot: rpcInteger(discovery.context.slot) };
}

/** Called only with the final coherent RPC batch, including the sealed registry,
 * every registration, capital, unique-capital binding, config, price and code.
 * Full code hashes are deduplicated by program address, not by maker instance.
 */
export async function authenticateLiquidityMarket(snapshot: LiquiditySnapshotIdentity, accounts: LiquidityAccountMap) {
  snapshot = freezeState({ ...snapshot,domain: Uint8Array.from(snapshot.domain) });
  const listed=snapshot.marketIndex>=2;
  if(listed) {
    const listing=decode(bytes(accounts,snapshot.market,clearing.CLEARING_PROGRAM_ADDRESS),clearing.MARKET_LISTING_DISCRIMINATOR,clearing.getMarketListingDecoder());
    const [key,bump]=await clearing.findListingPda({venue:snapshot.venue,marketId:snapshot.marketIndex});
    requireValue(listing.status===1 && listing.revision===2n && listing.schemaVersion===1 && listing.venue===snapshot.venue
      && listing.marketId===snapshot.marketIndex && listing.bump===bump && key===snapshot.market,'Invalid sealed listing.');
  } else requireValue(snapshot.marketIndex===0 || snapshot.marketIndex===1,'Invalid market index.');
  const [registryKey, registryBump] = await clearing.findLiquidityRegistryPda({ market: snapshot.market });
  const registry = decode(bytes(accounts,registryKey,clearing.CLEARING_PROGRAM_ADDRESS), clearing.LIQUIDITY_REGISTRY_DISCRIMINATOR,
    clearing.getLiquidityRegistryDecoder());
  requireValue(registry.schemaVersion === 10 && registry.venue === snapshot.venue && registry.market === snapshot.market
    && registry.bump === registryBump && registry.sealed && registry.count >= 3 && registry.count <= MAX_REGISTERED_MAKERS,
    'Liquidity registry is not complete and sealed.');
  requireValue(new Set(registry.registrations).size === LIQUIDITY_MAKER_COUNT, 'Aliased maker registration.');
  const seenCapital = new Set<Address>();
  const seenRootIds = new Set<bigint>();
  const codeHashes = new Map<Address, string>();
  const adapters: (LiquidityAdapter & {readonly inventory: bigint})[] = [];
  const pdas = await registeredMakerPdas(snapshot.market, registry.count);
  requireValue(registry.registrations.every((key,index) => key === pdas[index][0]), 'Foreign accounting lane registration.');
  for (const [instance, [registrationKey, registrationBump]] of pdas.entries()) {
    const rawRegistration=bytes(accounts,registrationKey,clearing.CLEARING_PROGRAM_ADDRESS);
    const registration = hasFeeLayout(snapshot.marginLayout)?decodeMakerFeeLane(rawRegistration,feeLaneLayout(snapshot.marginLayout)).state:decode(rawRegistration, clearing.MAKER_REGISTRATION_DISCRIMINATOR,
      clearing.getMakerRegistrationDecoder());
    requireValue(registration.bump === registrationBump && registration.schemaVersion === 10
      && registration.venue === snapshot.venue && registration.market === snapshot.market && registration.instance === instance
      && registration.authorityEpoch > 0n && registration.depthEpoch > 0n
      && registration.buyConsumed <= MAX_MAKER_DEPTH_LOTS && registration.sellConsumed <= MAX_MAKER_DEPTH_LOTS,
      'Invalid maker registration binding.');
    requireValue(!seenCapital.has(registration.capital), 'Aliased maker capital.'); seenCapital.add(registration.capital);
    const capital = decodeMarginForLayout(bytes(accounts,registration.capital,clearing.CLEARING_PROGRAM_ADDRESS),snapshot.marginLayout);
    const [capitalKey, capitalBump] = await deriveMarginAccount(capital.portfolio,capital.subaccountIndex);
    requireValue(capitalKey === registration.capital && capital.bump === capitalBump && capital.schemaVersion === 10
      && capital.venue === snapshot.venue && capital.owner === registration.owner && capital.role === 1 && capital.mode === 1
      && capital.isolatedMarketIndex === (listed?LISTED_CAPITAL_TAG:snapshot.marketIndex) && capital.subaccountIndex >= 1 && capital.subaccountIndex <= 8
      && capital.lifecycle === 2 && capital.activationGeneration > 0n && !seenRootIds.has(capital.id), 'Invalid isolated maker capital.');
    seenRootIds.add(capital.id);
    const foreignPositions = listed?capital.positions:[capital.positions[1-snapshot.marketIndex]];
    requireValue(foreignPositions.every(position=>position.lots===0n && position.virtualScaled===0n &&
      position.fundingCheckpointScaled===0n && position.generation===0n), 'Foreign isolated maker position.');
    const [bindingKey] = await getProgramDerivedAddress({ programAddress: clearing.CLEARING_PROGRAM_ADDRESS,
      seeds: [new TextEncoder().encode('capital-v3'), KEY.encode(registration.capital)] });
    const binding = decode(bytes(accounts,bindingKey,clearing.CLEARING_PROGRAM_ADDRESS), clearing.CAPITAL_BINDING_DISCRIMINATOR,
      clearing.getCapitalBindingDecoder());
    requireValue(binding.schemaVersion === 10 && binding.venue === snapshot.venue && binding.capital === registration.capital
      && binding.registration === registrationKey, 'Maker capital is not uniquely bound.');
    const program = registration.pricingProgram;
    requireValue(program === canonical.MAKER_A_PROGRAM_ADDRESS || program === MAKER_B_PROGRAM_ADDRESS, 'Unsupported maker program.');
    const [configKey, configBump] = await getProgramDerivedAddress({ programAddress: program,
      seeds: [new TextEncoder().encode('curve-v4'), KEY.encode(registration.capital)] });
    const [priceKey, priceBump] = await getProgramDerivedAddress({ programAddress: program,
      seeds: [new TextEncoder().encode('price-v4'), KEY.encode(configKey)] });
    const [controller] = await clearing.findLiquidityControllerPda({ venue: snapshot.venue, capital: registration.capital });
    const [programData] = await getProgramDerivedAddress({ programAddress: LOADER, seeds: [KEY.encode(program)] });
    requireValue(registration.config === configKey && registration.price === priceKey && registration.programData === programData,
      'Noncanonical maker dependencies.');
    if (!codeHashes.has(program)) {
      const executable = bytes(accounts,program,LOADER), code = bytes(accounts,programData,LOADER);
      requireValue(accounts.get(program)?.executable === true && executable.length === 36
        && new DataView(executable.buffer,executable.byteOffset).getUint32(0,true) === 2
        && getAddressDecoder().decode(executable.slice(4)) === programData, 'Maker executable binding mismatch.');
      requireValue(code.length >= 45 && code.length <= 1_048_576
        && new DataView(code.buffer,code.byteOffset).getUint32(0,true) === 3, 'Invalid maker ProgramData.');
      codeHashes.set(program,hex(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(code)))));
    }
    const config = decode(bytes(accounts,configKey,program), canonical.MAKER_CURVE_DISCRIMINATOR,canonical.getMakerCurveDecoder()).state;
    requireValue(config.capability === LIQUIDITY_CAPABILITY, 'Unsupported/noncanonical liquidity capability.');
    requireValue(config.schemaVersion === 5 && config.venue === snapshot.venue && config.market === snapshot.market
      && config.capital === registration.capital && config.controller === controller && config.owner === registration.owner
      && config.instance === instance && config.bump === configBump && hex(config.domain) === hex(snapshot.domain)
      && config.controlEpoch > 0n && config.shapeEpoch > 0n, 'Invalid canonical config identity.');
    const shape = canonicalShapeFromAccount(config.shape);
    const price = decode(bytes(accounts,priceKey,program),canonical.MAKER_PRICE_DISCRIMINATOR,canonical.getMakerPriceDecoder()).state;
    requireValue(price.schemaVersion === 5 && price.config === configKey && price.bump === priceBump, 'Invalid price account identity.');
    const validUntilSlot = price.updatedSlot + BigInt(shape.ttlSlots), validUntilTime = price.updatedTime + 6n;
    const validPrice = price.sequence > 0n && price.anchor >= 1n && price.anchor <= MAX_PRICE
      && price.controlEpoch === config.controlEpoch && price.updatedTime >= 0n && price.updatedSlot <= snapshot.slot && price.updatedTime <= snapshot.now;
    const unavailable: LiquidityUnavailable | null = registration.quarantined ? 'quarantined'
      : codeHashes.get(program) !== hex(registration.approvedHash) ? 'unapproved-code'
      : shape.mode === 0 ? 'disabled' : !validPrice ? 'invalid-publication'
      : snapshot.slot >= validUntilSlot || snapshot.now >= validUntilTime ? 'stale-publication' : null;
    freezeState(capital);freezeState(registration);freezeState(config);freezeState(shape);freezeState(price);
    const requestDomain = Uint8Array.from(snapshot.domain);
    const inventory = listed?0n:capital.positions[snapshot.marketIndex].lots;
    const consumed = (side: 0|1) => side === 0 ? registration.buyConsumed : registration.sellConsumed;
    const request = (side: 0|1, lots: bigint): canonical.MakerQuoteRequestArgs => ({ version: 4, domain: Uint8Array.from(requestDomain),
      market: snapshot.market, capital: registration.capital, instance, authorityEpoch: registration.authorityEpoch,
      controlEpoch: config.controlEpoch, shapeEpoch: config.shapeEpoch, depthEpoch: registration.depthEpoch, side, lots, inventory, consumed: consumed(side) });
    adapters.push(Object.freeze({ capability: LIQUIDITY_CAPABILITY, inventory, registration: registrationKey, registrationState: registration, capital,
      config, price, shape, snapshot, unavailable, validUntilSlot, validUntilTime, request,
      quote(side: 0|1,lots: bigint) { requireValue(unavailable === null, `Maker unavailable: ${unavailable}`);
        return quoteCanonical(shape,price.anchor,side,lots,inventory,consumed(side)); },
      depthHints(side: 0|1) { return (side === 0 ? shape.asks : shape.bids).map(region => region.endLots-consumed(side)).filter(lots => lots>0n); },
    }));
  }
  requireValue(codeHashes.size === 2, 'Sealed registry must represent both admitted programs.');
  return { registry: registryKey, registryState: freezeState(registry), adapters: Object.freeze(adapters) };
}
