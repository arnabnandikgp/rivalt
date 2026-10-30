import { address, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress, type Address, type ReadonlyUint8Array } from '@solana/kit';
import * as clearing from './generated/index.js';
import * as canonical from './generatedMakerA/index.js';
import { MAKER_B_PROGRAM_ADDRESS } from './generatedMakerB/index.js';
import { quoteCanonical, validateCanonicalShape, type CanonicalShape } from './canonical-quote.js';
import { deriveMarginAccount } from './account-addresses.js';
import { fromBase64, hex, requireValue, rpcInteger, type UserRpc } from './wallet-client.js';

const LOADER = address('BPFLoaderUpgradeab1e11111111111111111111111');
const KEY = getAddressEncoder();
export const LIQUIDITY_CAPABILITY = 1;
export const LIQUIDITY_MAKER_COUNT = 3;
export type LiquidityUnavailable = 'quarantined' | 'unapproved-code' | 'disabled' | 'stale-publication' | 'invalid-publication';
export type LiquidityAccountMap = ReadonlyMap<Address, { owner: string; executable: boolean; data: [string, string] } | null>;
export type LiquiditySnapshotIdentity = Readonly<{
  venue: Address; market: Address; marketIndex: 0 | 1; domain: ReadonlyUint8Array;
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
  commitment: 'confirmed' | 'finalized') {
  const [registry] = await clearing.findLiquidityRegistryPda({ market });
  const registrations = await Promise.all([0,1,2].map(async instance => (await getProgramDerivedAddress({
    programAddress: clearing.CLEARING_PROGRAM_ADDRESS,
    seeds: [new TextEncoder().encode('maker-v4'), KEY.encode(market), Uint8Array.of(instance)],
  }))[0]));
  const discovery = await rpc.call('getMultipleAccounts',[registrations,{ encoding: 'base64', commitment }]);
  requireValue(discovery.value?.length === 3, 'Incomplete liquidity discovery.');
  const accounts: LiquidityAccountMap = new Map(registrations.map((key,index) => [key,discovery.value[index]]));
  const capitals: Address[] = [], dependencies: Address[] = [registry,...registrations];
  for (const [instance,key] of registrations.entries()) {
    const state = decode(bytes(accounts,key,clearing.CLEARING_PROGRAM_ADDRESS),clearing.MAKER_REGISTRATION_DISCRIMINATOR,
      clearing.getMakerRegistrationDecoder());
    requireValue(state.schemaVersion === 6 && state.venue === venue && state.market === market && state.instance === instance,
      'Foreign liquidity discovery.');
    const [binding] = await getProgramDerivedAddress({ programAddress: clearing.CLEARING_PROGRAM_ADDRESS,
      seeds: [new TextEncoder().encode('capital-v3'), KEY.encode(state.capital)] });
    capitals.push(state.capital);
    dependencies.push(state.config,state.price,state.pricingProgram,state.programData,binding);
  }
  requireValue(new Set(capitals).size === 3, 'Aliased discovered maker capital.');
  return { capitals, keys: [...new Set(dependencies)], contextSlot: rpcInteger(discovery.context.slot) };
}

/** Called only with the final coherent RPC batch, including the sealed registry,
 * every registration, capital, unique-capital binding, config, price and code.
 * Full code hashes are deduplicated by program address, not by maker instance.
 */
export async function authenticateLiquidityMarket(snapshot: LiquiditySnapshotIdentity, accounts: LiquidityAccountMap) {
  snapshot = freezeState({ ...snapshot,domain: Uint8Array.from(snapshot.domain) });
  const [registryKey, registryBump] = await clearing.findLiquidityRegistryPda({ market: snapshot.market });
  const registry = decode(bytes(accounts,registryKey,clearing.CLEARING_PROGRAM_ADDRESS), clearing.LIQUIDITY_REGISTRY_DISCRIMINATOR,
    clearing.getLiquidityRegistryDecoder());
  requireValue(registry.schemaVersion === 6 && registry.venue === snapshot.venue && registry.market === snapshot.market
    && registry.bump === registryBump && registry.sealed && registry.count === LIQUIDITY_MAKER_COUNT,
    'Liquidity registry is not complete and sealed.');
  requireValue(new Set(registry.registrations).size === LIQUIDITY_MAKER_COUNT, 'Aliased maker registration.');
  const seenCapital = new Set<Address>();
  const seenRootIds = new Set<number>();
  const codeHashes = new Map<Address, string>();
  const adapters: LiquidityAdapter[] = [];
  for (const [instance, registrationKey] of registry.registrations.entries()) {
    const [expectedRegistration, registrationBump] = await getProgramDerivedAddress({ programAddress: clearing.CLEARING_PROGRAM_ADDRESS,
      seeds: [new TextEncoder().encode('maker-v4'), KEY.encode(snapshot.market), Uint8Array.of(instance)] });
    const registration = decode(bytes(accounts,registrationKey,clearing.CLEARING_PROGRAM_ADDRESS), clearing.MAKER_REGISTRATION_DISCRIMINATOR,
      clearing.getMakerRegistrationDecoder());
    requireValue(registrationKey === expectedRegistration && registration.bump === registrationBump && registration.schemaVersion === 6
      && registration.venue === snapshot.venue && registration.market === snapshot.market && registration.instance === instance
      && registration.authorityEpoch > 0n && registration.depthEpoch > 0n && registration.buyConsumed <= 4096n && registration.sellConsumed <= 4096n,
      'Invalid maker registration binding.');
    requireValue(!seenCapital.has(registration.capital), 'Aliased maker capital.'); seenCapital.add(registration.capital);
    const capital = decode(bytes(accounts,registration.capital,clearing.CLEARING_PROGRAM_ADDRESS), clearing.MARGIN_ACCOUNT_DISCRIMINATOR,
      clearing.getMarginAccountDecoder());
    const [capitalKey, capitalBump] = await deriveMarginAccount(capital.portfolio,capital.subaccountIndex);
    requireValue(capitalKey === registration.capital && capital.bump === capitalBump && capital.schemaVersion === 6
      && capital.venue === snapshot.venue && capital.owner === registration.owner && capital.role === 1 && capital.mode === 1
      && capital.isolatedMarketIndex === snapshot.marketIndex && capital.subaccountIndex >= 1 && capital.subaccountIndex <= 8
      && capital.id < 64 && !seenRootIds.has(capital.id), 'Invalid isolated maker capital.');
    seenRootIds.add(capital.id);
    const foreignPosition = capital.positions[1-snapshot.marketIndex];
    requireValue(foreignPosition.lots === 0n && foreignPosition.virtualScaled === 0n && foreignPosition.fundingCheckpointScaled === 0n
      && foreignPosition.generation === 0n, 'Foreign isolated maker position.');
    const [bindingKey] = await getProgramDerivedAddress({ programAddress: clearing.CLEARING_PROGRAM_ADDRESS,
      seeds: [new TextEncoder().encode('capital-v3'), KEY.encode(registration.capital)] });
    const binding = decode(bytes(accounts,bindingKey,clearing.CLEARING_PROGRAM_ADDRESS), clearing.CAPITAL_BINDING_DISCRIMINATOR,
      clearing.getCapitalBindingDecoder());
    requireValue(binding.schemaVersion === 6 && binding.venue === snapshot.venue && binding.capital === registration.capital
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
    requireValue(config.schemaVersion === 4 && config.venue === snapshot.venue && config.market === snapshot.market
      && config.capital === registration.capital && config.controller === controller && config.owner === registration.owner
      && config.instance === instance && config.bump === configBump && hex(config.domain) === hex(snapshot.domain)
      && config.controlEpoch > 0n && config.shapeEpoch > 0n, 'Invalid canonical config identity.');
    const shape = canonicalShapeFromAccount(config.shape);
    const price = decode(bytes(accounts,priceKey,program),canonical.MAKER_PRICE_DISCRIMINATOR,canonical.getMakerPriceDecoder()).state;
    requireValue(price.schemaVersion === 4 && price.config === configKey && price.bump === priceBump, 'Invalid price account identity.');
    const validUntilSlot = price.updatedSlot + BigInt(shape.ttlSlots), validUntilTime = price.updatedTime + 6n;
    const validPrice = price.sequence > 0n && price.anchor >= 1n && price.anchor <= 1_000_000n
      && price.controlEpoch === config.controlEpoch && price.updatedTime >= 0n && price.updatedSlot <= snapshot.slot && price.updatedTime <= snapshot.now;
    const unavailable: LiquidityUnavailable | null = registration.quarantined ? 'quarantined'
      : codeHashes.get(program) !== hex(registration.approvedHash) ? 'unapproved-code'
      : shape.mode === 0 ? 'disabled' : !validPrice ? 'invalid-publication'
      : snapshot.slot >= validUntilSlot || snapshot.now >= validUntilTime ? 'stale-publication' : null;
    freezeState(capital);freezeState(registration);freezeState(config);freezeState(shape);freezeState(price);
    const requestDomain = Uint8Array.from(snapshot.domain);
    const inventory = capital.positions[snapshot.marketIndex].lots;
    const consumed = (side: 0|1) => side === 0 ? registration.buyConsumed : registration.sellConsumed;
    const request = (side: 0|1, lots: bigint): canonical.MakerQuoteRequestArgs => ({ version: 4, domain: Uint8Array.from(requestDomain),
      market: snapshot.market, capital: registration.capital, instance, authorityEpoch: registration.authorityEpoch,
      controlEpoch: config.controlEpoch, shapeEpoch: config.shapeEpoch, depthEpoch: registration.depthEpoch, side, lots, inventory, consumed: consumed(side) });
    adapters.push(Object.freeze({ capability: LIQUIDITY_CAPABILITY, registration: registrationKey, registrationState: registration, capital,
      config, price, shape, snapshot, unavailable, validUntilSlot, validUntilTime, request,
      quote(side: 0|1,lots: bigint) { requireValue(unavailable === null, `Maker unavailable: ${unavailable}`);
        return quoteCanonical(shape,price.anchor,side,lots,inventory,consumed(side)); },
      depthHints(side: 0|1) { return (side === 0 ? shape.asks : shape.bids).map(region => region.endLots-consumed(side)).filter(lots => lots>0n); },
    }));
  }
  requireValue(codeHashes.size === 2, 'Sealed registry must represent both admitted programs.');
  return { registry: registryKey, registryState: freezeState(registry), adapters: Object.freeze(adapters) };
}
