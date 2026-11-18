// D114 timing on the qualified local deployment. All six price publications
// use the signed fixture. All exposure comes from a real margined maker fill.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import type { Address } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import * as sdk from '@rivalt/sdk';
import { json } from '../../packages/indexer/src/events.js';
import { transactionLocks } from '../performance/lock-model.js';
import { verifyBackingBuild } from './backing-artifacts.js';
import { openCanonicalRpcHarness } from './canonical-rpc-harness.js';
import { fixtureKey } from './harness.js';
import { executionTestHelpers } from './liquidity-execution-helpers.js';
import { liquidityExecutionSetup } from './liquidity-execution-setup.js';
import { openSettlementJournal } from './scalable-settlement-journal.js';

const mode = process.env.RIVALT_FREEZE_DELIVERY ?? 'atomic';
assert(mode === 'atomic' || mode === 'split', 'Expected atomic or split delivery');
const directory = process.env.RIVALT_RUN_DIR!;
const build = verifyBackingBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!);
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(), '');
const keeper = await fixtureKey('freeze-cutoff-keeper');
const broadcastAt = new Map<string, number>();
const confirmedAt = new Map<string, number>();
const measured = (label: string) => label.startsWith('cutoff ');
const { h, rpc, ws, flush, checks } = await openCanonicalRpcHarness(
  process.env.RIVALT_RPC_URL!, process.env.RIVALT_WS_URL!, directory, {
    deferFinality: true,
    payerFor: label => measured(label) ? keeper : undefined,
    computeUnitLimit: label => measured(label) ? 200_000 : 800_000,
    beforeBroadcast: async label => { if (measured(label)) broadcastAt.set(label, performance.now()); },
  },
);

try {
  const setup = await liquidityExecutionSetup(h, rpc, { verifyRejections: false });
  const { route, root } = executionTestHelpers(h, setup);
  const [debtor, healthy] = setup.roots;
  const [primaryBtc, primaryCollateral, guardBtc, guardCollateral, primaryEth, guardEth] = setup.feeds.map(item => item.feed);
  const safety = async () => sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!);
  const resolution = async () => sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  await h.send('fund permissionless keeper', [getTransferSolInstruction({
    source: setup.payer, destination: keeper.address, amount: 1_000_000n,
  })]);
  await setup.sample();
  await h.send('open funded BTC long', [await route({
    trader: debtor, actor: setup.traderOwner, marketIndex: 0, side: 0, makers: [setup.instances[0]], lots: [60n],
  })], [setup.traderOwner]);
  const debtorState = await root(debtor);
  assert.equal(debtorState.positions[0].lots, 60n);
  assert.equal(debtorState.positions[1].lots, 0n);
  const beforeSafety = await safety();
  const beforeResolution = await resolution();
  const registry = sdk.getVenueRegistryDecoder().decode((await h.read(setup.registry))!);
  const freeze = async (target: Address) => sdk.getFreezeAccountsInstruction({
    ...setup.safetyCommon, primaryBtc, primaryCollateral, guardBtc, guardCollateral, primaryEth, guardEth,
    caller: keeper, target, members: (await sdk.deriveMemberPage(setup.venue, (await root(target)).id / 64n))[0],
    safetyEpoch: beforeSafety.epoch, resolutionEpoch: beforeResolution.epoch, emergency: false,
  });
  const send: typeof h.send = async (label, instructions, signers, error) => {
    await h.send(label, instructions, signers, error);
    confirmedAt.set(label, performance.now());
  };
  const publishers = [setup.primary, setup.guard];
  setup.sourcePrices.btc = 40_000_000_000n; // 40,000 atoms/lot, down from 60,000.
  const updates = () => setup.sourceInstructions();
  if (mode === 'atomic') {
    const healthyProof = await freeze(healthy);
    // Check all source/clearing writes apart from the keeper's transaction fee.
    const keys = [...new Set([...setup.feeds.map(item => item.feed),
      ...healthyProof.accounts.filter(meta => meta.role & 1).map(meta => meta.address)])];
    const snapshot = () => Promise.all(keys.map(h.read));
    const before = await snapshot();
    await send('cutoff reject healthy witness', [...await updates(), healthyProof], publishers, sdk.CLEARING_ERROR__RESOLUTION);
    assert.deepEqual(await snapshot(), before);
  }
  const proof = await freeze(debtor);
  const started = performance.now();
  if (mode === 'atomic') {
    await send('cutoff update and freeze', [...await updates(), proof], publishers);
  } else {
    await send('cutoff publish sources', await updates(), publishers);
    assert.deepEqual(await safety(), beforeSafety);
    assert.deepEqual(await resolution(), beforeResolution);
    await send('cutoff freeze on published sources', [proof]);
  }
  const elapsedMs = performance.now() - started;
  const frozen = await resolution();
  assert.equal(frozen.stage, 2); // Value
  assert.equal(frozen.epoch, beforeResolution.epoch + 1n);
  assert.equal((await safety()).epoch, beforeSafety.epoch + 1n);
  assert.equal(frozen.safetyEpoch, (await safety()).epoch);
  assert.equal((await safety()).mode, 2); // Frozen
  assert.equal(frozen.count, 8n);
  assert.equal(frozen.count, registry.financialCount);
  assert.equal(frozen.membershipEpoch, registry.membershipEpoch);
  assert.equal(frozen.liveIndex, registry.liveIndex);
  assert.equal(frozen.prices[0], 40_000n);
  const markets = await Promise.all([setup.marketState(0), setup.marketState(1)]);
  assert.deepEqual(frozen.funding, markets.map(market => market.fundingIndexScaled));
  const scaledEquity = (price: bigint) => {
    const position = debtorState.positions[0];
    return (debtorState.cash + position.lots * price) * 1_000_000_000n + position.virtualScaled
      - position.lots * (frozen.funding[0] - position.fundingCheckpointScaled);
  };
  assert(scaledEquity(60_000n) > 0n && scaledEquity(40_000n) < 0n);
  await flush();
  const metrics = checks.flatMap((check, index) => {
    const label = String(check.label);
    if (!measured(label)) return [];
    const wire = JSON.parse(readFileSync(`${directory}/wire-${index}.json`, 'utf8'));
    const receipt = JSON.parse(readFileSync(`${directory}/transaction-${index}.json`, 'utf8'));
    if (label === 'cutoff reject healthy witness') {
      assert.deepEqual(receipt.meta.err.InstructionError, [
        receipt.transaction.message.instructions.length - 1, { Custom: sdk.CLEARING_ERROR__RESOLUTION },
      ]);
    }
    const locks = transactionLocks(Buffer.from(wire.wireBase64, 'base64'));
    return [{ ...check, slot: receipt.slot, locks, broadcastToObservedConfirmationMs: confirmedAt.get(label)! - broadcastAt.get(label)! }];
  });
  const journal = await openSettlementJournal(rpc, setup, checks.map(check => String(check.signature)));
  try {
    await journal.checkpoint('freeze-cutoff');
    const replay = await journal.finish();
    writeFileSync(`${directory}/freeze-cutoff.json`, json({
      revision, build: build.revision, mode, frozen, metrics, buildThroughObservedConfirmationMs: elapsedMs,
      ordinaryEquityScaled: scaledEquity(60_000n), adverseEquityScaled: scaledEquity(40_000n), replayEvents: replay.events,
    }));
  } finally { await journal.close(); }
} finally { try { await flush(); } finally { ws.close(); } }
