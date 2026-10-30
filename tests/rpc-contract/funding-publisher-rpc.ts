// Scoped D76 publisher resource/authority probe, not full P32 trading acceptance.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { address } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import * as sdk from '@rivalt/sdk';
import { provisionCanonicalMakers, goldenShape } from './canonical-maker-cases.js';
import { openCanonicalRpcHarness } from './canonical-rpc-harness.js';
import { feedAddress, initializeFeed, publishFeed } from './oracle-fixture.js';

const runDir = process.env.RIVALT_RUN_DIR!;
const { rpc, ws, h, checks, conformance } = await openCanonicalRpcHarness(
  process.env.RIVALT_RPC_URL!, process.env.RIVALT_WS_URL!, runDir, {
    computeUnitLimit: label => label.startsWith('P32 publisher') ? 200_000 : 400_000,
    maxLoadedAccounts: label => label.startsWith('P32 publisher') ? 20 : undefined,
  });
const serialize = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
const now = async () => (await h.read(sdk.ACCOUNT_CLOCK))!.readBigInt64LE(32);
const waitUntil = async (time: bigint) => {
  const deadline = Date.now() + 20_000;
  while (await now() < time) { assert(Date.now() < deadline, 'Clock progress'); await delay(100); }
};
try {
  const shape = { ...goldenShape, skewStep: 512n, skewTick: 2n, longCap: 4096n, shortCap: 4096n, bidCount: 8, askCount: 8,
    bids: Array.from({ length: 8 }, (_, index) => ({ endLots: BigInt((index + 1) * 512), offset: BigInt(1 + 2 * index), slope: 0n })),
    asks: Array.from({ length: 8 }, (_, index) => ({ endLots: BigInt((index + 1) * 512), offset: BigInt(3 + 2 * index), slope: 0n })) };
  const fixture = await provisionCanonicalMakers(h, shape, [0]);
  const makers = fixture.instances.slice(0, 3), sources = await Promise.all([0, 1, 2, 3].map(feedAddress));
  const authorities = [sources[0].authority, sources[2].authority];
  await h.send('fund controlled local sources', authorities.map(authority => getTransferSolInstruction({
    source: fixture.payer, destination: authority.address, amount: 100_000_000n })));
  for (const [index, source] of sources.entries()) await h.send(`initialize source ${index}`, [await initializeFeed(index)], [source.authority]);
  await h.send('initialize profile4 source bindings', [sdk.getInitializeLiquidityOracleInstruction({
    ...fixture.common, authority: fixture.payer, market: fixture.markets[0], primary: authorities[0].address, guard: authorities[1].address })]);
  const [configuration] = await sdk.findFundingPublisherPda({ market: fixture.markets[0] });
  const administration = { ...fixture.common, authority: fixture.payer, market: fixture.markets[0], configuration };
  await h.send('P32 publisher initialize', [sdk.getInitializeFundingPublisherInstruction({
    ...administration, registry: makers[0].liquidityRegistry, publisher: fixture.updater.address })]);
  const marketState = async () => sdk.getMarketDecoder().decode((await h.read(fixture.markets[0]))!);
  const publisherState = async () => sdk.getFundingPublisherDecoder().decode((await h.read(configuration))!);
  const makerKeys = makers.flatMap(maker => [maker.capital, maker.registration, maker.config, maker.price]);
  const unchangedKeys = [...makerKeys, fixture.markets[0], configuration, fixture.custody];
  const readAll = (keys = unchangedKeys) => Promise.all(keys.map(h.read));
  const beforeDisabled = await readAll();
  await h.send('retired sampler discriminator cannot bypass publisher', [{programAddress:sdk.CLEARING_PROGRAM_ADDRESS,accounts:[],data:Buffer.from([9,149,124,151,174,246,56,42])}], [], 101);
  assert.deepEqual(await readAll(), beforeDisabled);
  const observations: unknown[] = [];
  let publisher = fixture.updater;
  async function fresh(anchor: bigint, count = 3) {
    const time = await now();
    await h.send('fresh independent source observations', await Promise.all(sources.map((_, index) =>
      publishFeed(index, time, { price: index % 2 === 0 ? anchor * 1_000_000n : 1_000_000n }))), authorities);
    const instructions = await Promise.all(makers.slice(0, count).map(async maker => {
      const config = await maker.state(), price = maker.module.getMakerPriceDecoder().decode((await h.read(maker.price))!).state;
      return maker.module.getRepriceInstruction({ ...maker.makerCommon, actor: fixture.updater,
        expectedControl: config.controlEpoch, expectedSequence: price.sequence, anchor });
    }));
    await h.send('fresh bounded maker publications', instructions, [fixture.updater]);
  }
  async function snapshot() {
    await waitUntil((await marketState()).oracle.sampledAt + 2n);
    return sdk.readFundingReport(rpc, fixture.venue, 0);
  }
  function instruction(input: Awaited<ReturnType<typeof snapshot>>, report = input.report, signer = publisher) {
    return sdk.getPublishFundingReportInstruction({ ...fixture.common, ...input.instructionAccounts, publisher: signer, report });
  }
  async function rejected(label: string, input: Awaited<ReturnType<typeof snapshot>>, report: sdk.FundingReport,
    error = sdk.CLEARING_ERROR__FUNDING_REPORT, signer = publisher) {
    const before = await readAll();
    await h.send(`P32 publisher rejects ${label}`, [instruction(input, report, signer)], [signer], error);
    assert.deepEqual(await readAll(), before, `${label}: rejected report mutated state`);
  }
  async function publish(label: string, outcome: number, expected?: { quantity: bigint; bid: bigint; ask: bigint }) {
    const input = await snapshot(), before = await readAll(makerKeys);
    assert.equal(input.report.outcome, outcome, `${label}: ${input.coverageReason}`);
    if (expected) {
      assert.equal(input.report.quantity, expected.quantity);
      assert.equal(input.report.bid, expected.bid); assert.equal(input.report.ask, expected.ask);
    }
    writeFileSync(`${runDir}/publisher-input-${observations.length}.json`, serialize({ contextSlot: input.contextSlot,
      accounts: [...input.accounts], report: input.report, allocations: input.allocations, coverageReason: input.coverageReason }));
    await h.send(`P32 publisher ${label}`, [instruction(input)], [publisher]);
    assert.deepEqual(await readAll(makerKeys), before, 'funding changed maker cash/orders/depth/publications');
    const market = await marketState(), configurationState = await publisherState();
    assert.equal(configurationState.lastSequence, input.report.sequence);
    assert.equal(market.observationSequence, input.report.expectedObservationSequence + 1n);
    assert.equal(market.oracle.sampledAt >= input.report.observedTime, true);
    if (expected) {
      assert.equal(market.oracle.quantity, expected.quantity);
      assert.equal(market.oracle.bid, expected.bid); assert.equal(market.oracle.ask, expected.ask);
      assert.equal(market.oracle.premiumScaled, 1_000_000_000n);
      assert.equal(market.oracle.heldUntil, input.report.validUntilTime);
    } else assert.equal(market.oracle.quantity, 0n);
    observations.push({ label, report: input.report, market, configurationState });
    return input;
  }
  const hundred = { quantity: 100n, bid: 5_999_900n, ask: 6_000_300n };
  const sixHundred = { quantity: 600n, bid: 5_999_400n, ask: 6_001_800n };
  await fresh(60_000n);
  const first = await publish('100-lot full coverage', 0, hundred);
  await rejected('replayed sequence', first, first.report);
  await fresh(10_000n);
  await publish('600-lot two-maker optimum', 0, sixHundred);
  // Actual SPL withdrawals, not fixture cash mutations. Published liquidity is
  // unchanged by zero funded cash; actual execution admission remains separate.
  for (const maker of makers) {
    await h.send('withdraw all maker funded cash', [await sdk.getWithdrawAccountCustodyInstructionAsync({
      ...fixture.common, owner: fixture.owner, margin: maker.capital, quoteMint: fixture.mint.address,
      userToken: fixture.token.address, amount: 1_000_000n })], [fixture.owner]);
    assert.equal(sdk.getMarginAccountDecoder().decode((await h.read(maker.capital))!).cash, 0n);
  }
  await fresh(10_000n); await publish('zero-cash published depth', 0, sixHundred);
  for (const [label, mutate, error] of [
    ['foreign domain', (report: sdk.FundingReport) => ({ ...report, domain: new Uint8Array(32) }), sdk.CLEARING_ERROR__FUNDING_REPORT],
    ['foreign market', (report: sdk.FundingReport) => ({ ...report, market: fixture.markets[1] }), sdk.CLEARING_ERROR__FUNDING_REPORT],
    ['future observation', (report: sdk.FundingReport) => ({ ...report, observedTime: report.observedTime + 10n }), sdk.CLEARING_ERROR__FUNDING_REPORT],
    ['incorrect index quantity', (report: sdk.FundingReport) => ({ ...report, quantity: report.quantity - 1n }), sdk.CLEARING_ERROR__ORACLE_POLICY],
  ] as const) {
    await fresh(10_000n); const input = await snapshot();
    await rejected(label, input, mutate(input.report), error);
  }
  await fresh(10_000n);
  const oldAuthorityInput = await snapshot(), oldState = await publisherState();
  await h.send('P32 publisher rotate', [sdk.getConfigureFundingPublisherInstruction({
    ...administration, expectedAuthority: oldState.authorityEpoch, publisher: fixture.owner.address })]);
  assert.equal((await marketState()).oracle.quantity, 0n);
  await rejected('old signer after rotation', oldAuthorityInput, oldAuthorityInput.report, 2001);
  publisher = fixture.owner;
  await rejected('old epoch signed by new publisher', oldAuthorityInput, oldAuthorityInput.report);
  await fresh(10_000n); await publish('new authorized signer', 0, sixHundred);
  await h.send('P32 publisher revoke', [sdk.getConfigureFundingPublisherInstruction({
    ...administration, expectedAuthority: (await publisherState()).authorityEpoch, publisher: address('11111111111111111111111111111111') })]);
  assert.equal((await publisherState()).enabled, false);
  assert.equal((await marketState()).oracle.quantity, 0n);
  await assert.rejects(sdk.readFundingReport(rpc, fixture.venue, 0), /not authorized/);
  await h.send('P32 publisher reauthorize', [sdk.getConfigureFundingPublisherInstruction({
    ...administration, expectedAuthority: (await publisherState()).authorityEpoch, publisher: fixture.owner.address })]);
  const third = makers[2], thirdConfig = await third.state();
  await fresh(10_000n); const beforeControl = await snapshot();
  await h.send('zero-cap required input control', [sdk.getControlLiquidityInstruction({ ...third.controlCommon,
    expectedAuthority: 1n, expectedControl: thirdConfig.controlEpoch, expectedShape: thirdConfig.shapeEpoch,
    action: { __kind: 'Shape', fields: [{ ...shape, longCap: 0n, shortCap: 0n }] } })], [fixture.owner]);
  await rejected('report prepared before maker control', beforeControl, beforeControl.report);
  await fresh(10_000n); await publish('fresh zero-cap input remains covered', 0, sixHundred);
  const thirdPrice = third.module.getMakerPriceDecoder().decode((await h.read(third.price))!).state;
  await waitUntil(thirdPrice.updatedTime + 6n);
  await fresh(10_000n, 2); await publish('expired zero-cap input invalidates full coverage', 2);
  await fresh(10_000n);
  await h.send('invalidate primary verification', [await publishFeed(0, await now(), { level: 1 })], [authorities[0]]);
  await publish('invalid independent source', 1);
  for (const maker of makers.slice(0, 2)) {
    const state = await maker.state();
    await h.send('remove remaining declared capacity', [sdk.getControlLiquidityInstruction({ ...maker.controlCommon,
      expectedAuthority: 1n, expectedControl: state.controlEpoch, expectedShape: state.shapeEpoch,
      action: { __kind: 'Shape', fields: [{ ...shape, longCap: 0n, shortCap: 0n }] } })], [fixture.owner]);
  }
  await fresh(10_000n); await publish('insufficient complete published depth', 3);
  const parity = await conformance.finish(runDir, [
    { program: sdk.CLEARING_PROGRAM_ADDRESS, name: 'market', key: fixture.markets[0] },
    { program: sdk.CLEARING_PROGRAM_ADDRESS, name: 'fundingPublisher', key: configuration },
  ], h.read);
  assert.equal(sdk.getVenueSafetyDecoder().decode((await h.read(fixture.safety))!).mode, 0);
  writeFileSync(`${runDir}/summary.json`, serialize({ revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    trackedDirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() !== '',
    build: JSON.parse(readFileSync('.local/liquidity-execution/build-manifest.json', 'utf8')),
    runtime: await rpc.call('getVersion'), genesis: await rpc.call('getGenesisHash'), checks, observations, parity,
    fundingLiquidityPolicy: 'restricted-publisher-D76', financialTradingActivated: false, phaseAcceptance: false }));
  console.log(`P32 publisher probe: ${observations.length} reports, ${checks.length} signed RPC/WS outcomes. Trading disabled.`);
} finally { ws.close(); }
