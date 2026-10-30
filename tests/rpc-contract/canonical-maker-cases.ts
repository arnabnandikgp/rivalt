import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { address, getAddressEncoder, getProgramDerivedAddress, type ReadonlyUint8Array, type Address, type Instruction } from '@solana/kit';
import { getCreateAccountInstruction, getTransferSolInstruction } from '@solana-program/system';
import { TOKEN_PROGRAM_ADDRESS, getInitializeMint2Instruction, getInitializeAccount3Instruction, getMintToInstruction, getTokenDecoder } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { accountPda, accountMarket } from './account-custody-cases.js';
import { addresses, fixtureKey, payerKey, LOADER, type Harness } from './harness.js';

export type CanonicalHarness = Harness & { quote(label: string, instruction: Instruction, expected: bigint): Promise<void>; elapseSeconds?(seconds: number): Promise<void> };
const keyBytes = getAddressEncoder();
const u16 = (value: number) => { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes; };
const zero = { endLots: 0n, offset: 0n, slope: 0n };
export const goldenShape: sdk.makerA.LiquidityShapeArgs = {
  mode: 1, ttlSlots: 150, target: 0n, skewStep: 2n, skewTick: 2n, longCap: 8n, shortCap: 8n,
  bidCount: 2, askCount: 2,
  bids: [{ endLots: 3n, offset: 2n, slope: 1n }, { endLots: 8n, offset: 8n, slope: 0n }, ...Array(6).fill(zero)],
  asks: [{ endLots: 3n, offset: 3n, slope: 2n }, { endLots: 8n, offset: 12n, slope: 0n }, ...Array(6).fill(zero)],
};

export async function provisionCanonicalMakers(h: CanonicalHarness,
  shape: sdk.makerA.LiquidityShapeArgs | ((instance: number) => sdk.makerA.LiquidityShapeArgs) = goldenShape,
  makerMarkets: readonly (0|1)[] = [0,1], initialCash = 1_000_000n) {
  const payer = await payerKey(), owner = await fixtureKey('p30-owner'), updater = await fixtureKey('p30-updater');
  const mint = await fixtureKey('p30-mint'), token = await fixtureKey('p30-token');
  const deployment = await addresses();
  const domain = createHash('sha256').update('rivalt/p40b/schema5/canonical-makers/profile4').digest();
  const venue = await accountPda('venue-v3', domain);
  const registry = await accountPda('registry-v3', keyBytes.encode(venue));
  const vault = await accountPda('vault-v3', keyBytes.encode(venue));
  const custody = await accountPda('custody-v3', keyBytes.encode(venue));
  const safety = await accountPda('safety-v3', keyBytes.encode(venue));
  const markets = [await accountMarket(venue, 0), await accountMarket(venue, 1)];
  const ledgers = await Promise.all(markets.map(market => accountPda('ledger-v3', keyBytes.encode(market))));
  const common = { venue, registry, vault, custody, safety, btcLedger: ledgers[0], ethLedger: ledgers[1],
    eventAuthority: deployment.eventAuthority, program: deployment.program };
  const admin = { ...common, authority: payer, programData: deployment.programData, quoteMint: mint.address,
    feeAuthority: payer.address, reserveAuthority: payer.address, reserveDestinationOwner: payer.address };
  const tracked: Address[] = [venue, custody, safety, registry, vault, token.address, ...markets, ...ledgers];
  const snapshot = () => Promise.all(tracked.map(async key => (await h.read(key))?.toString('hex') ?? null));
  async function rejected(label: string, instructions: Instruction[], signers: typeof payer[], error: number) {
    const before = await snapshot();
    await h.send(label, instructions, signers, error);
    assert.deepEqual(await snapshot(), before, `${label}: changed committed state`);
  }
  await h.send('fund local operator rent', [owner, updater].map(key => getTransferSolInstruction({ source: payer, destination: key.address, amount: 1_000_000_000n })));
  await h.send('create six-decimal test collateral', [getCreateAccountInstruction({ payer, newAccount: mint,
    lamports: await h.rent(82), space: 82n, programAddress: TOKEN_PROGRAM_ADDRESS }),
    getInitializeMint2Instruction({ mint: mint.address, decimals: 6, mintAuthority: payer.address })], [mint]);
  await h.send('mint valueless operator collateral', [getCreateAccountInstruction({ payer, newAccount: token,
    lamports: await h.rent(165), space: 165n, programAddress: TOKEN_PROGRAM_ADDRESS }),
    getInitializeAccount3Instruction({ account: token.address, mint: mint.address, owner: owner.address }),
    getMintToInstruction({ mint: mint.address, token: token.address, mintAuthority: payer, amount: initialCash * 6n })], [token]);
  await h.send('initialize fresh profile4 custody', [await sdk.getInitializeLiquidityVenueInstructionAsync({ ...admin, domain })]);
  assert.equal(sdk.getVenueDecoder().decode((await h.read(venue))!).profileVersion, 4);
  await h.send('initialize venue registry', [await sdk.getInitializeVenueRegistryInstructionAsync(admin)]);
  for (const marketIndex of [0, 1]) {
    await h.send(`initialize market ${marketIndex}`, [sdk.getInitializeMarketInstruction({ ...admin, index: marketIndex,
      market: markets[marketIndex], ledger: ledgers[marketIndex] })]);
  }
  const instances = [];
  for (const marketIndex of makerMarkets) {
    const market = markets[marketIndex];
    const liquidityRegistry = await accountPda('liquidity-v4', keyBytes.encode(market));
    const liquidityCommon = { ...common, market, registry: liquidityRegistry, authority: payer };
    await h.send(`initialize maker registry ${marketIndex}`, [await sdk.getInitializeLiquidityInstructionAsync(liquidityCommon)]);
    tracked.push(liquidityRegistry);
    const portfolio = await accountPda('portfolio-v3', keyBytes.encode(venue), keyBytes.encode(owner.address), u16(marketIndex));
    await h.send(`create operator portfolio ${marketIndex}`, [await sdk.getCreatePortfolioInstructionAsync({ ...common, owner, portfolio, index: marketIndex })], [owner]);
    tracked.push(portfolio);
    const marketInstances = [];
    for (const instance of [0, 1, 2]) {
      const capital = await accountPda('margin-v3', keyBytes.encode(portfolio), u16(instance + 1));
      await h.send(`register isolated capital ${marketIndex}/${instance}`, [await sdk.getRegisterMarginInstructionAsync({ ...common, owner,
        portfolio, margin: capital, subaccountIndex: instance + 1, mode: 1, isolatedMarketIndex: marketIndex, role: 1 })], [owner]);
      await h.send(`fund isolated capital ${marketIndex}/${instance}`, [await sdk.getDepositAccountInstructionAsync({ ...common, owner,
        margin: capital, quoteMint: mint.address, userToken: token.address, amount: initialCash })], [owner]);
      const module = instance === 2 ? sdk.makerB : sdk.makerA;
      const pricingProgram = instance === 2 ? sdk.makerB.MAKER_B_PROGRAM_ADDRESS : sdk.makerA.MAKER_A_PROGRAM_ADDRESS;
      const makerPda = async (...seeds: ReadonlyUint8Array[]) => (await getProgramDerivedAddress({ programAddress: pricingProgram, seeds }))[0];
      const config = await makerPda(Buffer.from('curve-v4'), keyBytes.encode(capital));
      const price = await makerPda(Buffer.from('price-v4'), keyBytes.encode(config));
      const makerEventAuthority = await makerPda(Buffer.from('__event_authority'));
      const [programData] = await getProgramDerivedAddress({ programAddress: LOADER, seeds: [keyBytes.encode(pricingProgram)] });
      const controller = await accountPda('liquidity-control-v4', keyBytes.encode(venue), keyBytes.encode(capital));
      const registration = await accountPda('maker-v4', keyBytes.encode(market), Uint8Array.of(instance));
      const capitalBinding = await accountPda('capital-v3', keyBytes.encode(capital));
      const makerCommon = { config, price, program: pricingProgram, eventAuthority: makerEventAuthority };
      await h.send(`initialize canonical curve ${marketIndex}/${instance}`, [await module.getInitializeCurveInstructionAsync({ ...makerCommon,
        owner, venue, market, capital, instance, shape: typeof shape === 'function' ? shape(instance) : shape,
        updater: updater.address, expiry: 1_000_000n })], [owner]);
      await h.send(`register canonical maker ${marketIndex}/${instance}`, [await sdk.getRegisterLiquidityInstructionAsync({ ...liquidityCommon,
        owner, capital, registration, capitalBinding, config, price, pricingProgram, programData, instance })], [owner]);
      tracked.push(capital, config, price, registration, capitalBinding);
      const controlCommon = { ...common, market, actor: owner, capital, registration, config, price, pricingProgram,
        programData, controller, makerEventAuthority };
      const state = async () => module.getMakerCurveDecoder().decode((await h.read(config))!).state;
      const registrationState = async () => sdk.getMakerRegistrationDecoder().decode((await h.read(registration))!);
      const publish = async (actor = owner, anchor = 100n) => {
        const current = await state(), published = module.getMakerPriceDecoder().decode((await h.read(price))!).state;
        await h.send(`reprice ${marketIndex}/${instance}`, [module.getRepriceInstruction({ ...makerCommon, actor,
          expectedControl: current.controlEpoch, expectedSequence: published.sequence, anchor })], [actor]);
      };
      const request = async (side: number, lots: bigint, inventory = 0n, consumed = 0n) => {
        const current = await state(), registered = await registrationState();
        return module.getQuoteCurveInstruction({ config, price, request: { version: 4, domain, market, capital, instance,
          authorityEpoch: registered.authorityEpoch, controlEpoch: current.controlEpoch, shapeEpoch: current.shapeEpoch,
          depthEpoch: registered.depthEpoch, side, lots, inventory, consumed } });
      };
      const item = { module, pricingProgram, capital, config, price, registration, liquidityRegistry, market, makerCommon,
        controlCommon, publish, request, state, registrationState };
      instances.push(item); marketInstances.push(item);
    }
    await h.send(`seal complete three-maker registry ${marketIndex}`, [sdk.getSealLiquidityInstruction({ ...liquidityCommon,
      first: marketInstances[0].registration, second: marketInstances[1].registration, third: marketInstances[2].registration })]);
    assert.equal(sdk.getLiquidityRegistryDecoder().decode((await h.read(liquidityRegistry))!).sealed, true);
  }
  return { payer, owner, updater, mint, token, deployment, domain, venue, registry, vault, custody, safety,
    markets, ledgers, common, admin, tracked, instances, rejected };
}

export async function canonicalMakerCases(h: CanonicalHarness) {
  const { payer, owner, updater, mint, token, deployment, domain, venue, registry, vault, custody, safety,
    markets, ledgers, common, admin, tracked, instances, rejected } = await provisionCanonicalMakers(h);
  // Literal P29B independent per-lot vectors, checked through the deployed maker A and B programs.
  for (const maker of [instances[0], instances[2], instances[3], instances[5]]) {
    for (const [side, lots, inventory, consumed, expected] of [[0n,3n,0n,0n,317n],[0n,4n,0n,0n,431n],
      [1n,3n,0n,0n,289n],[0n,3n,3n,0n,313n],[1n,3n,-3n,0n,293n],[0n,1n,-3n,3n,114n]]) {
      await maker.publish(updater);
      await h.quote(`literal canonical quote ${maker.capital}/${side}/${lots}/${inventory}/${consumed}`,
        await maker.request(Number(side), lots, inventory, consumed), expected);
    }
  }
  // Maximum-width signed control and actual SBF quote, with hand-derived sums:
  // buy offsets=40,960; sell offsets=32,768; inventory potential=28,672.
  const wide = instances[5];
  const wideShape = { ...goldenShape, skewStep: 512n, skewTick: 2n, longCap: 4096n, shortCap: 4096n, bidCount: 8, askCount: 8,
    bids: Array.from({ length: 8 }, (_, index) => ({ endLots: BigInt((index+1)*512), offset: BigInt(1+2*index), slope: 0n })),
    asks: Array.from({ length: 8 }, (_, index) => ({ endLots: BigInt((index+1)*512), offset: BigInt(3+2*index), slope: 0n })) };
  const wideState = await wide.state();
  await h.send('maximum eight-region shape control', [sdk.getControlLiquidityInstruction({ ...wide.controlCommon,
    expectedAuthority: 1n, expectedControl: wideState.controlEpoch, expectedShape: wideState.shapeEpoch,
    action: { __kind: 'Shape', fields: [wideShape] } })], [owner]);
  await wide.publish(owner, 900_000n);
  await h.quote('maximum eight-region buy', await wide.request(0, 4096n), 3_686_469_632n);
  await wide.publish(owner, 900_000n);
  await h.quote('maximum eight-region sell', await wide.request(1, 4096n), 3_686_338_560n);
  for (const item of [instances[0], instances[5]]) {
    const current = await item.state();
    await rejected('owner cannot bypass clearing controller', [item.module.getControlCurveInstruction({ ...item.makerCommon,
      controller: owner, expectedControl: current.controlEpoch, expectedShape: current.shapeEpoch,
      action: { __kind: 'Mode', mode: 0 } })], [owner], 6000);
  }
  const maker = instances[0];
  const paired = await Promise.all([instances[1], instances[4]].map(async item => {
    const state = await item.state();
    return sdk.getControlLiquidityInstruction({ ...item.controlCommon, expectedAuthority: 1n,
      expectedControl: state.controlEpoch, expectedShape: state.shapeEpoch,
      action: { __kind: 'Shape', fields: [{ ...goldenShape, ttlSlots: 148 }] } });
  }));
  await h.send('atomic two-market full shape update', paired, [owner]);
  for (const item of [instances[1], instances[4]]) assert.equal((await item.state()).shape.ttlSlots, 148);
  const beforeReprice = await maker.registrationState();
  await maker.publish();
  assert.deepEqual(await maker.registrationState(), beforeReprice, 'repricing must not replenish depth');
  let current = await maker.state();
  await rejected('reject foreign reprice actor', [maker.module.getRepriceInstruction({ ...maker.makerCommon, actor: payer,
    expectedControl: current.controlEpoch, expectedSequence: 0n, anchor: 100n })], [], 6003);
  const oldShapeRequest = await maker.request(0, 1n);
  const update = { ...maker.controlCommon, expectedAuthority: 1n, expectedControl: current.controlEpoch, expectedShape: current.shapeEpoch };
  await h.send('owner structural full shape update', [sdk.getControlLiquidityInstruction({ ...update,
    action: { __kind: 'Shape', fields: [{ ...goldenShape, ttlSlots: 149 }] } })], [owner]);
  await rejected('reject replayed structural epoch', [sdk.getControlLiquidityInstruction({ ...update,
    action: { __kind: 'Shape', fields: [goldenShape] } })], [owner], 6112);
  await rejected('old shape-bound request invalid after structural update', [oldShapeRequest], [], 6003);
  await maker.publish();
  await h.quote('fresh price after structural update', await maker.request(0, 3n), 317n);
  await h.send('owner replenishes explicit sides', [sdk.getReplenishLiquidityInstruction({ ...maker.controlCommon,
    expectedAuthority: 1n, expectedDepth: 1n, sides: 3 })], [owner]);
  assert.equal((await maker.registrationState()).depthEpoch, 2n);
  await rejected('reject replayed depth epoch', [sdk.getReplenishLiquidityInstruction({ ...maker.controlCommon,
    expectedAuthority: 1n, expectedDepth: 1n, sides: 3 })], [owner], 6112);
  await h.send('authority quarantines without module dependency', [sdk.getQuarantineLiquidityInstruction({ ...common,
    authority: payer, market: maker.market, registration: maker.registration, capital: maker.capital, expectedAuthority: 1n })]);
  assert.equal((await maker.registrationState()).quarantined, true);
  await rejected('quarantined maker cannot replenish', [sdk.getReplenishLiquidityInstruction({ ...maker.controlCommon,
    expectedAuthority: 2n, expectedDepth: 2n, sides: 3 })], [owner], 6112);
  await h.send('joint code approval invalidates old publication', [sdk.getApproveLiquidityInstruction({ ...maker.controlCommon,
    coSigner: payer, expectedAuthority: 2n })], [owner]);
  assert.equal((await maker.registrationState()).quarantined, false);
  assert.equal((await maker.registrationState()).authorityEpoch, 3n);
  await rejected('approval requires fresh price', [await maker.request(0, 1n)], [], 6003);
  await maker.publish();
  await h.quote('approved freshly published quote', await maker.request(0, 3n), 317n);
  current = await maker.state();
  await h.send('owner disables maker without erasing capital', [sdk.getControlLiquidityInstruction({ ...maker.controlCommon,
    expectedAuthority: 3n, expectedControl: current.controlEpoch, expectedShape: current.shapeEpoch,
    action: { __kind: 'Mode', mode: 0 } })], [owner]);
  await rejected('disabled maker cannot quote', [await maker.request(0, 1n)], [], 6003);
  current = await maker.state();
  await h.send('owner re-enables with a new control epoch', [sdk.getControlLiquidityInstruction({ ...maker.controlCommon,
    expectedAuthority: 3n, expectedControl: current.controlEpoch, expectedShape: current.shapeEpoch,
    action: { __kind: 'Mode', mode: 1 } })], [owner]);
  await rejected('re-enable requires a new publication', [await maker.request(0, 1n)], [], 6003);
  await maker.publish();
  await h.quote('re-enabled freshly published quote', await maker.request(0, 3n), 317n);
  current = await maker.state();
  await rejected('non-owner cannot change maker permissions', [sdk.getControlLiquidityInstruction({ ...maker.controlCommon,
    actor: updater, expectedAuthority: 3n, expectedControl: current.controlEpoch, expectedShape: current.shapeEpoch,
    action: { __kind: 'Mode', mode: 0 } })], [updater], 6102);
  await maker.publish();
  await rejected('quote quantity overflow is rejected', [await maker.request(0, (1n<<64n)-1n)], [], 6003);
  const aliasQuote = await maker.request(0, 1n);
  await rejected('quote cannot substitute another price account', [{ ...aliasQuote, accounts: [aliasQuote.accounts[0],
    { ...aliasQuote.accounts[1], address: instances[1].price }] }], [], 2006);
  await h.send('owner revokes delegated publisher', [sdk.getControlLiquidityInstruction({ ...maker.controlCommon,
    expectedAuthority: 3n, expectedControl: current.controlEpoch, expectedShape: current.shapeEpoch,
    action: { __kind: 'Updater', updater: address('11111111111111111111111111111111'), expirySlot: 0n } })], [owner]);
  current = await maker.state();
  const publication = maker.module.getMakerPriceDecoder().decode((await h.read(maker.price))!).state;
  await rejected('revoked publisher cannot refresh price', [maker.module.getRepriceInstruction({ ...maker.makerCommon, actor: updater,
    expectedControl: current.controlEpoch, expectedSequence: publication.sequence, anchor: 100n })], [updater], 6003);
  await maker.publish();
  await rejected('reordered price sequence cannot overwrite owner update', [maker.module.getRepriceInstruction({ ...maker.makerCommon, actor: owner,
    expectedControl: current.controlEpoch, expectedSequence: publication.sequence, anchor: 100n })], [owner], 6003);
  if (h.elapseSeconds) await h.elapseSeconds(7);
  else await delay(7_000);
  await rejected('expired publication cannot quote', [await maker.request(0, 1n)], [], 6003);
  const balances = await Promise.all(instances.map(async item => sdk.getMarginAccountDecoder().decode((await h.read(item.capital))!)));
  assert(balances.every(root => root.cash === 1_000_000n && root.positions.every(position => position.lots === 0n)));
  assert.equal(sdk.getCustodyDecoder().decode((await h.read(custody))!).totalCash, 6_000_000n);
  assert.equal(getTokenDecoder().decode((await h.read(vault))!).amount, 6_000_000n);
  return { venue, custody, safety, vault, tracked, markets, registrations: instances.map(item => item.registration),
    makerAccounts: instances.map(item => ({ program: item.pricingProgram, config: item.config, price: item.price })),
    cashAtoms: '6000000', financialTradingActivated: false };
}
