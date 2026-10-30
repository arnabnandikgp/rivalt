/** Synthetic financial inputs only. RPC acceptance separately authenticates real
 * program-owned accounts; these fixtures are never deployment configuration. */
import { getAddressDecoder } from '@solana/kit';
import * as sdk from '../src/index.js';

export const testAddress = (value: number) => getAddressDecoder().decode(new Uint8Array(32).fill(value));
export const emptyState = <Value>(decoder: { fixedSize: number; decode(bytes: Uint8Array): Value }) => decoder.decode(new Uint8Array(decoder.fixedSize));
export function liquidityFixture() {
  const venue = testAddress(1), market = testAddress(2), domain = new Uint8Array(32).fill(31);
  const root = { ...emptyState(sdk.getMarginAccountDecoder()),schemaVersion: 6,revision:1n,venue,owner: testAddress(3),id: 0,
    mode: 0,isolatedMarketIndex: 255,cash: 1_000_000_000n };
  const markets = [0,1].map(index => ({ ...emptyState(sdk.getMarketDecoder()),schemaVersion: 6,revision:1n,venue,index,
    referencePrice: 10_000n,lower: 9900n,upper: 10100n,termsEpoch: 1n,configEpoch: 1n,grossLots: 10_000n }));
  const makers = [0,1,2].map(instance => {
    const capitalKey = testAddress(10+instance), registration = testAddress(20+instance);
    const capital = { ...emptyState(sdk.getMarginAccountDecoder()),schemaVersion: 6,revision:1n,venue,owner: testAddress(30+instance),
      id: instance+1,mode: 1,role: 1,isolatedMarketIndex: 0,cash: 1_000_000_000n };
    const shape: sdk.CanonicalShape = { mode: 1,ttlSlots: 150,target: 0n,skewStep: 1n,skewTick: 0n,longCap: 4096n,shortCap: 4096n,
      bids: [{ endLots: 4096n,offset: 10n,slope: 0n }], asks: [{ endLots: 4096n,offset: 10n,slope: 0n }] };
    const registrationState = { ...emptyState(sdk.getMakerRegistrationDecoder()),schemaVersion: 6,revision:1n,venue,market,capital: capitalKey,
      owner: capital.owner,instance,authorityEpoch: 1n,depthEpoch: 1n,
      pricingProgram: instance === 2 ? sdk.makerB.MAKER_B_PROGRAM_ADDRESS : sdk.makerA.MAKER_A_PROGRAM_ADDRESS };
    const config = { ...emptyState(sdk.makerA.getMakerCurveDecoder()).state,schemaVersion: 4,capability: 1,venue,market,
      capital: capitalKey,instance,owner: capital.owner,controlEpoch: 1n,shapeEpoch: 1n };
    const price = { ...emptyState(sdk.makerA.getMakerPriceDecoder()).state,anchor: 10_000n };
    const maker = { capability: 1 as const,registration,registrationState,capital,shape,config,price,
      snapshot: { venue,market,marketIndex: 0 as const,domain,slot: 100n,now: 100n,contextSlot: 100n },
      unavailable: null as sdk.LiquidityUnavailable | null,validUntilSlot: 250n,validUntilTime: 106n,
      request(side: 0|1,lots: bigint): sdk.makerA.MakerQuoteRequestArgs { return { version: 4,domain,market,capital: capitalKey,instance,
        authorityEpoch: 1n,controlEpoch: 1n,shapeEpoch: 1n,depthEpoch: 1n,side,lots,inventory: capital.positions[0].lots,
        consumed: side === 0 ? registrationState.buyConsumed : registrationState.sellConsumed }; },
      quote(side: 0|1,lots: bigint) { return sdk.quoteCanonical(maker.shape,price.anchor,side,lots,capital.positions[0].lots,
        side === 0 ? registrationState.buyConsumed : registrationState.sellConsumed); },
      depthHints(side: 0|1) { const consumed = side === 0 ? registrationState.buyConsumed : registrationState.sellConsumed;
        return (side === 0 ? maker.shape.asks : maker.shape.bids).map(region => region.endLots-consumed).filter(value => value>0n); },
    };
    return maker;
  });
  const input: sdk.LiquidityAllocationInput = { root,markets,makers,marketIndex: 0,side: 0,lots: 1n,slot: 100n,now: 100n,
    funding: [0n,0n],sources: ['Normal','Normal'],allInLimit: 1_000_000_000n,maxFee: 1_000_000n };
  return { input,root,markets,makers };
}
