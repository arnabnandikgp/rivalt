// Compare the same normal clearing entrypoints with the predecessor and extracted engine.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import type { Address, Instruction } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { json } from '../../packages/indexer/src/events.js';
import { openCanonicalRpcHarness } from './canonical-rpc-harness.js';
import { executionTestHelpers } from './liquidity-execution-helpers.js';
import { liquidityExecutionSetup } from './liquidity-execution-setup.js';
import { openSettlementJournal } from './scalable-settlement-journal.js';
import { verifyRiskBuild } from './risk-build.js';

const directory = process.env.RIVALT_RUN_DIR!;
const build = verifyRiskBuild(process.env.RIVALT_SETTLEMENT_ARTIFACT_DIR!);
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['status','--porcelain','--untracked-files=no'], { encoding: 'utf8' }).trim(), '');
const { h, rpc, ws, checks, flush } = await openCanonicalRpcHarness(
  process.env.RIVALT_RPC_URL!, process.env.RIVALT_WS_URL!, directory, { deferFinality: true, computeUnitLimit: () => 800_000 });

try {
  const setup = await liquidityExecutionSetup(h, rpc, { verifyRejections: false });
  const { route, guard, root } = executionTestHelpers(h, setup);
  const [cross, receiver] = setup.roots;
  const owner = setup.traderOwner;
  const common = { ...setup.common, btc: setup.markets[0], eth: setup.markets[1] };
  const accepted = (label: string, instruction: Instruction) => h.send('risk ' + label, [instruction], [owner]);
  const keys = [...new Set([...setup.tracked, cross, receiver, setup.traderToken.address])];
  const snapshot = () => Promise.all(keys.map(h.read));
  const rejected = async (label: string, instruction: Instruction, error: number) => {
    const before = await snapshot();
    await h.send('risk ' + label, [instruction], [owner], error);
    assert.deepEqual(await snapshot(), before);
  };
  for (const marketIndex of [0, 1] as const) {
    await setup.sample();
    await accepted('two-maker fill ' + marketIndex, await route({
      trader: cross, actor: owner, marketIndex, side: 0,
      makers: [setup.instances[marketIndex * 3], setup.instances[marketIndex * 3 + 2]], lots: [25n, 25n],
    }));
  }
  const withdraw = async (amount: bigint) => sdk.getWithdrawFundedAccountInstruction({
    ...common, owner, margin: cross, quoteMint: setup.mint.address, userToken: setup.traderToken.address,
    amount, guard: await guard(cross),
  });
  const funded = (await root(cross)).cash;
  await rejected('withdraw below initial margin', await withdraw(900_000n), sdk.CLEARING_ERROR__ARITHMETIC);
  await accepted('withdraw', await withdraw(400_100n));
  assert.equal((await root(cross)).cash, funded - 400_100n);
  for (const margin of [cross, receiver]) {
    await setup.sample();
    const slot = await setup.slot();
    await accepted('reserve ' + (margin === cross ? 'cross' : 'isolated'), sdk.getManageAccountOrderInstruction({
      ...common, actor: owner, margin, guard: await guard(margin), marketIndex: 0,
      operation: { __kind: 'Place', expectedId: (await root(margin)).book.lastOrderId + 1n,
        terms: { side: 0, lots: 1n, limit: 66_000n, feeBudget: 1000n, startSlot: slot, expirySlot: slot + 2000n,
          trigger: 0, threshold: 0n, reduceOnly: false, generation: 0n } },
    }));
    assert((await root(margin)).reserved > 0n);
  }
  setup.sourcePrices.btc = 52_000_000_000n;
  await setup.qualify();
  const liquidate = async (price: bigint) => sdk.getLiquidateAccountInstruction({
    ...common, target: cross, receiver, receiverOwner: owner, targetGuard: await guard(cross),
    receiverGuard: await guard(receiver), marketIndex: 0, lots: 10n, price,
  });
  await rejected('liquidation worsens deficit', await liquidate(46_800n), sdk.CLEARING_ERROR__ARITHMETIC);
  const balances = (keys: Address[]) => Promise.all(keys.map(root));
  const before = await balances([cross, receiver]);
  const instruction = await liquidate(52_000n);
  await accepted('liquidation and fee', instruction);
  const after = await balances([cross, receiver]);
  const scale = 1_000_000_000n;
  // A ten-lot transfer at 52,000 has 520,000 notional and a 260-atom funded fee.
  for (const index of [0, 1]) {
    const direction = index === 0 ? -1n : 1n;
    assert.equal(after[index].cash, before[index].cash + direction * 260n);
    for (const market of [0, 1]) {
      const previous = before[index].positions[market], current = after[index].positions[market];
      const traded = market === 0 ? direction * 10n : 0n;
      assert.equal(current.lots, previous.lots + traded);
      assert.equal(current.virtualScaled, previous.virtualScaled - traded * 52_000n * scale
        - previous.lots * (current.fundingCheckpointScaled - previous.fundingCheckpointScaled));
    }
  }
  assert.equal(after[0].reserved, 0n);
  assert(after[1].reserved > 0n);
  await rejected('stale liquidation replay', instruction, sdk.CLEARING_ERROR__FINANCIAL_SEQUENCE);
  await flush();
  const journal = await openSettlementJournal(rpc, setup, checks.map(check => String(check.signature)), build);
  try {
    await journal.checkpoint('risk-engine');
    const replay = await journal.finish();
    writeFileSync(`${directory}/risk-engine.json`, json({
      revision, artifactSet: build.artifactSet, events: replay.events, confirmedCash: after.map(account => account.cash),
      results: checks.filter(check => String(check.label).startsWith('risk ')),
    }));
  } finally { await journal.close(); }
} finally { try { await flush(); } finally { ws.close(); } }
