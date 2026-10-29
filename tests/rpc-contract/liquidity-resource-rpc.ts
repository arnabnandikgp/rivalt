// P32 full eight-region / full order-and-protection-book resource gate.
// All positions, reservations and cash come from actual signed instructions.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { Address, Instruction } from '@solana/kit';
import { getMintToInstruction } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { goldenShape } from './canonical-maker-cases.js';
import { openCanonicalRpcHarness } from './canonical-rpc-harness.js';
import { liquidityExecutionSetup } from './liquidity-execution-setup.js';

const runDir = process.env.RIVALT_RUN_DIR!;
const { h, rpc, ws, checks, conformance, flush } = await openCanonicalRpcHarness(
  process.env.RIVALT_RPC_URL!, process.env.RIVALT_WS_URL!, runDir, {
    deferFinality: true,
    computeUnitLimit: label => label.startsWith('P32 route') ? 800_000 : label.startsWith('P32 publisher') ? 200_000 : 400_000,
    maxLoadedAccounts: label => label.startsWith('P32 publisher') ? 20
      : label.startsWith('P32 route') || label.startsWith('refresh independent') ? 32 : undefined,
  });
const serialize = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
try {
  const regions = (offset: bigint) => Array.from({ length: 8 }, (_, index) => ({
    endLots: index === 7 ? 4096n : BigInt((index + 1) * 256),
    offset: offset + BigInt(index * 256), slope: index === 0 ? 0n : 1n,
  }));
  const shape = { ...goldenShape, skewStep: 512n, skewTick: 2n, longCap: 4096n, shortCap: 4096n,
    bidCount: 8, askCount: 8, bids: regions(2n), asks: regions(3n) };
  const setup = await liquidityExecutionSetup(h, rpc, { shape });
  const trader = setup.roots[0], owner = setup.traderOwner;
  const [first, second, empty] = [setup.instances[0], setup.instances[2], setup.instances[1]];
  const rootState = async (key: Address) => sdk.getMarginAccountV3Decoder().decode((await h.read(key))!);
  const guard = async (key: Address) => {
    const root = await rootState(key);
    return { safetyEpoch: sdk.getSafetyV3Decoder().decode((await h.read(setup.safety))!).epoch,
      venueTermsEpoch: sdk.getVenueV3Decoder().decode((await h.read(setup.venue))!).termsEpoch,
      nonce: root.nonce, stateVersion: root.stateVersion };
  };
  const route = async (makers: typeof setup.instances, lots: bigint[], side: 0 | 1 = 0) => {
    const [one, two] = makers, current = await setup.marketState(0), slot = await setup.slot();
    return sdk.getExecuteLiquidityRouteV4InstructionAsync({ ...setup.common, actor: owner,
      market: setup.markets[0], otherMarket: setup.markets[1], ledger: setup.ledgers[0], otherLedger: setup.ledgers[1], trader,
      registry: one.liquidityRegistry, firstCapital: one.capital, firstRegistration: one.registration,
      firstProgram: one.pricingProgram, firstProgramData: one.controlCommon.programData, firstConfig: one.config, firstPrice: one.price,
      secondCapital: two?.capital ?? null, secondRegistration: two?.registration ?? null, secondProgram: two?.pricingProgram ?? null,
      secondProgramData: two?.controlCommon.programData ?? null, secondConfig: two?.config ?? null, secondPrice: two?.price ?? null,
      guard: await guard(trader), domain: setup.domain, termsEpoch: current.termsEpoch, configEpoch: current.configEpoch,
      startSlot: slot, expirySlot: slot + 100n, side, lots: lots.reduce((total, quantity) => total + quantity, 0n),
      allInLimit: side === 0 ? 1_000_000_000n : 0n, maxFee: 200_000n, reduceOnly: false, generation: null,
      legs: await Promise.all(makers.map(async (maker, index) => {
        const registration = await maker.registrationState(), config = await maker.state();
        return { lots: lots[index], authorityEpoch: registration.authorityEpoch, controlEpoch: config.controlEpoch,
          shapeEpoch: config.shapeEpoch, depthEpoch: registration.depthEpoch };
      })),
    });
  };
  const watched = [...setup.tracked, ...setup.roots, ...setup.configurations];
  const bytes = () => Promise.all(watched.map(h.read));
  const reject = async (label: string, instruction: Instruction, error: number) => {
    const before = await bytes();
    await h.send(`P32 route ${label}`, [instruction], [owner], error);
    assert.deepEqual(await bytes(), before, `${label}: failed route changed committed state`);
  };
  await h.send('mint additional valueless resource-test collateral', [
    getMintToInstruction({ mint: setup.mint.address, token: setup.token.address, mintAuthority: setup.payer, amount: 200_000_000n }),
    getMintToInstruction({ mint: setup.mint.address, token: setup.traderToken.address, mintAuthority: setup.payer, amount: 100_000_000n }),
  ]);
  for (const margin of [first.capital, second.capital, trader]) {
    const signer = margin === trader ? owner : setup.owner;
    await h.send('deposit actual resource-test collateral', [await sdk.getDepositAccountV3InstructionAsync({ ...setup.common,
      owner: signer, margin, quoteMint: setup.mint.address,
      userToken: margin === trader ? setup.traderToken.address : setup.token.address, amount: 100_000_000n })], [signer]);
  }
  await setup.sample();
  await h.send('P32 route seed positions for maximum live protection books', [await route([first, second], [2n, 2n])], [owner]);
  assert.equal((await rootState(trader)).cash, 100_999_951n);
  for (const margin of [trader, first.capital, second.capital]) {
    const signer = margin === trader ? owner : setup.owner;
    for (let group = 0; group < 2; group++) {
      await setup.sample();
      const root = await rootState(margin), position = root.positions[0], slot = await setup.slot();
      const isLong = position.lots > 0n;
      const terms = { side: isLong ? 1 : 0, lots: isLong ? 2n : 1n, limit: isLong ? 54_000n : 66_000n,
        feeBudget: isLong ? 40n : 20n, startSlot: slot, expirySlot: slot + 2000n,
        reduceOnly: true, generation: position.generation };
      await h.send('populate all live order and protection slots', [sdk.getManageAccountOrderV3Instruction({ ...setup.common,
        actor: signer, btc: setup.markets[0], eth: setup.markets[1], margin, guard: await guard(margin), marketIndex: 0,
        operation: { __kind: 'Protect', expectedId: root.book.lastOrderId + 1n,
          takeProfit: { ...terms, trigger: isLong ? 1 : 2, threshold: isLong ? 70_000n : 50_000n },
          stopLoss: { ...terms, trigger: isLong ? 2 : 1, threshold: isLong ? 50_000n : 70_000n } } })], [signer]);
    }
    const root = await rootState(margin);
    assert.equal(root.book.orders.filter(entry => [1, 2].includes(entry.order.state)).length, 4);
    assert.equal(root.book.protections.filter(entry => entry.protection.remaining > 0n).length, 2);
  }
  await setup.sample();
  await h.send('withdraw unused provider funded cash through actual SPL exit', [sdk.getWithdrawFundedAccountV3Instruction({
    ...setup.common, owner: setup.owner, btc: setup.markets[0], eth: setup.markets[1], margin: empty.capital,
    quoteMint: setup.mint.address, userToken: setup.token.address, guard: await guard(empty.capital), amount: 1_000_000n })], [setup.owner]);
  assert.equal((await rootState(empty.capital)).cash, 0n);
  await setup.fresh();
  await reject('unfunded second maker rolls back funded first maker and every book',
    await route([first, empty], [1n, 1n]), sdk.CLEARING_ERROR__ROUTE_HEALTH);

  await setup.sample();
  // Literal independent per-lot sum: j=2..4095, ask spread 3 for j<256,
  // otherwise 3+j; skew 2*floor(j/512). No SDK/program pricing is used here.
  let expectedPerLeg = 0n;
  for (let index = 2n; index < 4096n; index++) {
    expectedPerLeg += 60_000n + 3n + (index < 256n ? 0n : index) + 2n * (index / 512n);
  }
  const expectedGross = expectedPerLeg * 2n, expectedFee = (expectedGross + 4999n) / 5000n;
  const cashBefore = (await rootState(trader)).cash;
  await h.send('P32 route maximum depth eight regions and three full books', [await route([first, second], [4094n, 4094n])], [owner]);
  assert.equal((await rootState(trader)).cash, cashBefore - expectedFee);
  assert.equal((await rootState(trader)).positions[0].lots, 8192n);
  for (const maker of [first, second]) {
    assert.equal((await rootState(maker.capital)).positions[0].lots, -4096n);
    assert.equal((await maker.registrationState()).buyConsumed, 4096n);
  }
  for (const margin of [trader, first.capital, second.capital]) {
    const root = await rootState(margin);
    assert.equal(root.book.orders.filter(entry => [1, 2].includes(entry.order.state)).length, 4);
    assert.equal(root.book.protections.filter(entry => entry.protection.remaining > 0n).length, 2);
  }
  const registrationBefore = await first.registrationState();
  await first.publish(setup.updater, 60_001n);
  assert.deepEqual(await first.registrationState(), registrationBefore, 'reprice cannot replenish consumed depth');

  await setup.sample();
  // The sell side still has all4096 lots. This exercises maximum single-leg
  // depth and target approach with full books before generation cleanup.
  let expectedSell = 0n;
  for (let index = 0n; index < 4096n; index++) {
    expectedSell += 60_000n - 2n - (index < 256n ? 0n : index) + 2n * ((4095n - index) / 512n);
  }
  const sellFee = (expectedSell + 4999n) / 5000n;
  await h.send('P32 route maximum singleton full books with skew target approach', [await route([first], [4096n], 1)], [owner]);
  assert.equal((await rootState(first.capital)).positions[0].lots, 0n);
  assert.equal((await first.registrationState()).sellConsumed, 4096n);
  assert.equal((await rootState(trader)).positions[0].lots, 4096n);
  const prepared = await route([second], [1n], 1);
  const secondRegistration = await second.registrationState();
  await h.send('explicit replenishment changes structural depth epoch', [sdk.getReplenishLiquidityV4Instruction({
    ...second.controlCommon, expectedAuthority: secondRegistration.authorityEpoch,
    expectedDepth: secondRegistration.depthEpoch, sides: 2 })], [setup.owner]);
  await reject('prepared order cannot cross structural depth change', prepared, sdk.CLEARING_ERROR__MAKER_EPOCH);

  await flush();
  const allRoots = await Promise.all([...setup.instances.map(maker => maker.capital), ...setup.roots].map(rootState));
  const markets = await Promise.all([0, 1].map(setup.marketState));
  for (const index of [0, 1]) {
    assert.equal(allRoots.reduce((total, root) => total + root.positions[index].lots, 0n), 0n);
    assert.equal(allRoots.reduce((total, root) => { const position = root.positions[index];
      return total + position.virtualScaled - position.lots * (markets[index].fundingIndexScaled - position.fundingCheckpointScaled);
    }, 0n), 0n);
  }
  const totalFees = 49n + expectedFee + sellFee;
  const ledgers = await Promise.all(setup.ledgers.map(async key => sdk.getMarketLedgerV3Decoder().decode((await h.read(key))!)));
  assert.deepEqual(ledgers.map(ledger => [ledger.insurance, ledger.fees, ledger.insuranceFeeRemainder]),
    [[totalFees / 4n, totalFees - totalFees / 4n, Number(totalFees % 4n)], [0n, 0n, 0]]);
  const custody = sdk.getCustodyV3Decoder().decode((await h.read(setup.custody))!);
  assert.equal(allRoots.reduce((total, root) => total + root.cash, 0n), custody.totalCash);
  assert.equal(custody.totalCash + totalFees, 307_000_000n);
  const parity = await conformance.finish(runDir, [
    { program: sdk.CLEARING_PROGRAM_ADDRESS, name: 'marginAccountV3', key: trader },
    { program: sdk.CLEARING_PROGRAM_ADDRESS, name: 'makerRegistrationV4', key: first.registration },
  ], h.read);
  writeFileSync(`${runDir}/summary.json`, serialize({ revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    trackedDirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() !== '',
    build: JSON.parse(readFileSync('.local/liquidity-execution/build-manifest.json', 'utf8')), checks, parity,
    expectedPerLeg, expectedGross, expectedFee, expectedSell, sellFee, totalFees, allRoots, markets, ledgers, custody,
    fullBooks: true, fullRegions: true, phaseAcceptance: false }));
  console.log(`P32 full-book resource probe: ${checks.length} finalized outcomes. Full safety/PG/continuation acceptance remains open.`);
} finally { try { await flush(); } finally { ws.close(); } }
