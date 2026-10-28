import { address,getAddressEncoder,getProgramDerivedAddress,type Address,type ReadonlyUint8Array } from '@solana/kit';
import * as sdk from '../src/index.js';
import { emptyState,testAddress } from './liquidity-fixture.js';

/** Encoded adversarial-reader fixtures, never submitted or called RPC evidence. */
export async function liquidityAccountFixture() {
  const venue = testAddress(1),market = testAddress(2),domain = new Uint8Array(32).fill(31);
  const snapshot = { venue,market,marketIndex: 0 as const,domain,slot: 100n,now: 100n,contextSlot: 100n };
  const loader = address('BPFLoaderUpgradeab1e11111111111111111111111'),keyBytes = getAddressEncoder();
  const accounts = new Map<Address,{ owner: string;executable: boolean;data: [string,string] } | null>();
  const put = (key: Address,owner: Address,bytes: ReadonlyUint8Array,executable=false) =>
    accounts.set(key,{ owner,executable,data: [Buffer.from(Uint8Array.from(bytes)).toString('base64'),'base64'] });
  const derive = async (program: Address,prefix: string,key: Address,tail?: Uint8Array) => getProgramDerivedAddress({
    programAddress: program,seeds: [new TextEncoder().encode(prefix),keyBytes.encode(key),...tail ? [tail] : []] });
  const states = [];
  for (const instance of [0,1,2]) {
    const program = instance === 2 ? sdk.makerB.MAKER_B_PROGRAM_ADDRESS : sdk.makerA.MAKER_A_PROGRAM_ADDRESS;
    const [programData] = await getProgramDerivedAddress({ programAddress: loader,seeds: [keyBytes.encode(program)] });
    const executable = Buffer.alloc(36);executable.writeUInt32LE(2);Buffer.from(keyBytes.encode(programData)).copy(executable,4);
    const code = Buffer.alloc(48);code.writeUInt32LE(3);code[47] = instance === 2 ? 2 : 1;
    put(program,loader,executable,true);put(programData,loader,code);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',code));
    const portfolio = testAddress(30+instance),owner = testAddress(40+instance);
    const [capital,capitalBump] = await sdk.findMarginV3Pda(portfolio,1);
    const [registration,bump] = await derive(sdk.CLEARING_PROGRAM_ADDRESS,'maker-v4',market,Uint8Array.of(instance));
    const [config,configBump] = await derive(program,'curve-v4',capital),[price,priceBump] = await derive(program,'price-v4',config);
    const [controller] = await sdk.findLiquidityControllerV4Pda({ venue,capital });
    const [binding] = await derive(sdk.CLEARING_PROGRAM_ADDRESS,'capital-v3',capital);
    const capitalState = { ...emptyState(sdk.getMarginAccountV3Decoder()),schemaVersion: 3,venue,portfolio,owner,subaccountIndex: 1,
      id: instance+1,mode: 1,role: 1,isolatedMarketIndex: 0,cash: 100000n,bump: capitalBump };
    const registrationState = { ...emptyState(sdk.getMakerRegistrationV4Decoder()),schemaVersion: 4,venue,market,owner,capital,instance,bump,
      config,price,pricingProgram: program,programData,approvedHash: hash,authorityEpoch: 1n,depthEpoch: 1n };
    const bindingState = { ...emptyState(sdk.getCapitalBindingV3Decoder()),schemaVersion: 3,venue,capital,registration };
    const configState = { ...emptyState(sdk.makerA.getMakerCurveV4Decoder()).state,schemaVersion: 4,capability: 1,venue,market,capital,controller,
      owner,instance,domain,bump: configBump,controlEpoch: 1n,shapeEpoch: 1n };
    Object.assign(configState.shape,{ mode: 1,ttlSlots: 150,skewStep: 2n,skewTick: 2n,longCap: 4096n,shortCap: 4096n,bidCount: 1,askCount: 1 });
    configState.shape.bids[0] = { endLots: 4096n,offset: 10n,slope: 0n };configState.shape.asks[0] = { ...configState.shape.bids[0] };
    const priceState = { ...emptyState(sdk.makerA.getMakerPriceV4Decoder()).state,schemaVersion: 4,config,bump: priceBump,
      controlEpoch: 1n,sequence: 1n,anchor: 10000n,updatedSlot: 99n,updatedTime: 99n };
    const write = () => {
      put(capital,sdk.CLEARING_PROGRAM_ADDRESS,sdk.getMarginAccountV3Encoder().encode(capitalState));
      put(registration,sdk.CLEARING_PROGRAM_ADDRESS,sdk.getMakerRegistrationV4Encoder().encode(registrationState));
      put(binding,sdk.CLEARING_PROGRAM_ADDRESS,sdk.getCapitalBindingV3Encoder().encode(bindingState));
      put(config,program,sdk.makerA.getMakerCurveV4Encoder().encode({ state: configState }));
      put(price,program,sdk.makerA.getMakerPriceV4Encoder().encode({ state: priceState }));
    };
    write();states.push({ registration,capital,config,price,program,programData,binding,capitalState,registrationState,bindingState,configState,priceState,write });
  }
  const [registry,bump] = await sdk.findLiquidityRegistryV4Pda({ market });
  const registryState = { ...emptyState(sdk.getLiquidityRegistryV4Decoder()),schemaVersion: 4,venue,market,bump,sealed: true,count: 3,
    registrations: states.map(state => state.registration) };
  const writeRegistry = () => put(registry,sdk.CLEARING_PROGRAM_ADDRESS,sdk.getLiquidityRegistryV4Encoder().encode(registryState));
  writeRegistry();return { snapshot,accounts,states,registryState,writeRegistry };
}
