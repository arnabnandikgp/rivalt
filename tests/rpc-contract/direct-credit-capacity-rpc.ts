// Full coverage lanes, an independent recovery seat, and a funded closed-profit exit.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {getTokenDecoder} from '@solana-program/token';
import type {Address, Instruction} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import {json} from '../../packages/indexer/src/events.js';
import {registerTestMarginForActivation} from './account-membership-setup.js';
import {symmetricPayoutShape} from './canonical-maker-cases.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {appendCoverage, coverageProvisioning} from './coverage-provisioning.js';
import {routerBuild} from './execution-router-build.js';
import {payerKey} from './harness.js';
import {executionTestHelpers} from './liquidity-execution-helpers.js';
import {liquidityExecutionSetup} from './liquidity-execution-setup.js';
import {openSettlementJournal} from './scalable-settlement-journal.js';
import {auditCoverage} from './shadow-coverage.js';

const dir = process.env.RIVALT_RUN_DIR!;
const build = routerBuild();
assert.equal(build.artifactSet, sdk.DIRECT_CREDIT_ARTIFACT_SET);
const revision = execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8'}).trim();
assert.equal(execFileSync('git', ['status','--porcelain','--untracked-files=no'], {encoding:'utf8'}).trim(), '');
const payer = await payerKey();
const {rpc, ws, h:transport, checks, flush} = await openCanonicalRpcHarness(
  process.env.RIVALT_RPC_URL!, process.env.RIVALT_WS_URL!, dir, {deferFinality:true});
const {h, lanes, members} = coverageProvisioning(transport, payer);
const population = 128;
const creditLabel = 'direct ETH credit at full lane capacity';
const collectLabel = 'collect closed ETH loss at full lane capacity';
const exitLabel = 'owner withdraws credited ETH spread at full capacity';

try {
  const setup = await liquidityExecutionSetup(h, rpc, {traderCount:population-6, recoveryCapacity:population+1,
    marketCheckpoints:true, marginLayout:'ledger-lanes', shape:symmetricPayoutShape, verifyRejections:false});
  const {venue, registry, markets, ledgers, roots} = setup;
  const {root, guard, route, withCheckpoints} = executionTestHelpers(h, setup);
  const active = new Set([...roots, ...setup.instances.map(maker => maker.capital)]);
  const common = {...setup.common, btc:markets[0], eth:markets[1]};
  const balance = async (account:Address) => getTokenDecoder().decode((await h.read(account))!).amount;
  const pool = async () => sdk.getMarketLedgerDecoder().decode((await h.read(ledgers[1]))!).settlement;
  const [certificate] = await sdk.deriveSettlementCertificate(venue, 1);
  const counts = () => lanes.map(lane => [...active].filter(member => members.get(member) === lane).length);
  const audit = async () => {
    await flush();
    return auditCoverage(rpc, venue, registry, lanes, [...active], true);
  };
  const fullBook = await audit();
  assert.deepEqual(counts(), Array(8).fill(16));
  assert.equal(sdk.getRecoveryStorageDecoder().decode((await h.read(setup.storage))!).readyCapacity, 129n);

  // Register a new identity on an existing portfolio without activating it.
  const applicant = setup.traderOwners.at(-1)!;
  const portfolio = (await root(roots.at(-1)!)).portfolio;
  const [candidate] = await sdk.deriveMarginAccount(portfolio, 8);
  assert.equal(await h.read(candidate), null);
  const activation = await registerTestMarginForActivation(h, setup.common, payer, {owner:applicant,
    portfolio, margin:candidate, subaccountIndex:8, mode:1, isolatedMarketIndex:0, role:0});
  const candidateLane = members.get(candidate)!;
  assert.equal((await root(candidate)).lifecycle, sdk.MEMBER_REGISTERED);
  const membership = async (margin:Address, owner:typeof applicant, activate:boolean) => {
    await flush();
    const state = await sdk.readMarginMembership(rpc, venue, owner.address, margin, true, setup.identity.marginLayout);
    const input = {...common, ...state, owner};
    const instruction = activate ? sdk.getActivateMarginInstruction(input) : sdk.getDeactivateMarginInstruction(input);
    return {...instruction, accounts:[...instruction.accounts, ...state.remaining]};
  };
  async function refuseActivation(label:string, instruction:Instruction) {
    const watched = [...new Set([...lanes, ...instruction.accounts!.map(meta => meta.address), setup.vault])];
    const before = await Promise.all(watched.map(h.read));
    await h.send(label, [instruction], [applicant], sdk.CLEARING_ERROR__PROFILE);
    assert.deepEqual(await Promise.all(watched.map(h.read)), before);
    assert.equal((await root(candidate)).lifecycle, sdk.MEMBER_REGISTERED);
  }
  await refuseActivation('reject seventeenth member in full lane', activation);

  const maker = setup.instances[3], debtor = roots[0], trader = setup.traderOwners[0];
  const initialCash = (await root(maker.capital)).cash;
  const initialTokens = await balance(maker.token.address);
  const initialVault = await balance(setup.vault);
  const scale = 1_000_000_000n, spread = 10n * (2n+2n);
  assert.equal(await pool(), 0n);
  assert.equal(await h.read(certificate), null);
  await setup.sample();
  for (const side of [0,1] as const) {
    const fill = await route({trader:debtor, actor:trader, marketIndex:1, side, makers:[maker], lots:[10n],
      marketLane:true, minimalMarkets:true});
    await h.send(side === 0 ? 'buy ten ETH lots' : 'sell ten ETH lots', [
      appendCoverage(fill, [members.get(debtor)!, members.get(maker.capital)!])], [trader]);
  }
  const earned = (await root(maker.capital)).positions[1];
  assert.deepEqual([earned.lots, earned.virtualScaled], [0n, spread*scale]);
  assert.equal((await root(debtor)).positions[1].virtualScaled, -spread*scale);
  const finance = async (ix:Instruction, margin:Address) =>
    [...(await withCheckpoints(ix)).slice(0,-1), appendCoverage(ix,[members.get(margin)!])];
  const collection = sdk.getCollectAccountLossInstruction({...common, actor:payer, margin:debtor, marketIndex:1, amount:spread});
  await h.send(collectLabel, await finance(collection, debtor));
  assert.equal(await pool(), spread);
  assert.equal((await root(maker.capital)).cash, initialCash);
  const credit = await sdk.directClosedProfitCredit({artifactSet:build.artifactSet, actor:payer,
    margin:await root(maker.capital), marketIndex:1, amount:spread});
  await h.send(creditLabel, credit);
  assert.equal(await pool(), 0n);
  assert.equal((await root(maker.capital)).cash, initialCash + spread);
  assert.equal((await root(maker.capital)).positions[1].virtualScaled, 0n);
  const withdraw = async (margin:Address, owner:typeof applicant, token:Address, amount:bigint) =>
    finance(sdk.getWithdrawFundedAccountInstruction({...common, owner, margin, userToken:token,
      quoteMint:setup.mint.address, guard:await guard(margin), amount}), margin);
  await h.send(exitLabel, await withdraw(maker.capital, maker.owner, maker.token.address, spread), [maker.owner]);
  assert.equal(await balance(maker.token.address), initialTokens + spread);
  assert.equal(await balance(setup.vault), initialVault - spread);
  assert.equal((await root(maker.capital)).cash, initialCash);
  assert.equal(await h.read(certificate), null);
  await audit();

  // Free an idle seat elsewhere, then in the applicant's own lane. The first owner
  // controls enough consecutive stable IDs to supply both cases with one token account.
  const idle = roots.slice(1, 17);
  assert(idle.every(margin => setup.traderOwners[roots.indexOf(margin)].address === trader.address));
  async function vacate(margin:Address) {
    const cash = (await root(margin)).cash;
    await h.send('withdraw idle trader collateral', await withdraw(margin, trader, setup.traderToken.address, cash), [trader]);
    const leave = await membership(margin, trader, false);
    await h.send('deactivate empty trader', [appendCoverage(leave, [members.get(margin)!])], [trader]);
    active.delete(margin);
  }
  await vacate(idle.find(margin => members.get(margin) !== candidateLane)!);
  assert.equal((await audit()).members, 127);
  await refuseActivation('reject full lane with a vacancy elsewhere', await membership(candidate, applicant, true));
  await vacate(idle.find(margin => members.get(margin) === candidateLane)!);
  await h.send('activate waiting member after a matching vacancy', [await membership(candidate, applicant, true)], [applicant]);
  active.add(candidate);
  assert.equal((await root(candidate)).lifecycle, sdk.MEMBER_FINANCIAL);
  const finalBook = await audit();
  assert.equal(finalBook.members, 127);
  assert.equal(counts()[lanes.indexOf(candidateLane)], 16);
  const measured = checks.filter(row => [creditLabel,collectLabel,exitLabel,'reject seventeenth member in full lane',
    'reject full lane with a vacancy elsewhere','activate waiting member after a matching vacancy'].includes(String(row.label)));
  assert.equal(measured.length, 6);
  const receipt = await rpc.call('getTransaction',[measured.find(row=>row.label===creditLabel)!.signature,
    {encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
  const coverageLog = receipt.meta.logMessages.find((line:string)=>line.includes('coverage target=1 members=128 '));
  assert(coverageLog && coverageLog.endsWith('covered=1'));
  const journal = await openSettlementJournal(rpc, setup, checks.map(row => String(row.signature)), build);
  const replay = await journal.finish();
  assert.equal(replay.state.members.length, finalBook.members);
  assert.equal(BigInt(replay.state.roots[maker.capital].cash), initialCash);
  writeFileSync(dir+'/capacity.json', json({revision, program:build.revision, fullBook, finalBook,
    recoveryCapacity:129, credited:spread, withdrawn:spread, coverageLog, measured, events:replay.events}));
  console.log('Capacity run verified', coverageLog, replay.events, 'replayed events.');
} finally {
  await ws.close();
}
