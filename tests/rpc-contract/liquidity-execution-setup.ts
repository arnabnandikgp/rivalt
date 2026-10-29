// Fresh signed profile4 provisioning. No injected financial state or retained
// acceptance dump is used as a deployment configuration.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { address, AccountRole, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction } from '@solana/kit';
import { getCreateAccountInstruction, getTransferSolInstruction } from '@solana-program/system';
import { TOKEN_PROGRAM_ADDRESS, getInitializeAccount3Instruction, getMintToInstruction } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { provisionCanonicalMakers, goldenShape, type CanonicalHarness } from './canonical-maker-cases.js';
import { fixtureKey } from './custody-cases.js';
import { ORACLE_FIXTURE } from './oracle-fixture.js';
import type { WireRpc } from './wire.js';

const encoder = getAddressEncoder();
const discriminator = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
export async function liquidityExecutionSetup(h: CanonicalHarness, rpc: WireRpc,
  options: { shape?: sdk.makerA.ShapeV4Args | ((instance: number) => sdk.makerA.ShapeV4Args); makerCash?: bigint } = {}) {
  const region = (offset: bigint) => [{ endLots: 4096n, offset, slope: 0n },
    ...Array.from({ length: 7 }, () => ({ endLots: 0n, offset: 0n, slope: 0n }))];
  const shape = { ...goldenShape, skewTick: 0n, longCap: 4096n, shortCap: 4096n,
    bidCount: 1, askCount: 1, bids: region(2n), asks: region(3n) };
  const fixture = await provisionCanonicalMakers(h, options.shape ?? shape, [0, 1], options.makerCash);
  const { payer, common, markets, instances, venue } = fixture;
  const now = async () => (await h.read(sdk.ACCOUNT_CLOCK))!.readBigInt64LE(32);
  const slot = async () => (await h.read(sdk.ACCOUNT_CLOCK))!.readBigUInt64LE(0);
  const waitUntil = async (time: bigint) => {
    const deadline = Date.now() + 20_000;
    while (await now() < time) { assert(Date.now() < deadline, 'Clock progress'); await delay(100); }
  };
  const marketState = async (index: number) => sdk.getMarketV3Decoder().decode((await h.read(markets[index]))!);
  // Signed test oracle values, independently converted to each market's lot
  // units. Mutating these inputs never injects account state or funding indexes.
  const sourcePrices = { btc: 60_000_000_000n, eth: 3_000_000_000n };
  const primary = await fixtureKey('p32-primary'), guard = await fixtureKey('p32-guard');
  const traderOwner = await fixtureKey('p32-trader'), traderToken = await fixtureKey('p32-trader-token');
  await h.send('fund local test participants', [primary, guard, traderOwner].map(signer => getTransferSolInstruction({
    source: payer, destination: signer.address, amount: 1_000_000_000n })));
  await h.send('mint test trader collateral', [getCreateAccountInstruction({ payer, newAccount: traderToken,
    lamports: await h.rent(165), space: 165n, programAddress: TOKEN_PROGRAM_ADDRESS }),
    getInitializeAccount3Instruction({ account: traderToken.address, mint: fixture.mint.address, owner: traderOwner.address }),
    getMintToInstruction({ mint: fixture.mint.address, token: traderToken.address, mintAuthority: payer, amount: 2_000_000n })], [traderToken]);
  const [portfolio] = await sdk.deriveAccountPortfolio(venue, traderOwner.address, 0);
  await h.send('create test trader portfolio', [await sdk.getCreatePortfolioV3InstructionAsync({
    ...common, owner: traderOwner, portfolio, index: 0 })], [traderOwner]);
  const roots: Address[] = [];
  for (const subaccountIndex of [0, 1]) {
    const [margin] = await sdk.findMarginV3Pda(portfolio, subaccountIndex);
    await h.send('register cross or isolated test root', [await sdk.getRegisterMarginV3InstructionAsync({ ...common,
      owner: traderOwner, portfolio, margin, subaccountIndex, mode: subaccountIndex === 0 ? 0 : 1,
      isolatedMarketIndex: subaccountIndex === 0 ? 255 : 0, role: 0 })], [traderOwner]);
    await h.send('deposit actual test trader collateral', [await sdk.getDepositAccountV3InstructionAsync({ ...common,
      owner: traderOwner, margin, quoteMint: fixture.mint.address, userToken: traderToken.address, amount: 1_000_000n })], [traderOwner]);
    roots.push(margin);
  }
  const feeds: { index: number; feed: Address; authority: typeof primary }[] = [];
  for (let index = 0; index < 6; index++) {
    const authority = [0, 1, 4].includes(index) ? primary : guard, id = Buffer.alloc(32, index + 1);
    const [feed] = await getProgramDerivedAddress({ programAddress: ORACLE_FIXTURE,
      seeds: [Buffer.from('feed'), encoder.encode(authority.address), id] });
    await h.send('initialize test source', [{ programAddress: ORACLE_FIXTURE, accounts: [
      { address: authority.address, role: AccountRole.WRITABLE_SIGNER }, { address: feed, role: AccountRole.WRITABLE },
      { address: address('11111111111111111111111111111111'), role: AccountRole.READONLY }],
      data: Buffer.concat([discriminator('initialize'), id]) }], [authority]);
    feeds.push({ index, feed, authority });
  }
  const configurations = [];
  for (const index of [0, 1]) {
    await h.send('initialize canonical source bindings', [sdk.getInitializeLiquidityOracleV4Instruction({ ...common,
      authority: payer, market: markets[index], primary: primary.address, guard: guard.address })]);
    const [configuration] = await sdk.findFundingPublisherV4Pda({ market: markets[index] });
    await h.send('P32 publisher initialize', [sdk.getInitializeFundingPublisherV4Instruction({ ...common, authority: payer,
      market: markets[index], registry: instances[index * 3].liquidityRegistry, configuration, publisher: fixture.updater.address })]);
    configurations.push(configuration);
  }
  const [resolution] = await sdk.findVenueComponentV3Pda(venue, 'resolution');
  const [work] = await sdk.findVenueComponentV3Pda(venue, 'resolution-work');
  const safetyCommon = { ...common, authority: payer, payer, btc: markets[0], eth: markets[1], resolution, work };
  await h.send('precreate complete resolution header and work', [sdk.getInitializeAccountResolutionV3Instruction(safetyCommon)]);
  await h.send('activation rejects incomplete safety storage', [sdk.getActivateLiquidityV4Instruction(safetyCommon)], [], sdk.CLEARING_ERROR__RESOLUTION);
  const pages = [];
  for (let pageIndex = 0; pageIndex < 32; pageIndex++) {
    const [page] = await sdk.findResolutionPageV3Pda(venue, pageIndex);
    await h.send('precreate complete safety page', [sdk.getInitializeAccountResolutionPageV3Instruction({ ...safetyCommon, page, pageIndex })]);
    pages.push(page);
  }
  async function fresh() {
    const time = await now();
    const sourceInstructions: Instruction[] = feeds.map(({ index, feed, authority }) => {
      const data = Buffer.alloc(69); discriminator('publish').copy(data);
      data.set(encoder.encode(ORACLE_FIXTURE), 8); data[40] = 2;
      data.writeBigInt64LE([0, 2].includes(index) ? sourcePrices.btc : [4, 5].includes(index) ? sourcePrices.eth : 1_000_000n, 41);
      data.writeBigUInt64LE(0n, 49); data.writeInt32LE(-6, 57); data.writeBigInt64LE(time, 61);
      return { programAddress: ORACLE_FIXTURE, accounts: [{ address: authority.address, role: AccountRole.READONLY_SIGNER },
        { address: feed, role: AccountRole.WRITABLE }], data };
    });
    const reprices = await Promise.all(instances.map(async (maker, index) => {
      const config = await maker.state(), price = maker.module.getMakerPriceV4Decoder().decode((await h.read(maker.price))!).state;
      return maker.module.getRepriceV4Instruction({ ...maker.makerCommon, actor: fixture.updater,
        expectedControl: config.controlEpoch, expectedSequence: price.sequence,
        anchor: index < 3 ? sourcePrices.btc / 1_000_000n : sourcePrices.eth / 100_000n });
    }));
    await h.send('refresh independent sources and six maker publications', [...sourceInstructions, ...reprices], [primary, guard, fixture.updater]);
  }
  async function sample() {
    const previous = await Promise.all([0, 1].map(marketState));
    await waitUntil(previous.reduce((latest, market) => market.oracle.sampledAt > latest ? market.oracle.sampledAt : latest, 0n) + 2n);
    await fresh();
    const reports: Instruction[] = [];
    for (const index of [0, 1] as const) {
      const input = await sdk.readFundingReport(rpc, venue, index);
      assert.equal(input.report.outcome, 0, input.coverageReason ?? 'available complete publication');
      const reference = index === 0 ? sourcePrices.btc / 1_000_000n : sourcePrices.eth / 100_000n;
      assert.equal(input.report.referencePrice, reference);
      assert.equal(input.report.quantity, (6_000_000n + reference - 1n) / reference);
      reports.push(sdk.getPublishFundingReportV4Instruction({ ...common,
        ...input.instructionAccounts, publisher: fixture.updater, report: input.report }));
    }
    await h.send('P32 publisher available two-market reports', reports, [fixture.updater]);
  }
  const qualify = async () => { for (let round = 0; round < 4; round++) await sample(); };
  await qualify();
  await h.send('legacy activation rejects canonical profile', [sdk.getActivateAccountsV3Instruction(safetyCommon)], [], sdk.CLEARING_ERROR__PROFILE);
  await h.send('activate storage-ready canonical candidate', [sdk.getActivateLiquidityV4Instruction(safetyCommon)]);
  await h.send('canonical activation cannot replay', [sdk.getActivateLiquidityV4Instruction(safetyCommon)], [], sdk.CLEARING_ERROR__PROFILE);
  await qualify();
  const identity = { venue, mint: fixture.mint.address, domain: fixture.domain.toString('hex') };
  const snapshot = (root = roots[0], marketIndex: 0 | 1 = 0) => sdk.readLiquidityTradeSnapshot(rpc, identity, root, marketIndex);
  return { ...fixture, primary, guard, traderOwner, traderToken, roots, feeds, configurations, resolution, work, pages,
    safetyCommon, sourcePrices, now, slot, waitUntil, marketState, fresh, sample, qualify, identity, snapshot };
}
