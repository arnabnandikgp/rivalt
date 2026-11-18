import {financialRoots} from './membership-scan-helper.js';
import {registerFinancialTestMargin} from './account-membership-setup.js';
// P44: real maximum membership and source-emergency recovery, no injected accounts.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { Address, Instruction } from '@solana/kit';
import { findAssociatedTokenPda, getCreateAssociatedTokenInstruction, getMintToInstruction, getTokenDecoder, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { openCanonicalRpcHarness } from './canonical-rpc-harness.js';
import { liquidityExecutionSetup } from './liquidity-execution-setup.js';
import { executionTestHelpers } from './liquidity-execution-helpers.js';
import { resolveLiquidityCohort } from './liquidity-resolution-cases.js';
const directory = process.env.RIVALT_RUN_DIR!;
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(), '');
const serialize = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
const { h, rpc, ws, checks, conformance, flush } = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!, process.env.RIVALT_WS_URL!, directory, {
  deferFinality: true, computeUnitLimit: label => label.startsWith('P32 safety') || label.startsWith('P44 safety') ? 1_200_000
    : label.startsWith('P44 route') ? 800_000 : label.startsWith('P32 publisher') ? 200_000 : 400_000,
});
try {
  const setup = await liquidityExecutionSetup(h, rpc, { verifyRejections: false });
  const { root, guard, route } = executionTestHelpers(h, setup);
  const registry = () => h.read(setup.registry).then(bytes => sdk.getVenueRegistryDecoder().decode(bytes!));
  // Existing eight accounts plus fifty-six one-atom actual deposits. At capacity
  // the same per-owner four portfolios/nine indices and canonical registry apply.
  for (const [owner, token] of [[setup.traderOwner, setup.traderToken], [setup.owner, setup.token]] as const) {
    for (let portfolioIndex = 0; portfolioIndex < 4; portfolioIndex++) {
      const [portfolio] = await sdk.deriveAccountPortfolio(setup.venue, owner.address, portfolioIndex);
      if (!(await h.read(portfolio))) await h.send('P44 create maximum cohort portfolio', [await sdk.getCreatePortfolioInstructionAsync({
        ...setup.common, owner, portfolio, index: portfolioIndex })], [owner]);
      for (let subaccountIndex = 0; subaccountIndex <= 8; subaccountIndex++) {
        if ((await registry()).financialCount === 64n) break;
        const [margin] = await sdk.deriveMarginAccount(portfolio, subaccountIndex);
        if (await h.read(margin)) continue;
        await registerFinancialTestMargin(h,setup.common,setup.payer,{owner, portfolio,
          margin, subaccountIndex, mode: subaccountIndex === 0 ? 0 : 1, isolatedMarketIndex: subaccountIndex === 0 ? 255 : subaccountIndex % 2, role: 0 });
        await h.send('P44 fund new member with one actual collateral atom', [getMintToInstruction({ mint: setup.mint.address,
          token: token.address, mintAuthority: setup.payer, amount: 1n }), await sdk.getDepositAccountInstructionAsync({ ...setup.common,
          owner, margin, quoteMint: setup.mint.address, userToken: token.address, amount: 1n })], [owner]);
      }
      if ((await registry()).financialCount === 64n) break;
    }
  }
  const roots = await financialRoots(h,setup.venue,setup.registry); assert.equal(roots.length, 64);
  const cross = setup.roots[0]; await setup.qualify();
  for (const marketIndex of [0, 1] as const) {
    await setup.sample();
    await h.send('P44 route maximum-cohort two-market exposure', [await route({ trader: cross, actor: setup.traderOwner,
      marketIndex, side: 0, makers: [setup.instances[marketIndex * 3]], lots: [2n] })], [setup.traderOwner]);
  }
  const [reserveDestination] = await findAssociatedTokenPda({ owner: setup.payer.address, mint: setup.mint.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  await h.send('P44 prepare terminal reserve destination', [getCreateAssociatedTokenInstruction({ payer: setup.payer,
    ata: reserveDestination, owner: setup.payer.address, mint: setup.mint.address })]);
  const keys = [...new Set([...setup.tracked, ...roots, ...setup.configurations, setup.resolution, setup.storage,
    reserveDestination, setup.mint.address, setup.traderToken.address])];
  const raw = async () => Object.fromEntries(await Promise.all(keys.map(async key => [key, (await h.read(key))?.toString('base64') ?? null])));
  const reject = async (label: string, instruction: Instruction, error = sdk.CLEARING_ERROR__RESOLUTION) => {
    const before = await raw(); await h.send(`P44 safety ${label}`, [instruction], [], error);
    assert.deepEqual(await raw(), before, 'Complete atomic rollback');
  };
  const header = async () => sdk.getResolutionDecoder().decode((await h.read(setup.resolution))!);
  const sources = { primaryBtc: setup.feeds[0].feed, primaryCollateral: setup.feeds[1].feed,
    guardBtc: setup.feeds[2].feed, guardCollateral: setup.feeds[3].feed, primaryEth: setup.feeds[4].feed, guardEth: setup.feeds[5].feed };
  const freeze = async () => sdk.getFreezeAccountsInstruction({ ...setup.safetyCommon, ...sources, caller: setup.payer, target: cross,members:(await sdk.deriveMemberPage(setup.venue,(await root(cross)).id/64n))[0],
    safetyEpoch: sdk.getVenueSafetyDecoder().decode((await h.read(setup.safety))!).epoch, resolutionEpoch: (await header()).epoch, emergency: true });
  await reject('fresh sources cannot authorize emergency freeze', await freeze());
  const deadline = (await setup.marketState(0)).oracle.sourceDeadline + 31n;
  while (await setup.now() < deadline) {
    const current = await setup.now(); await setup.waitUntil(current + 10n < deadline ? current + 10n : deadline);
  }
  await h.send('P44 safety authority freezes after actual source outage', [await freeze()]);
  assert.equal((await header()).stage, 1, 'No invented stale valuation');
  const value = sdk.getValueAccountResolutionInstruction({ ...setup.safetyCommon, ...sources, epoch: (await header()).epoch });
  await reject('unavailable sources cannot value frozen cohort', value);
  await setup.freshSources();
  await h.send('P44 safety recovered credible sources value all markets', [value]);
  assert.equal((await header()).stage, 2);
  const frozenAccounts = await raw();
  const resolution = await resolveLiquidityCohort(h, setup, roots, reject);
  const completedAccounts = await raw();
  const beforeTokens = getTokenDecoder().decode((await h.read(setup.token.address))!).amount;
  await h.send('P44 safety complete-cohort funded exit', [sdk.getWithdrawFundedAccountInstruction({ ...setup.common,
    owner: setup.owner, margin: roots[0], quoteMint: setup.mint.address, userToken: setup.token.address,
    guard: await guard(roots[0]), amount: 100n })], [setup.owner]);
  assert.equal(getTokenDecoder().decode((await h.read(setup.token.address))!).amount, beforeTokens + 100n);
  const resolvedAccounts = await raw();
  const capture = { scenario: 'two-market-resolved', venue: setup.venue, custody: setup.custody, safety: setup.safety,
    registry: setup.registry, vault: setup.vault, mint: setup.mint.address, userTokens: [setup.token.address, setup.traderToken.address],
    reserveDestination, resolution: setup.resolution, storage: setup.storage, roots, markets: setup.markets,
    ledgers: setup.ledgers, frozenAccounts, completedAccounts, resolvedAccounts, rawAccounts: resolvedAccounts };
  writeFileSync(`${directory}/financial-capture.json`, serialize(capture));
  execFileSync('python3', ['tests/financial/account-safety-reference.py', `${directory}/financial-capture.json`], { stdio: 'inherit' });
  await flush();
  const parity = await conformance.finish(directory, [{ program: sdk.CLEARING_PROGRAM_ADDRESS, name: 'resolution', key: setup.resolution }], h.read);
  writeFileSync(`${directory}/summary.json`, serialize({ revision,
    trackedDirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() !== '',
    build: JSON.parse(readFileSync(`${process.env.RIVALT_ARTIFACT_DIR??'.local/anchor-rc2/candidate'}/build-manifest.json`, 'utf8')), checks, parity,
    members: 64, actualDeposits: true, injectedFinancialState: false, resolution, financialCapture: 'financial-capture.json' }));
  console.log(`P44 complete-cohort source recovery: ${checks.length} signed outcomes and 64 independent payouts.`);
} finally { try { await flush(); } finally { ws.close(); } }
