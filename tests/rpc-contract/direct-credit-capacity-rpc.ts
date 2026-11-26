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
const grouped = build.artifactSet === sdk.GROUPED_CREDIT_ARTIFACT_SET;
const large = grouped || [sdk.THOUSAND_MEMBER_CREDIT_ARTIFACT_SET,sdk.STREAMED_CREDIT_ARTIFACT_SET].includes(build.artifactSet);
assert(large || build.artifactSet === sdk.DIRECT_CREDIT_ARTIFACT_SET);
const population = large ? 1_000 : 128;
const rowsPerLane = population / 8;
const revision = execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8'}).trim();
assert.equal(execFileSync('git', ['status','--porcelain','--untracked-files=no'], {encoding:'utf8'}).trim(), '');
const payer = await payerKey();
// Capture the actual initial 400k/32 KiB attempt even if it fails at runtime.
const attempts = new Map<string, {units:number; heap?:number}>();
const results: {label:string;units:number;heap:number;signature:string;cu:number;error:unknown;reason:string|null}[] = [];
const completed = new Map<string,string>();
const {rpc, ws, h:transport, checks, flush} = await openCanonicalRpcHarness(
  process.env.RIVALT_RPC_URL!, process.env.RIVALT_WS_URL!, dir, {
    deferFinality:true,
    computeUnitLimit:label=>attempts.get(label)?.units,
    heapSize:label=>attempts.has(label) ? attempts.get(label)?.heap : large ? 128*1024 : undefined,
    observeOutcomes:label=>attempts.has(label),
    measureComputeBoundary:label=>attempts.has(label),
  });
const {h, lanes, members} = coverageProvisioning(transport, payer);
const quietCredit = 'pay half the spread before other positions open';
const exposedCredit = 'pay half the spread with open positions in every lane';
const denseCredit = 'pay closed ETH spread with every member exposed';
const collectLabel = 'collect closed ETH loss at full lane capacity';
const exitLabel = 'owner withdraws credited ETH spread at full capacity';

try {
  const setup = await liquidityExecutionSetup(h, rpc, {traderCount:population-6, recoveryCapacity:population+1,
    isolatedTraderMarket:grouped ? 1 : 0, marketCheckpoints:true, marginLayout:'ledger-lanes', shape:symmetricPayoutShape, verifyRejections:false});
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
    return auditCoverage(rpc, venue, registry, lanes, [...active], true, rowsPerLane, grouped);
  };
  const fullBook = await audit();
  assert.deepEqual(counts(), Array(8).fill(rowsPerLane));
  assert.equal(sdk.getRecoveryStorageDecoder().decode((await h.read(setup.storage))!).readyCapacity, BigInt(population+1));

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
  const fullLaneRefusal = 'reject admission in full lane';
  await refuseActivation(fullLaneRefusal, activation);

  const maker = setup.instances[3], debtor = roots[0], trader = setup.traderOwners[0];
  const initialCash = (await root(maker.capital)).cash;
  const initialTokens = await balance(maker.token.address);
  const initialVault = await balance(setup.vault);
  const scale = 1_000_000_000n, lots = grouped ? 15n : 10n, spread = lots * (2n+2n);
  const payment = 20n;
  assert.equal(await pool(), 0n);
  assert.equal(await h.read(certificate), null);
  await setup.sample();
  for (const side of [0,1] as const) {
    const fill = await route({trader:debtor, actor:trader, marketIndex:1, side, makers:[maker], lots:[lots],
      marketLane:true, minimalMarkets:true});
    await h.send((side === 0 ? 'buy ' : 'sell ')+(grouped ? 'fifteen' : 'ten')+' ETH lots', [
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
  const payCredit = async (label:string) => {
    const instructions = await sdk.directClosedProfitCredit({artifactSet:build.artifactSet, actor:payer,
      margin:await root(maker.capital), marketIndex:1, amount:payment});
    if (!large) {
      await h.send(label, instructions);
      completed.set(label,label);
      return;
    }
    const watched = [...new Set([maker.capital, registry, ...lanes, ...markets, ...ledgers,
      ...setup.instances.map(instance=>instance.registration), setup.vault, maker.token.address])];
    const before = await Promise.all(watched.map(h.read));
    let units = sdk.ROUTE_COMPUTE_UNITS, heap: number | undefined;
    // Each refusal can advance only one resource: heap 32 -> 128 -> 256 KiB,
    // or compute 400k -> 1.4M. Stop at the runtime limits.
    for (;;) {
      const name = label+' ('+units+' CU, '+(heap??32768)/1024+' KiB)';
      attempts.set(name,{units,heap});
      await h.send(name, instructions);
      await flush();
      const check = checks.find(row=>row.label===name)!;
      const tx = await rpc.call('getTransaction',[check.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
      assert.deepEqual(check.simulationError,tx.meta.err);
      assert.deepEqual(check.signatureWsError,tx.meta.err);
      const logs: string[] = tx.meta.logMessages;
      let reason: string | null = null;
      if (tx.meta.err) {
        const error = tx.meta.err.InstructionError?.[1];
        if (error==='ComputationalBudgetExceeded' || (error==='ProgramFailedToComplete' && logs.some(line=>/exceeded CUs meter|computational budget exceeded/i.test(line)))) reason = 'compute';
        else if (error==='ProgramFailedToComplete' && logs.some(line => {
          if (/memory allocation failed|in heap region/i.test(line)) return true;
          // Agave names the unmapped tail of the requested heap an unallocated region.
          const fault = /Access violation (?:writing|reading) (\d+) bytes at address (0x[0-9a-f]+) \(in unallocated region\)/i.exec(line);
          if (!fault) return false;
          const offset = BigInt(fault[2]) - 0x300000000n;
          return offset >= 0n && offset <= 256n*1024n && offset + BigInt(fault[1]) > BigInt(heap ?? 32768);
        })) reason = 'heap';
        else assert.fail('Unexpected credit error: '+JSON.stringify(tx.meta.err)+' '+logs.slice(-8).join(' '));
        assert.deepEqual(await Promise.all(watched.map(h.read)),before);
      }
      results.push({label,units,heap:heap??32768,signature:String(check.signature),cu:tx.meta.computeUnitsConsumed,error:tx.meta.err,reason});
      writeFileSync(dir+'/credit-attempts.json',json(results));
      if (!reason) { completed.set(label,name); return; }
      if (reason==='heap' && (heap ?? 0) < 256*1024) heap = heap ? 256*1024 : 128*1024;
      else if (reason==='compute' && units===sdk.ROUTE_COMPUTE_UNITS) units = 1_400_000;
      else break;
      // Refresh after a finalized refusal, preserving all balances and the original entitlement.
      await setup.sample();
      for (const [index,bytes] of (await Promise.all(watched.map(h.read))).entries()) before[index]=bytes;
    }
    assert.fail('No funded credit within the diagnostic envelope: '+label);
  };
  await payCredit(quietCredit);
  assert.equal(await pool(), spread-payment);
  assert.equal((await root(maker.capital)).cash, initialCash + payment);
  assert.equal((await root(maker.capital)).positions[1].virtualScaled, (spread-payment)*scale);

  // One solvent long in each lane creates a case where mixed lower bounds
  // fail at the genesis anchor. All exposures come from actual matched fills.
  const exposures = new Map<Address, Address>();
  for (const [index, margin] of roots.entries()) {
    const lane = members.get(margin)!;
    if (exposures.has(lane) || (await root(margin)).mode !== 0) continue;
    const counterparty = setup.instances[4 + exposures.size % 2];
    const owner = setup.traderOwners[index];
    const fill = await route({trader:margin, actor:owner, marketIndex:1, side:0,
      makers:[counterparty], lots:[40n], marketLane:true, minimalMarkets:true});
    await h.send('open forty ETH lots in lane '+lanes.indexOf(lane), [
      appendCoverage(fill, [lane, members.get(counterparty.capital)!])], [owner]);
    assert.equal((await root(margin)).positions[1].lots, 40n);
    exposures.set(lane, margin);
    if (exposures.size === 8) break;
  }
  assert.equal(exposures.size, 8);
  await setup.sample();
  const sparse = grouped ? await audit() : undefined;
  if (sparse) assert.equal(sparse.openMembers,10);
  await payCredit(exposedCredit);
  assert.equal(await pool(), spread - 2n*payment);
  assert.equal((await root(maker.capital)).cash, initialCash + 2n*payment);
  const denseFills = new Map<Address,{provider:number;side:0|1}>();
  let dense: Awaited<ReturnType<typeof audit>> | undefined;
  async function trade(label:string, index:number, marketIndex:0|1, provider:number, side:0|1) {
    const margin = roots[index], owner = setup.traderOwners[index], counterparty = setup.instances[provider];
    const fill = await route({trader:margin,actor:owner,marketIndex,side,makers:[counterparty],lots:[1n],
      marketLane:true,minimalMarkets:true});
    await h.send(label,[appendCoverage(fill,[members.get(margin)!,members.get(counterparty.capital)!])],[owner]);
  }
  if (grouped) {
    // Open the three BTC maker capitals against cross accounts that also hold ETH.
    for (let provider=0; provider<3; provider++) {
      const margin = [...exposures.values()][provider];
      await trade('dense BTC cross fill '+provider,roots.indexOf(margin),0,provider,0);
    }
    const pending = roots.filter(margin=>![...exposures.values()].includes(margin));
    for (const [ordinal,margin] of pending.entries()) {
      if (ordinal%24===0) await setup.sample();
      // Keep provider inventories bounded while placing real longs and shorts.
      const provider = ordinal===pending.length-1 ? 3 : 4+ordinal%2;
      const side = Math.floor(ordinal/2)%2 as 0|1;
      await trade('dense ETH fill '+ordinal,roots.indexOf(margin),1,provider,side);
      denseFills.set(margin,{provider,side});
    }
    dense = await audit();
    assert.deepEqual([dense.members,dense.openMembers,...dense.openByMarket],[1000,1000,6,997]);
    await setup.sample();
    const before = (await root(maker.capital)).positions[1];
    assert.notEqual(before.lots,0n);
    await payCredit(denseCredit);
    const after = (await root(maker.capital)).positions[1];
    assert.equal(after.lots,before.lots);
    assert.equal(after.virtualScaled,before.virtualScaled-payment*scale);
  } else {
    assert.equal((await root(maker.capital)).positions[1].virtualScaled,0n);
  }
  assert.equal(await pool(),0n);
  assert.equal((await root(maker.capital)).cash,initialCash+spread);
  const withdraw = async (margin:Address, owner:typeof applicant, token:Address, amount:bigint) =>
    finance(sdk.getWithdrawFundedAccountInstruction({...common, owner, margin, userToken:token,
      quoteMint:setup.mint.address, guard:await guard(margin), amount}), margin);
  if (grouped) await setup.sample();
  await h.send(exitLabel, await withdraw(maker.capital, maker.owner, maker.token.address, spread), [maker.owner]);
  assert.equal(await balance(maker.token.address), initialTokens + spread);
  assert.equal(await balance(setup.vault), initialVault - spread);
  assert.equal((await root(maker.capital)).cash, initialCash);
  assert.equal(await h.read(certificate), null);
  await audit();

  // Free an idle seat elsewhere, then in the applicant's own lane. The first owner
  // controls enough consecutive stable IDs to supply both cases with one token account.
  const idle = roots.slice(1, 17).filter(margin => ![...exposures.values()].includes(margin));
  assert(idle.every(margin => setup.traderOwners[roots.indexOf(margin)].address === trader.address));
  async function vacate(margin:Address) {
    const opening = denseFills.get(margin);
    if (opening) {
      await setup.sample();
      await trade('close dense ETH position before leaving',roots.indexOf(margin),1,opening.provider,opening.side===0 ? 1 : 0);
      assert.deepEqual([(await root(margin)).positions[1].lots,(await root(margin)).positions[1].virtualScaled],[0n,-4n*scale]);
      await h.send('settle departing member loss',await finance(sdk.getCollectAccountLossInstruction({
        ...common,actor:payer,margin,marketIndex:1,amount:4n}),margin));
    }
    const cash = (await root(margin)).cash;
    await h.send('withdraw idle trader collateral', await withdraw(margin, trader, setup.traderToken.address, cash), [trader]);
    const leave = await membership(margin, trader, false);
    await h.send('deactivate empty trader', [appendCoverage(leave, [members.get(margin)!])], [trader]);
    active.delete(margin);
  }
  await vacate(idle.find(margin => members.get(margin) !== candidateLane)!);
  assert.equal((await audit()).members, population-1);
  await refuseActivation('reject full lane with a vacancy elsewhere', await membership(candidate, applicant, true));
  await vacate(idle.find(margin => members.get(margin) === candidateLane)!);
  await h.send('activate waiting member after a matching vacancy', [await membership(candidate, applicant, true)], [applicant]);
  active.add(candidate);
  assert.equal((await root(candidate)).lifecycle, sdk.MEMBER_FINANCIAL);
  const finalBook = await audit();
  assert.equal(finalBook.members, population-1);
  assert.equal(counts()[lanes.indexOf(candidateLane)], rowsPerLane);
  const measured = checks.filter(row => [completed.get(quietCredit),completed.get(exposedCredit),completed.get(denseCredit),collectLabel,exitLabel,fullLaneRefusal,
    'reject full lane with a vacancy elsewhere','activate waiting member after a matching vacancy'].includes(String(row.label)));
  assert.equal(measured.length, grouped ? 8 : 7);
  const coverageLogs = [];
  for (const [label, exact] of [[quietCredit,0],[exposedCredit,grouped ? 0 : population],...(grouped ? [[denseCredit,0] as const] : [])] as const) {
    const receipt = await rpc.call('getTransaction',[measured.find(row=>row.label===completed.get(label))!.signature,
      {encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:1}]);
    const message = 'coverage target=1 members='+population+' exact='+exact+' covered=1';
    assert(receipt.meta.logMessages.includes('Program log: '+message), label+' expected '+message);
    coverageLogs.push(message);
  }
  const payments = {revision, program:build.revision, fullBook, finalBook, population, recoveryCapacity:population+1,
    grouped, sparse, dense, attempts:results, credited:spread, withdrawn:spread, coverageLogs, measured};
  writeFileSync(dir+'/capacity-financial.json',json(payments));
  const journal = await openSettlementJournal(rpc, setup, checks.map(row => String(row.signature)), build);
  const replay = await journal.finish(undefined, large ? 128 : undefined);
  assert.equal(replay.state.members.length, finalBook.members);
  assert.equal(BigInt(replay.state.roots[maker.capital].cash), initialCash);
  writeFileSync(dir+'/capacity.json', json({...payments, events:replay.events}));
  console.log('Capacity run verified', coverageLogs, replay.events, 'replayed events.');
} finally {
  await ws.close();
}
