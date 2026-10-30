// P39 focused baseline: signed current-artifact actions, fetched RPC/WS receipts
// and actual compiled lock sets. This does not measure validator scheduling/TPS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import type { Instruction } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { openCanonicalRpcHarness } from '../rpc-contract/canonical-rpc-harness.js';
import { liquidityExecutionSetup } from '../rpc-contract/liquidity-execution-setup.js';
import { executionTestHelpers } from '../rpc-contract/liquidity-execution-helpers.js';
import { conflicts, instructionLocks, transactionLocks, type LockSet } from './lock-model.js';

const runDir = process.env.RIVALT_RUN_DIR!;
const json = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
const runtime = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!, process.env.RIVALT_WS_URL!, runDir, {
  deferFinality: true, computeUnitLimit: label => label.startsWith('P39 trade') ? 800_000 : 400_000,
});
const { h, rpc, ws, flush, checks, conformance } = runtime;
const declared = new Map<string, LockSet>(), send = h.send.bind(h);
h.send = async (label, instructions, signers = [], expectedError) => {
  if (label.startsWith('P39 ')) {
    assert(!declared.has(label), 'Unique case identity');
    declared.set(label, instructionLocks(instructions));
  }
  return send(label, instructions, signers, expectedError);
};
try {
  const setup = await liquidityExecutionSetup(h, rpc, { verifyRejections: false });
  const helper = executionTestHelpers(h, setup), owner = setup.traderOwner;
  const feeTotals = [0n, 0n];
  let firstRoute: Instruction | undefined;
  for (const [name, marketIndex, rootIndex, makerIndices] of [
    ['btc-single', 0, 0, [0]], ['eth-single', 1, 0, [3]], ['isolated-single', 0, 1, [1]],
    ['btc-pair-shared-program', 0, 0, [0, 1]], ['btc-pair-distinct-programs', 0, 0, [0, 2]],
  ] as const) {
    await setup.sample();
    const trader = setup.roots[rootIndex], before = await helper.root(trader);
    const instruction = await helper.route({ trader, actor: owner, marketIndex, side: 0,
      makers: makerIndices.map(index => setup.instances[index]), lots: makerIndices.map(() => 1n) });
    await h.send(`P39 trade ${name}`, [instruction], [owner]);
    firstRoute ??= instruction;
    // Literal one-region fixed-price fixture; independent of the allocator/core.
    const quantity = BigInt(makerIndices.length), gross = quantity * (marketIndex === 0 ? 60_003n : 30_003n);
    const fee = (gross * 2n + 9_999n) / 10_000n;
    const after = await helper.root(trader);
    assert.equal(after.cash, before.cash - fee);
    assert.equal(after.positions[marketIndex].lots, before.positions[marketIndex].lots + quantity);
    feeTotals[marketIndex] += fee;
  }
  assert(firstRoute);
  const watched = [...setup.tracked, ...setup.roots, ...setup.configurations];
  const beforeReplay = await Promise.all(watched.map(h.read));
  await h.send('P39 trade stale-account-rejection', [firstRoute], [owner], sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE);
  assert.deepEqual(await Promise.all(watched.map(h.read)), beforeReplay, 'Rejected replay must preserve economic bytes');

  await setup.sample();
  const orderRoot = setup.roots[1], orderAccounts = { ...setup.common, actor: owner,
    btc: setup.markets[0], eth: setup.markets[1], margin: orderRoot };
  const startSlot = await setup.slot();
  await h.send('P39 order place', [sdk.getManageAccountOrderInstruction({ ...orderAccounts,
    guard: await helper.guard(orderRoot), marketIndex: 0, operation: { __kind: 'Place', expectedId: 1n,
      terms: { side: 0, lots: 1n, limit: 66_000n, feeBudget: 1_000n, startSlot, expirySlot: startSlot + 200n,
        trigger: 0, threshold: 0n, reduceOnly: false, generation: 0n } } })], [owner]);
  await h.send('P39 order cancel', [sdk.getManageAccountOrderInstruction({ ...orderAccounts,
    guard: await helper.guard(orderRoot), marketIndex: 0,
    operation: { __kind: 'Cancel', id: 1n, version: 1n, protectionGroup: false } })], [owner]);
  for (const index of [0, 1]) {
    const maker = setup.instances[index], config = await maker.state();
    const price = maker.module.getMakerPriceDecoder().decode((await h.read(maker.price))!).state;
    await h.send(`P39 reprice ${index}`, [maker.module.getRepriceInstruction({ ...maker.makerCommon, actor: setup.updater,
      expectedControl: config.controlEpoch, expectedSequence: price.sequence, anchor: 60_000n })], [setup.updater]);
  }
  // Separate, not batched, publisher receipts for the two market access sets.
  await setup.waitUntil((await setup.marketState(0)).oracle.sampledAt + 2n);
  await setup.fresh();
  for (const marketIndex of [0, 1] as const) {
    const input = await sdk.readFundingReport(rpc, setup.venue, marketIndex);
    assert.equal(input.report.outcome, 0);
    await h.send(`P39 funding ${marketIndex}`, [sdk.getPublishFundingReportInstruction({ ...setup.common,
      ...input.instructionAccounts, publisher: setup.updater, report: input.report })], [setup.updater]);
  }
  await flush();
  const roots = await Promise.all([...setup.instances.map(maker => maker.capital), ...setup.roots].map(helper.root));
  const markets = await Promise.all([0, 1].map(setup.marketState));
  const ledgers = await Promise.all(setup.ledgers.map(async key => sdk.getMarketLedgerDecoder().decode((await h.read(key))!)));
  for (const marketIndex of [0, 1]) {
    assert.equal(roots.reduce((sum, root) => sum + root.positions[marketIndex].lots, 0n), 0n);
    assert.equal(roots.reduce((sum, root) => { const position = root.positions[marketIndex];
      return sum + position.virtualScaled - position.lots * (markets[marketIndex].fundingIndexScaled - position.fundingCheckpointScaled);
    }, 0n), 0n);
    assert.equal(ledgers[marketIndex].insurance, feeTotals[marketIndex] / 4n);
    assert.equal(ledgers[marketIndex].fees, feeTotals[marketIndex] - feeTotals[marketIndex] / 4n);
    assert.equal(ledgers[marketIndex].insuranceFeeRemainder, Number(feeTotals[marketIndex] % 4n));
  }
  const custody = sdk.getCustodyDecoder().decode((await h.read(setup.custody))!);
  assert.equal(roots.reduce((sum, root) => sum + root.cash, 0n), custody.totalCash);
  assert.equal(custody.totalCash + feeTotals[0] + feeTotals[1], 8_000_000n);

  const samples = checks.flatMap((check, index) => {
    const label = String(check.label), protocol = declared.get(label);
    if (!protocol) return [];
    const saved = JSON.parse(readFileSync(`${runDir}/wire-${index}.json`, 'utf8'));
    const wire = Buffer.from(saved.wireBase64, 'base64'), compiled = transactionLocks(wire);
    for (const key of protocol.write) assert(compiled.write.includes(key), 'Compiled message lost required write');
    for (const key of protocol.read) assert([...compiled.read, ...compiled.write].includes(key), 'Compiled message lost required read');
    return [{ label, receipt: `transaction-${index}.json`, ...check, protocol, compiled,
      wireSha256: createHash('sha256').update(wire).digest('hex') }];
  });
  const byLabel = (label: string) => { const sample = samples.find(sample => sample.label === label); assert(sample); return sample; };
  const pairs = [
    ['P39 trade btc-single', 'P39 trade eth-single', true],
    ['P39 trade btc-single', 'P39 trade isolated-single', true],
    ['P39 order cancel', 'P39 trade btc-single', true],
    ['P39 funding 0', 'P39 funding 1', true],
    ['P39 reprice 0', 'P39 reprice 1', false],
    ['P39 reprice 0', 'P39 trade btc-single', true],
    ['P39 reprice 0', 'P39 trade isolated-single', false],
  ] as const;
  const accessChecks = pairs.map(([left, right, expected]) => {
    const protocol = conflicts(byLabel(left).protocol, byLabel(right).protocol);
    assert.equal(protocol.length > 0, expected, `${left} / ${right}`);
    return { left, right, protocol, compiled: conflicts(byLabel(left).compiled, byLabel(right).compiled) };
  });
  const parity = await conformance.finish(runDir, [], h.read);
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const build = JSON.parse(readFileSync('.local/liquidity-execution/build-manifest.json', 'utf8'));
  const summary = { schema: 1, revision,
    trackedDirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() !== '',
    build, runtime: await rpc.call('getVersion'), genesis: await rpc.call('getGenesisHash'),
    scope: 'Focused fresh RPC/WS resources and access conflicts; no throughput, PG, full instruction or phase-44 claim',
    samples, accessChecks, parity, independentFinancialCheck: { feeTotals, custodyCash: custody.totalCash, roots: roots.length },
    setupOutcomes: checks.length - samples.length, checks };
  writeFileSync(`${runDir}/performance.json`, json(summary));
  console.log(`P39: ${samples.length} focused signed outcomes; ${accessChecks.length} actual access-set comparisons; complete fee/cash/claim reconciliation.`);
} finally { try { await flush(); } finally { ws.close(); } }
