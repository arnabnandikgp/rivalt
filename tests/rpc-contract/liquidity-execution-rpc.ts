// Scoped P32 real route/order resource probe. Full safety/PG/continuation gates
// are separate; this script never claims them from successful immediate trades.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { Instruction } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { openCanonicalRpcHarness } from './canonical-rpc-harness.js';
import { liquidityExecutionSetup } from './liquidity-execution-setup.js';

const runDir = process.env.RIVALT_RUN_DIR!;
const runtime = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!, process.env.RIVALT_WS_URL!, runDir, {
  computeUnitLimit: label => label.startsWith('P32 route') ? 800_000 : label.startsWith('P32 publisher') ? 200_000 : 400_000,
  maxLoadedAccounts: label => label.startsWith('P32 route') ? 32 : label.startsWith('P32 publisher') ? 20 : undefined,
});
const { h, rpc, ws, checks, conformance } = runtime;
const serialize = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
try {
  const setup = await liquidityExecutionSetup(h, rpc);
  const root = setup.roots[0], owner = setup.traderOwner;
  const state = async (key = root) => sdk.getMarginAccountV3Decoder().decode((await h.read(key))!);
  const watched = [...setup.tracked, ...setup.roots, ...setup.configurations];
  const bytes = () => Promise.all(watched.map(h.read));
  const rejected = async (label: string, instruction: Instruction, error: number) => {
    const before = await bytes();
    await h.send(`P32 route ${label}`, [instruction], [owner], error);
    assert.deepEqual(await bytes(), before, `${label}: reverted transaction mutated economic state`);
  };
  const build = async (side: 0 | 1, lots: bigint, marketIndex: 0 | 1 = 0, trader = root) => {
    const snapshot = await setup.snapshot(trader, marketIndex);
    const built = await sdk.buildLiquidityRoute({ snapshot, trader, marketIndex, side, lots,
      allInLimit: side === 0 ? 1_000_000n : 0n, maxFee: 1_000n }, owner.address);
    assert(built, 'financially executable canonical allocation');
    return built;
  };
  await setup.fresh();
  const singleton = await build(0, 1n);
  assert.equal(singleton.allocation.grossQuote, 60_003n);
  await h.send('P32 route one-maker current-price fill', singleton.instructions, [owner]);
  assert.equal((await state()).cash, 999_987n);
  assert.equal((await state()).positions[0].lots, 1n);
  assert.equal((await setup.instances[0].registrationState()).buyConsumed, 1n);
  await rejected('replay cannot consume twice', singleton.instructions[0], sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE);

  // Sign/bind the existing epochs before repricing. Publication sequence is not
  // transaction authority; the later price must remain within signed limits.
  const repriced = await build(0, 1n);
  const selected = setup.instances.find(maker => maker.registration === repriced.allocation.legs[0].registration)!;
  await selected.publish(setup.updater, 60_004n);
  await h.send('P32 route accepts newer price within original limit', repriced.instructions, [owner]);
  assert.equal((await state()).cash, 999_974n);
  assert.equal((await state()).positions[0].lots, 2n);
  assert.equal((await selected.registrationState()).buyConsumed, 2n);

  await setup.sample();
  const snapshot = await setup.snapshot();
  const [first, second] = [setup.instances[0], setup.instances[2]];
  const pair = await sdk.getExecuteLiquidityRouteV4InstructionAsync({ ...setup.common, actor: owner,
    market: setup.markets[0], otherMarket: setup.markets[1], ledger: setup.ledgers[0], otherLedger: setup.ledgers[1], trader: root,
    registry: first.liquidityRegistry, firstCapital: first.capital, firstRegistration: first.registration,
    firstProgram: first.pricingProgram, firstProgramData: first.controlCommon.programData, firstConfig: first.config, firstPrice: first.price,
    secondCapital: second.capital, secondRegistration: second.registration, secondProgram: second.pricingProgram,
    secondProgramData: second.controlCommon.programData, secondConfig: second.config, secondPrice: second.price,
    guard: sdk.accountGuard(snapshot, root), domain: setup.domain, termsEpoch: snapshot.marketStates[0].termsEpoch,
    configEpoch: snapshot.marketStates[0].configEpoch, startSlot: snapshot.slot, expirySlot: snapshot.slot + 100n,
    side: 0, lots: 2n, allInLimit: 120_031n, maxFee: 25n, reduceOnly: false, generation: null,
    legs: await Promise.all([first, second].map(async maker => {
      const registration = await maker.registrationState(), config = await maker.state();
      return { lots: 1n, authorityEpoch: registration.authorityEpoch, controlEpoch: config.controlEpoch,
        shapeEpoch: config.shapeEpoch, depthEpoch: registration.depthEpoch };
    })),
  });
  await h.send('P32 route two distinct programs atomic fill', [pair], [owner]);
  assert.equal((await state()).positions[0].lots, 4n);
  assert.equal((await state()).cash, 999_949n);
  assert.equal((await first.registrationState()).buyConsumed, 3n);
  assert.equal((await second.registrationState()).buyConsumed, 1n);

  await setup.sample();
  const eth = await build(0, 1n, 1);
  assert.equal(eth.allocation.grossQuote, 30_003n);
  await h.send('P32 route second market whole-account funding', eth.instructions, [owner]);
  assert.equal((await state()).positions[1].lots, 1n);
  assert.equal((await state()).cash, 999_942n);

  await setup.sample();
  let orderSnapshot = await setup.snapshot(setup.roots[1]);
  const orderAccounts = { ...setup.common, actor: owner, btc: setup.markets[0], eth: setup.markets[1], margin: setup.roots[1] };
  await h.send('place isolated durable order with reservations', [sdk.getManageAccountOrderV3Instruction({ ...orderAccounts,
    guard: sdk.accountGuard(orderSnapshot, setup.roots[1]), marketIndex: 0, operation: { __kind: 'Place', expectedId: 1n,
      terms: { side: 0, lots: 2n, limit: 61_000n, feeBudget: 25n, startSlot: orderSnapshot.slot,
        expirySlot: orderSnapshot.slot + 500n, trigger: 0, threshold: 0n, reduceOnly: false, generation: 0n } } })], [owner]);
  assert((await state(setup.roots[1])).reserved > 0n);
  for (const filled of [0n, 1n]) {
    await setup.fresh(); orderSnapshot = await setup.snapshot(setup.roots[1]);
    const built = await sdk.buildLiquidityRoute({ snapshot: orderSnapshot, trader: setup.roots[1], marketIndex: 0,
      side: 0, lots: 1n, allInLimit: 61_000n, maxFee: 25n, stored: { id: 1n, version: 1n, filled } }, setup.payer.address);
    assert(built);
    await h.send('P32 route permissionless stored subfill', built.instructions);
    assert.equal((await state(setup.roots[1])).cash, filled === 0n ? 999_987n : 999_975n);
  }
  const completedOrder = await state(setup.roots[1]);
  assert.equal(completedOrder.reserved, 0n);
  assert.equal(completedOrder.book.orders[0].order.notional, 120_006n);
  assert.equal(completedOrder.book.orders[0].order.feeCharged, 25n);

  const allRoots = await Promise.all([...setup.roots, ...setup.instances.map(maker => maker.capital)].map(state));
  const markets = await Promise.all([0, 1].map(setup.marketState));
  for (const index of [0, 1]) {
    assert.equal(allRoots.reduce((total, margin) => total + margin.positions[index].lots, 0n), 0n);
    // Independently bring every claim to the same funded-index checkpoint.
    assert.equal(allRoots.reduce((total, margin) => {
      const position = margin.positions[index];
      return total + position.virtualScaled - position.lots * (markets[index].fundingIndexScaled - position.fundingCheckpointScaled);
    }, 0n), 0n);
  }
  const ledgers = await Promise.all(setup.ledgers.map(async key => sdk.getMarketLedgerV3Decoder().decode((await h.read(key))!)));
  assert.deepEqual(ledgers.map(ledger => [ledger.insurance, ledger.fees, ledger.insuranceFeeRemainder]), [[19n, 57n, 0], [1n, 6n, 3]]);
  const custody = sdk.getCustodyV3Decoder().decode((await h.read(setup.custody))!);
  assert.equal(allRoots.reduce((total, margin) => total + margin.cash, 0n), custody.totalCash);
  assert.equal(custody.totalCash + 83n, 8_000_000n);
  const parity = await conformance.finish(runDir, [
    { program: sdk.CLEARING_PROGRAM_ADDRESS, name: 'marginAccountV3', key: root },
    { program: sdk.CLEARING_PROGRAM_ADDRESS, name: 'makerRegistrationV4', key: first.registration },
  ], h.read);
  writeFileSync(`${runDir}/summary.json`, serialize({ revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    trackedDirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() !== '',
    build: JSON.parse(readFileSync('.local/liquidity-execution/build-manifest.json', 'utf8')), checks, parity,
    allRoots, markets, ledgers, custody, financialTradingActivated: true, phaseAcceptance: false }));
  console.log(`P32 scoped execution: ${checks.length} signed RPC/WS outcomes. Full safety/PG/continuation acceptance remains open.`);
} finally { ws.close(); }
