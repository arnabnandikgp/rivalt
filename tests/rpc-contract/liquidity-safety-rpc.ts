// P32 affected safety qualification. No injected positions or successful events.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { Address, Instruction } from '@solana/kit';
import { findAssociatedTokenPda, getCreateAssociatedTokenInstruction, getTokenDecoder, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { openCanonicalRpcHarness } from './canonical-rpc-harness.js';
import { liquidityExecutionSetup } from './liquidity-execution-setup.js';
import { executionTestHelpers } from './liquidity-execution-helpers.js';
import { resolveLiquidityCohort } from './liquidity-resolution-cases.js';

const runDir = process.env.RIVALT_RUN_DIR!;
const { h, rpc, ws, checks, conformance, flush } = await openCanonicalRpcHarness(
  process.env.RIVALT_RPC_URL!, process.env.RIVALT_WS_URL!, runDir, {
    deferFinality: true,
    computeUnitLimit: label => label.startsWith('P32 safety') ? 1_200_000 : label.startsWith('P32 route') ? 800_000
      : label.startsWith('P32 publisher') ? 200_000 : 400_000,
    maxLoadedAccounts: label => label.startsWith('P32 publisher') ? 20
      : label.startsWith('P32 route') || label.startsWith('refresh independent') ? 32 : undefined,
  });
const serialize = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
try {
  const setup = await liquidityExecutionSetup(h, rpc);
  const { root, guard, route } = executionTestHelpers(h, setup);
  const owner = setup.traderOwner, cross = setup.roots[0], isolated = setup.roots[1];
  const common = { ...setup.common, btc: setup.markets[0], eth: setup.markets[1] };
  const registry = sdk.getVenueRegistryDecoder().decode((await h.read(setup.registry))!);
  const roots = registry.members.slice(0, registry.count);
  assert.deepEqual(roots, [...setup.instances.map(maker => maker.capital), ...setup.roots]);
  const header = async () => sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  const safety = async () => sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!);
  const [reserveDestination] = await findAssociatedTokenPda({ owner: setup.payer.address,
    mint: setup.mint.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  await h.send('create immutable test reserve destination', [getCreateAssociatedTokenInstruction({ payer: setup.payer,
    ata: reserveDestination, owner: setup.payer.address, mint: setup.mint.address })]);
  const tracked = [...new Set([...setup.tracked, ...roots, ...setup.configurations, setup.resolution, setup.work,
    ...setup.pages, reserveDestination, setup.mint.address, setup.traderToken.address])];
  const raw = async () => Object.fromEntries(await Promise.all(tracked.map(async key => [key, (await h.read(key))?.toString('base64') ?? null])));
  const reject = async (label: string, instruction: Instruction, error = sdk.CLEARING_ERROR__RESOLUTION,
    signers: typeof owner[] = []) => {
    const before = await raw();
    await h.send(label.startsWith('P32 route') ? label : `P32 safety ${label}`, [instruction], signers, error);
    assert.deepEqual(await raw(), before, `${label}: full state rollback`);
  };
  const withdraw = async (margin: Address, amount: bigint, signer = owner, token = setup.traderToken.address) =>
    sdk.getWithdrawFundedAccountInstruction({ ...common, owner: signer, margin, quoteMint: setup.mint.address,
      userToken: token, guard: await guard(margin), amount });
  const manage = async (margin: Address, operation: sdk.OrderActionArgs) => sdk.getManageAccountOrderInstruction({
    ...common, actor: owner, margin, guard: await guard(margin), marketIndex: 0, operation });
  const sendRoute = async (label: string, marketIndex: 0 | 1, trader: Address, side: 0 | 1, lots: bigint,
    options: { stored?: { id: bigint; version: bigint; filled: bigint }; reduceOnly?: boolean; generation?: bigint; pair?: boolean } = {}) => {
    const makers = options.pair ? [setup.instances[marketIndex * 3], setup.instances[marketIndex * 3 + 2]] : [setup.instances[marketIndex * 3]];
    const instruction = await route({ trader, actor: options.stored ? setup.payer : owner, marketIndex, side, makers,
      lots: options.pair ? [lots / 2n, lots - lots / 2n] : [lots], ...options });
    await h.send(`P32 route ${label}`, [instruction], options.stored ? [] : [owner]);
    return instruction;
  };
  await setup.sample();
  await sendRoute('open isolated protection exposure', 0, isolated, 0, 4n);
  const staleExit = await withdraw(isolated, 1n);
  let isolatedState = await root(isolated), slot = await setup.slot();
  const protection = { side: 1, lots: 4n, limit: 50_000n, feeBudget: 500n, startSlot: slot, expirySlot: slot + 2000n,
    reduceOnly: true, generation: isolatedState.positions[0].generation };
  await h.send('protect existing canonical position', [await manage(isolated, { __kind: 'Protect',
    expectedId: isolatedState.book.lastOrderId + 1n,
    takeProfit: { ...protection, trigger: 1, threshold: 65_000n }, stopLoss: { ...protection, trigger: 2, threshold: 55_000n } })], [owner]);
  await reject('prepared exit cannot bypass new order authority', staleExit, sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE, [owner]);
  await reject('withdrawal cannot spend reserved margin', await withdraw(isolated, 980_000n), sdk.CLEARING_ERROR__ARITHMETIC, [owner]);
  await h.send('same-owner funded transfer preserves active reservations', [sdk.getTransferFundedAccountInstruction({ ...common,
    owner, donor: isolated, recipient: cross, guard: await guard(isolated), amount: 100n })], [owner]);
  await setup.sample();
  await sendRoute('manual partial close clips current protective eligibility', 0, isolated, 1, 1n,
    { reduceOnly: true, generation: protection.generation });
  assert.equal((await root(isolated)).positions[0].lots, 3n);
  assert.equal((await root(isolated)).book.protections[0].protection.remaining, 4n);
  setup.sourcePrices.btc = 54_000_000_000n;
  await setup.qualify();
  isolatedState = await root(isolated);
  const stop = isolatedState.book.orders.find(entry => entry.order.id === 2n)!.order;
  const stopped = await sendRoute('permissionless SL shares the current generation allowance', 0, isolated, 1, 2n,
    { stored: { id: stop.id, version: stop.version, filled: stop.filled } });
  assert.equal((await root(isolated)).positions[0].lots, 1n);
  assert.equal((await root(isolated)).book.protections[0].protection.remaining, 2n);
  await reject('P32 route stored stop prefix cannot replay', stopped, sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE);
  await reject('P32 route protection cannot exceed current position despite larger child and group remainders',
    await route({ trader: isolated, actor: setup.payer, marketIndex: 0, side: 1, makers: [setup.instances[0]], lots: [2n],
      stored: { id: stop.id, version: stop.version, filled: 2n } }), sdk.CLEARING_ERROR__ORDER_STATE);
  const takeProfit = (await root(isolated)).book.orders.find(entry => entry.order.id === 1n)!.order;
  await reject('P32 route TP cannot ignore its trigger', await route({ trader: isolated, actor: setup.payer, marketIndex: 0,
    side: 1, makers: [setup.instances[0]], lots: [1n], stored: { id: takeProfit.id, version: takeProfit.version, filled: takeProfit.filled } }),
    sdk.CLEARING_ERROR__ORDER_TRIGGER);
  await sendRoute('remaining protected exposure closes without flipping', 0, isolated, 1, 1n,
    { reduceOnly: true, generation: protection.generation });
  assert((await root(isolated)).book.orders.every(entry => ![1, 2].includes(entry.order.state)));

  setup.sourcePrices.btc = 60_000_000_000n;
  await setup.qualify();
  await sendRoute('reopened isolated position has a new generation', 0, isolated, 0, 2n);
  isolatedState = await root(isolated); slot = await setup.slot();
  assert(isolatedState.positions[0].generation > protection.generation);
  const newTerms = { ...protection, lots: 2n, generation: isolatedState.positions[0].generation,
    startSlot: slot, expirySlot: slot + 2000n };
  const nextOrder = isolatedState.book.lastOrderId + 1n;
  await h.send('protect reopened generation with distinct durable identity', [await manage(isolated, { __kind: 'Protect', expectedId: nextOrder,
    takeProfit: { ...newTerms, trigger: 1, threshold: 65_000n }, stopLoss: { ...newTerms, trigger: 2, threshold: 55_000n } })], [owner]);
  setup.sourcePrices.btc = 66_000_000_000n;
  await setup.qualify();
  await sendRoute('permissionless TP closes only its new generation', 0, isolated, 1, 2n,
    { stored: { id: nextOrder, version: 1n, filled: 0n } });
  assert.equal((await root(isolated)).positions[0].lots, 0n);

  setup.sourcePrices.btc = 60_000_000_000n;
  await setup.qualify();
  await sendRoute('open two-program cross BTC default cohort', 0, cross, 0, 50n, { pair: true });
  await setup.sample();
  await sendRoute('open cross ETH with whole-account funding', 1, cross, 0, 50n, { pair: true });
  await h.send('withdraw admissible funded cash before price stress', [await withdraw(cross, 400_100n)], [owner]);
  await h.send('seed explicit ten-atom ETH insurance', [sdk.getSeedMarketInsuranceInstruction({ ...common,
    reserveAuthority: setup.payer, ledger: setup.ledgers[1], donor: owner, donorToken: setup.traderToken.address, quoteMint: setup.mint.address,
    marketIndex: 1, amount: 10n })], [owner]);
  for (const margin of [cross, isolated]) {
    for (let index = 0; index < 4; index++) {
      await setup.sample();
      const state = await root(margin), slot = await setup.slot();
      await h.send('populate liquidation target and receiver live books', [await manage(margin, { __kind: 'Place',
        expectedId: state.book.lastOrderId + 1n, terms: { side: 0, lots: 1n, limit: 66_000n, feeBudget: 1000n,
          startSlot: slot, expirySlot: slot + 2000n, trigger: 0, threshold: 0n, reduceOnly: false, generation: 0n } })], [owner]);
    }
  }
  setup.sourcePrices.btc = 52_000_000_000n;
  await setup.qualify();
  const liquidate = async (price = 52_000n, lots = 10n) => sdk.getLiquidateAccountInstruction({ ...common,
    target: cross, receiver: isolated, receiverOwner: owner, targetGuard: await guard(cross), receiverGuard: await guard(isolated),
    marketIndex: 0, lots, price });
  await reject('liquidation rejects post-fee deficit worsening', await liquidate(46_800n), sdk.CLEARING_ERROR__ARITHMETIC, [owner]);
  await reject('liquidation cannot flip target', await liquidate(52_000n, 51n), sdk.CLEARING_ERROR__ARITHMETIC, [owner]);
  const liquidation = await liquidate(), beforeLiquidation = await raw();
  await h.send('P32 safety whole-account liquidation with live receiver reservations', [liquidation], [owner]);
  const afterLiquidation = await raw();
  assert.equal((await root(cross)).positions[0].lots, 40n);
  assert.equal((await root(isolated)).positions[0].lots, 10n);
  assert.equal((await root(cross)).reserved, 0n);
  assert((await root(isolated)).reserved > 0n);
  await reject('liquidation cannot replay either root guard', liquidation, sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE, [owner]);
  const sources = { primaryBtc: setup.feeds[0].feed, primaryCollateral: setup.feeds[1].feed,
    guardBtc: setup.feeds[2].feed, guardCollateral: setup.feeds[3].feed, primaryEth: setup.feeds[4].feed, guardEth: setup.feeds[5].feed };
  const freeze = async () => sdk.getFreezeAccountsInstruction({ ...setup.safetyCommon, ...sources, caller: setup.payer,
    target: cross, safetyEpoch: (await safety()).epoch, resolutionEpoch: (await header()).epoch, emergency: false });
  const staleTerminalExit = await withdraw(roots[0], 100n, setup.owner, setup.token.address);
  setup.sourcePrices.btc = 40_000_000_000n; setup.sourcePrices.eth = 2_000_000_000n;
  await setup.fresh();
  await h.send('P32 safety permissionless bankrupt cross account freezes complete cohort', [await freeze()]);
  await reject('frozen venue cannot accept cash mutations', await sdk.getDepositAccountInstructionAsync({ ...setup.common,
    owner, margin: cross, quoteMint: setup.mint.address, userToken: setup.traderToken.address, amount: 1n }), sdk.CLEARING_ERROR__PROFILE, [owner]);
  const frozenAccounts = await raw();
  const resolution = await resolveLiquidityCohort(h, setup, roots, reject);
  const completedAccounts = await raw();
  await reject('pre-default funded exit cannot replay after resolution', staleTerminalExit, sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE, [setup.owner]);
  // The shared progress watchdog bounds each wait to20 seconds. Observe actual
  // Clock advancement in three segments while allowing the sources to go stale.
  for (let segment = 0; segment < 3; segment++) await setup.waitUntil(await setup.now() + 10n);
  const tokensBefore = getTokenDecoder().decode((await h.read(setup.token.address))!).amount;
  await h.send('P32 safety resolved cash exits with stale sources', [await withdraw(roots[0], 100n, setup.owner, setup.token.address)], [setup.owner]);
  assert.equal(getTokenDecoder().decode((await h.read(setup.token.address))!).amount, tokensBefore + 100n);
  assert.equal((await root(roots[0])).cash, resolution.plannedCash[0] - 100n);
  const resolvedAccounts = await raw();
  const capture = { scenario: 'two-market-resolved', venue: setup.venue, custody: setup.custody, safety: setup.safety,
    registry: setup.registry, vault: setup.vault, mint: setup.mint.address, userTokens: [setup.token.address, setup.traderToken.address],
    reserveDestination, resolution: setup.resolution, work: setup.work, pages: setup.pages, roots, markets: setup.markets, ledgers: setup.ledgers,
    liquidationSteps: [{ target: cross, receiver: isolated, lots: 10n, price: 52_000n, before: beforeLiquidation, after: afterLiquidation }],
    frozenAccounts, completedAccounts, resolvedAccounts, rawAccounts: resolvedAccounts };
  writeFileSync(`${runDir}/financial-capture.json`, serialize(capture));
  execFileSync('python3', ['tests/financial/account-safety-reference.py', `${runDir}/financial-capture.json`], { stdio: 'inherit' });

  const recover = (resume: boolean) => sdk.getRecoverAccountsInstruction({ ...setup.safetyCommon, ...sources,
    caller: setup.payer, epoch: resolution.initial.epoch, resume });
  const reactivate = () => sdk.getReactivateAccountsInstruction({ ...setup.safetyCommon, ...sources,
    caller: setup.payer, epoch: resolution.initial.epoch });
  await reject('resolution does not bypass sustained source recovery', recover(true));
  await h.send('P32 safety stale source recovery grants no credit', [recover(false)]);
  assert.equal((await safety()).recoverySince, 0n);
  setup.sourcePrices.btc = 60_000_000_000n; setup.sourcePrices.eth = 3_000_000_000n;
  for (let round = 0; round < 4; round++) {
    await setup.waitUntil(await setup.now() + 2n); await setup.fresh();
    await h.send('P32 safety sustained independent source recovery', [recover(false)]);
  }
  await h.send('P32 safety explicit recovery returns only to custody', [recover(true)]);
  assert.equal((await safety()).mode, 0); assert.equal((await header()).stage, 12);
  await reject('reactivation still needs fresh complete maker qualification', reactivate(), sdk.CLEARING_ERROR__ORACLE_POLICY);
  await setup.qualify();
  await h.send('P32 safety explicit reactivation after source and publisher qualification', [reactivate()]);
  assert.equal((await safety()).mode, 1);
  await reject('reactivation cannot replay', reactivate());
  await flush();
  const parity = await conformance.finish(runDir, [
    { program: sdk.CLEARING_PROGRAM_ADDRESS, name: 'marginAccount', key: cross },
    { program: sdk.CLEARING_PROGRAM_ADDRESS, name: 'resolution', key: setup.resolution },
  ], h.read);
  writeFileSync(`${runDir}/summary.json`, serialize({ revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    trackedDirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() !== '',
    build: JSON.parse(readFileSync('.local/liquidity-execution/build-manifest.json', 'utf8')), checks, parity,
    resolution, financialCapture: 'financial-capture.json', recoveredAccounts: await raw(), phaseAcceptance: false }));
  console.log(`P32 scoped safety: ${checks.length} finalized outcomes. PostgreSQL/continuation acceptance remains open.`);
} finally { try { await flush(); } finally { ws.close(); } }
