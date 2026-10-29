import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AccountRole, getAddressEncoder, type Address, type Instruction } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { accountTradingSetup, type AccountTradingHarness } from './account-trading-setup.js';
import { liquidityExecutionSetup } from './liquidity-execution-setup.js';
import { executionTestHelpers } from './liquidity-execution-helpers.js';
import { goldenShape, type CanonicalHarness } from './canonical-maker-cases.js';
import { ORACLE_FIXTURE } from './oracle-fixture.js';
import type { WireRpc } from './wire.js';
import type { Profile } from './liquidity-continuation-model.js';

export function comparisonShape(profile: Profile, instance: number): sdk.makerA.ShapeV4Args {
  const regions = instance === 0 ? [{ endLots: 512n, offset: 10n, slope: 1n }]
    : instance === 2 ? [{ endLots: 256n, offset: 30n, slope: 0n }, { endLots: 4096n, offset: 30n, slope: 1n }]
    : [{ endLots: 4096n, offset: 20n, slope: 1n }];
  const padded = [...regions, ...Array.from({ length: 8 - regions.length }, () => ({ endLots: 0n, offset: 0n, slope: 0n }))];
  const cap = profile === 'control' && instance === 1 ? 0n : 100_000n;
  return { ...goldenShape, ttlSlots: 150, target: 0n, skewStep: 64n, skewTick: profile === 'treatment' ? 4n : 0n,
    longCap: cap, shortCap: cap, bidCount: regions.length, askCount: regions.length, bids: padded, asks: padded };
}

export async function continuationSetup(h: CanonicalHarness, rpc: WireRpc, profile: Profile) {
  const now = async () => (await h.read(sdk.ACCOUNT_CLOCK))!.readBigInt64LE(32);
  const slot = async () => (await h.read(sdk.ACCOUNT_CLOCK))!.readBigUInt64LE(0);
  const advance = async (seconds: bigint) => { const target = await now() + seconds, deadline = Date.now() + 20_000;
    while (await now() < target) { assert(Date.now() < deadline); await delay(50); } };
  const baseline = profile === 'baseline' ? await accountTradingSetup({ ...h, now, slot, advance, clockMode: 'realtime',
    quote: async () => { throw new Error('No quote-only provisioning'); } } satisfies AccountTradingHarness,
    { qualifyPrimitives: false, domainLabel: 'rivalt/p32/continuation/2902', makerDuration: 3600n }) : undefined;
  const canonical = profile !== 'baseline' ? await liquidityExecutionSetup(h, rpc, {
    shape: instance => comparisonShape(profile, instance), makerCash: 500_000_000n }) : undefined;
  const setup = (canonical ?? baseline)!;
  const trader = canonical ? canonical.roots[1] : baseline!.operators[0].capital[0];
  const owner = canonical ? canonical.traderOwner : baseline!.owner;
  const identity = { venue: setup.venue, mint: setup.mint.address, domain: setup.domain.toString('hex') };
  const read = () => canonical ? sdk.readLiquidityTradeSnapshot(rpc, identity, trader, 0)
    : sdk.readAccountTradeSnapshot(rpc, identity, trader, 0);
  const sourceFeeds = canonical ? canonical.feeds : baseline!.feeds.map(feed => ({ ...feed, authority: feed.signer }));
  const encoder = getAddressEncoder();
  async function sources() {
    const time = await now(), signers = [...new Map(sourceFeeds.map(feed => [feed.authority.address, feed.authority])).values()];
    const instructions = sourceFeeds.map(({ index, feed, authority }): Instruction => {
      const data = Buffer.alloc(69); createHash('sha256').update('global:publish').digest().subarray(0, 8).copy(data);
      data.set(encoder.encode(ORACLE_FIXTURE), 8); data[40] = 2;
      data.writeBigInt64LE([0, 2].includes(index) ? 60_000_000_000n : [4, 5].includes(index) ? 3_000_000_000n : 1_000_000n, 41);
      data.writeBigUInt64LE(0n, 49); data.writeInt32LE(-6, 57); data.writeBigInt64LE(time, 61);
      return { programAddress: ORACLE_FIXTURE, accounts: [{ address: authority.address, role: AccountRole.READONLY_SIGNER },
        { address: feed, role: AccountRole.WRITABLE }], data };
    });
    await h.send('continuation source update', instructions, signers);
  }
  let repricesAfterConsumption = 0;
  async function reprice(tick: number) {
    if (!canonical) return;
    const before = await Promise.all(canonical.instances.map(maker => maker.registrationState()));
    const instructions = await Promise.all(canonical.instances.map(async (maker, index) => {
      const config = await maker.state(), price = maker.module.getMakerPriceV4Decoder().decode((await h.read(maker.price))!).state;
      return maker.module.getRepriceV4Instruction({ ...maker.makerCommon, actor: canonical.updater,
        expectedControl: config.controlEpoch, expectedSequence: price.sequence,
        anchor: (index < 3 ? 60_000n : 30_000n) + (profile === 'treatment' ? (tick % 2 === 0 ? -1n : 1n) : 0n) });
    }));
    await h.send('continuation reprice batch', instructions, [canonical.updater]);
    // Trading may increment consumption concurrently. It can never decrease on
    // a reprice; structural controls run on this same updater loop.
    const after = await Promise.all(canonical.instances.map(maker => maker.registrationState()));
    before.forEach((state, index) => {
      assert.equal(after[index].depthEpoch, state.depthEpoch);
      assert(after[index].buyConsumed >= state.buyConsumed && after[index].sellConsumed >= state.sellConsumed);
    });
    if (before.some(state => state.buyConsumed + state.sellConsumed > 0n)) repricesAfterConsumption++;
  }
  async function funding() {
    if (canonical) {
      const instructions: Instruction[] = [];
      for (const index of [0, 1] as const) {
        const market = await canonical.marketState(index);
        if (await now() < market.oracle.sampledAt + 2n) continue;
        const input = await sdk.readFundingReport(rpc, canonical.venue, index);
        instructions.push(sdk.getPublishFundingReportV4Instruction({ ...canonical.common, ...input.instructionAccounts,
          publisher: canonical.updater, report: input.report }));
      }
      if (instructions.length) await h.send('continuation publisher reports', instructions, [canonical.updater]);
    } else for (const index of [0, 1]) {
      const market = await baseline!.marketState(index);
      if (await now() >= market.oracle.sampledAt + 2n) await h.send('continuation legacy funding sample',
        [sdk.getSampleAccountOracleV3Instruction(baseline!.sampleAccounts(index))]);
    }
  }
  async function quarantine(recover: boolean) {
    if (canonical) {
      const maker = canonical.instances[0], registration = await maker.registrationState();
      await h.send(recover ? 'continuation joint maker recovery' : 'continuation quarantine', [recover
        ? sdk.getApproveLiquidityV4Instruction({ ...maker.controlCommon, coSigner: canonical.payer, expectedAuthority: registration.authorityEpoch })
        : sdk.getQuarantineLiquidityV4Instruction({ ...canonical.common, authority: canonical.payer,
          market: maker.market, registration: maker.registration, capital: maker.capital, expectedAuthority: registration.authorityEpoch })],
      recover ? [canonical.owner] : []);
    } else {
      const maker = baseline!.makers[0][0];
      await h.send(recover ? 'continuation joint maker recovery' : 'continuation quarantine', [sdk.getUpdateAccountMakerV3Instruction({
        ...maker, actor: recover ? maker.owner : baseline!.payer, coSigner: recover ? baseline!.payer : undefined, operation: recover ? 0 : 2 })],
      recover ? [maker.owner] : []);
    }
  }
  if (baseline) {
    const [resolution] = await sdk.findVenueComponentV3Pda(setup.venue, 'resolution');
    const [work] = await sdk.findVenueComponentV3Pda(setup.venue, 'resolution-work');
    const common = { ...setup.common, authority: setup.payer, payer: setup.payer, btc: setup.markets[0], eth: setup.markets[1], resolution, work };
    await h.send('precreate baseline safety header', [sdk.getInitializeAccountResolutionV3Instruction(common)]);
    for (let pageIndex = 0; pageIndex < 32; pageIndex++) {
      const [page] = await sdk.findResolutionPageV3Pda(setup.venue, pageIndex);
      await h.send('precreate baseline safety page', [sdk.getInitializeAccountResolutionPageV3Instruction({ ...common, page, pageIndex })]);
    }
    for (let round = 0; round < 4; round++) { await advance(2n); await sources(); await funding(); }
    await h.send('activate baseline qualified safety profile', [sdk.getActivateAccountsV3Instruction(common)]);
    for (let round = 0; round < 4; round++) { await advance(2n); await sources(); await funding(); }
  }
  async function strictEpochs() {
    if (!canonical) return 0;
    const helpers = executionTestHelpers(h, canonical), maker = canonical.instances[0];
    for (let index = 0; index < 20; index++) {
      const prepared = await helpers.route({ trader, actor: owner, marketIndex: 0, side: 0, makers: [maker], lots: [1n] });
      const registration = await maker.registrationState();
      await h.send('supplement explicit replenish', [sdk.getReplenishLiquidityV4Instruction({ ...maker.controlCommon,
        expectedAuthority: registration.authorityEpoch, expectedDepth: registration.depthEpoch, sides: 3 })], [canonical.owner]);
      const keys: Address[] = [trader, maker.capital, maker.registration, canonical.custody, canonical.markets[0], canonical.ledgers[0]];
      const before: (Buffer | null)[] = await Promise.all(keys.map(h.read));
      await h.send('supplement stale structural route', [prepared], [owner], sdk.CLEARING_ERROR__MAKER_EPOCH);
      assert.deepEqual(await Promise.all(keys.map(h.read)), before, 'Strict epoch rejection is atomic');
    }
    return 20;
  }
  return { ...setup, canonical, baseline, trader, owner, identity, read, now, slot, sources, reprice, funding, quarantine, strictEpochs,
    allRoots: canonical ? [...canonical.instances.map(maker => maker.capital), ...canonical.roots] : baseline!.roots,
    repricesAfterConsumption: () => repricesAfterConsumption };
}
