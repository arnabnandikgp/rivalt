import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { address, AccountRole, isSome } from '@solana/kit';
import { getMintDecoder, getTokenDecoder, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { Subscription } from '../../packages/indexer/src/rpc.js';
import { devnetContext, guardInstruction, sampleInstruction, setupDevnet } from './devnet-context.js';
import { DevnetRpc, persist } from './devnet-rpc.js';
import { coreEligibility, decodeCore, normalizeCore } from './pyth-core.js';
import { unsigned } from './devnet-preflight-support.js';

const a = await devnetContext(), h = new DevnetRpc(a);
const directory = '.local/devnet/acceptance';
const deployment = JSON.parse(readFileSync('.local/devnet/deployed.json', 'utf8')); assert.equal(deployment.result, 'pass');
const report: Record<string, any> = { startedUtc: new Date().toISOString(), a18Complete: false,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
  buildRevision: deployment.buildRevision, endpoint: h.config.endpointLabel, program: a.program, mint: a.mint.address, sourceWindows: [] };
let stage = 'genesis-and-journal', ws: Subscription | undefined;
const risk = async () => sdk.getTestRouteStateDecoder().decode((await h.read(a.routeState))!);
async function sources() {
  const raw = await h.rpc.call('getMultipleAccounts', [[...a.primary.map(x => x.account), 'SysvarC1ock11111111111111111111111111111111'], { encoding: 'base64', commitment: 'confirmed' }]);
  const now = Buffer.from(raw.value[2].data[0], 'base64').readBigInt64LE(32);
  const prices = a.primary.map((f, i) => decodeCore(raw.value[i], f));
  return { raw, now, prices, eligible: prices.every((p, i) => coreEligibility(p, now, i === 1).eligible), latestAge: prices.reduce((x, p) => x > now - p.published ? x : now - p.published, 0n) };
}
async function waitSample() {
  for (;;) { const r = await risk(); if ((await h.now()) >= r.oracle.sampledAt + 2n) return; await delay(250); }
}
async function executeOneLot(source: Awaited<ReturnType<typeof sources>>, atomicSample: boolean) {
  const raw = await h.rpc.call('getMultipleAccounts', [[a.market, a.routeState, a.trader, a.makers[0].capital, a.makers[0].registration, a.vault,
    'SysvarC1ock11111111111111111111111111111111'], { encoding: 'base64', commitment: 'confirmed' }]);
  const bytes = raw.value.map((x: any) => Buffer.from(x.data[0], 'base64'));
  const m = sdk.getMarketStateDecoder().decode(bytes[0]), r = sdk.getTestRouteStateDecoder().decode(bytes[1]);
  const trader = sdk.getParticipantDecoder().decode(bytes[2]), maker = sdk.getParticipantDecoder().decode(bytes[3]);
  const reg = sdk.getMakerRegistrationDecoder().decode(bytes[4]);
  assert.equal(trader.lots, 0n); assert.equal(maker.lots, 0n);
  const currentClock = bytes[6].readBigInt64LE(32), currentSlot = BigInt(unsigned(raw.context.slot));
  if (!atomicSample) assert.equal(sdk.oracleMode(m, r, currentClock, currentSlot), 'Normal', 'Source validity ended while preparing the action; stop before signing');
  else assert(source.prices.every(p => currentClock < p.published + 20n), 'Source expired before conditional atomic attempt');
  const normalized = source.prices.map((p: ReturnType<typeof decodeCore>) => normalizeCore(p.price, p.confidence, p.exponent));
  const reference = normalized[0].value / normalized[1].value;
  if (!atomicSample) assert.equal(r.referencePrice, reference);
  const expectedObservation = { ...r, observationSequence: r.observationSequence + (atomicSample ? 1n : 0n), referencePrice: reference };
  const gross = reference + 10n, fee = (gross + 4_999n) / 5_000n, slot = BigInt(unsigned(raw.context.slot)), x = a.makers[0];
  const route = await sdk.getExecuteRouteInstructionAsync({ ...a, owner: a.traderOwner,
    firstCapital: x.capital, firstRegistration: x.registration, firstProgram: x.pricingProgram, firstProgramData: x.programData, firstConfig: x.config,
    domain: m.domain, termsEpoch: m.termsEpoch, configEpoch: m.configEpoch, observationSequence: expectedObservation.observationSequence, nonce: trader.nonce,
    startSlot: slot, expirySlot: slot + 150n, side: 0, lots: 1n, allInLimit: gross + fee, maxFee: fee, reduceOnly: false, generation: trader.generation,
    legs: [{ lots: 1n, quoteEpoch: reg.quoteEpoch, authorityEpoch: reg.authorityEpoch }] }, a.options);
  persist(`${directory}/route-expected.json`, { gross, fee, before: { trader, maker, market: m }, observation: expectedObservation, source, atomicSample });
  const tradeLabel = `open-one-lot-${atomicSample ? 'atomic-' : ''}${expectedObservation.observationSequence}`; report.tradeLabel = tradeLabel;
  await h.send(tradeLabel, atomicSample ? [sdk.fundingComputeBudget(), await sampleInstruction(a), route] : [sdk.routeComputeBudget(), route], [a.traderOwner]);
  let observation: sdk.OracleObservedEvent | sdk.TestRouteState = r;
  if (atomicSample) {
    const event = h.latestEvents.find(e => e.type === 'oracle'); assert(event);
    observation = sdk.getOracleObservedEventDecoder().decode(Buffer.from(event.bytes, 'base64'));
    assert.equal(observation.oracle.status, 2);
    assert(observation.oracle.sampledAt - observation.oracle.validSince >= 6n);
    assert.deepEqual(observation.oracle.sourceSequences.slice(0, 2), source.prices.map(p => p.published));
    report.atomicObservation = observation;
  }
  report.usedSource = source;
  const after = await h.rpc.call('getMultipleAccounts', [[a.market, a.trader, a.makers[0].capital, a.vault], { encoding: 'base64', commitment: 'finalized' }]);
  const [am, at, ap, av] = after.value.map((x: any) => Buffer.from(x.data[0], 'base64'));
  const marketAfter = sdk.getMarketStateDecoder().decode(am), traderAfter = sdk.getParticipantDecoder().decode(at), makerAfter = sdk.getParticipantDecoder().decode(ap);
  assert.equal(traderAfter.cash, trader.cash - fee); assert.equal(makerAfter.cash, maker.cash);
  assert.equal(traderAfter.lots, 1n); assert.equal(makerAfter.lots, -1n);
  assert.equal(traderAfter.virtualScaled, -gross * 1_000_000_000n); assert.equal(makerAfter.virtualScaled, gross * 1_000_000_000n);
  assert.equal(marketAfter.fees, m.fees + fee); assert.equal(marketAfter.allocatedVault, m.allocatedVault); assert.equal(getTokenDecoder().decode(av).amount, m.allocatedVault);
  report.independentRoute = { gross, fee, beforeCommitment: 'confirmed', afterCommitment: 'finalized',
    before: { trader, maker, market: m }, after: { trader: traderAfter, maker: makerAfter, market: marketAfter } };
  return { route, observation };
}
try {
  await h.open(); ws = new Subscription(h.config.ws, a.program); await ws.ready;
  stage = 'signed-test-asset-setup'; await setupDevnet(h, a);
  const mintAccount = await h.account(a.mint.address); assert.equal(mintAccount.value.owner, TOKEN_PROGRAM_ADDRESS);
  const mint = getMintDecoder().decode(Buffer.from(mintAccount.value.data[0], 'base64'));
  assert.equal(mint.decimals, 6); assert(isSome(mint.mintAuthority) && mint.mintAuthority.value === a.payer.address); assert.equal(mint.freezeAuthority.__option, 'None');
  report.mintProvenance = { address: a.mint.address, owner: mintAccount.value.owner, decimals: mint.decimals, mintAuthority: a.payer.address, freezeAuthority: null, supply: mint.supply.toString() };
  stage = 'source-account-rejection';
  await waitSample();
  const sample = await sampleInstruction(a);
  await h.send('reject-primary-substitution', [sdk.fundingComputeBudget(), { ...sample, accounts: sample.accounts.map(x => x.address === a.primary[0].account ? { ...x, address: a.primary[1].account } : x) }], [], 6123);
  await h.send('reject-writable-primary', [sdk.fundingComputeBudget(), { ...sample, accounts: sample.accounts.map(x => x.address === a.primary[0].account ? { ...x, role: AccountRole.WRITABLE } : x) }], [], 6123);
  const makerStates = await Promise.all(a.makers.map(async maker => sdk.makerA.getMakerConfigDecoder().decode((await h.read(maker.config))!).state));
  stage = 'qualify-live-primary';
  const deadline = Date.now() + 600_000;
  let lastSampledAt = (await risk()).oracle.sampledAt;
  let qualified = false, attempt = 0;
  let executed: Awaited<ReturnType<typeof executeOneLot>> | undefined;
  while (Date.now() < deadline && !qualified) {
    const source = await sources();
    // G04 forbids replacing an active epoch. Renew only after actual expiry,
    // including during the unsigned source wait, then obtain a new snapshot.
    let renewed = false;
    for (const [id, maker] of a.makers.entries()) {
      const state = makerStates[id], api = id === 0 ? sdk.makerA : sdk.makerB;
      if (BigInt(unsigned(source.raw.context.slot)) >= state.expirySlot) {
        await h.send(`renew-expired-maker-${id}-${state.quoteEpoch}`, [
          api.getPublishEpochInstruction({ owner: maker.owner, config: maker.config, duration: 3600n }, { programAddress: maker.pricingProgram }),
          await sdk.getSyncMakerEpochInstructionAsync({ ...a, ...maker }, a.options),
        ], [maker.owner]);
        makerStates[id] = api.getMakerConfigDecoder().decode((await h.read(maker.config))!).state;
        renewed = true;
      }
    }
    if (renewed) continue;
    // Unsigned preparation allowance only; the program's 20-second rule is unchanged.
    if (!source.eligible || source.latestAge > 11n || source.now < lastSampledAt + 2n) { await delay(500); continue; }
    attempt++;
    const window: Record<string, any> = { attempt, firstSource: source, samples: [] }; report.sourceWindows.push(window);
    console.log(JSON.stringify({ stage: 'source-window', attempt, maximumAgeSeconds: source.latestAge.toString() }));
    const guards = source.prices.map((p, i) => { const n = normalizeCore(p.price, p.confidence, p.exponent); return guardInstruction(a, i, n.value, n.confidence, p.published); });
    await h.sendObservation(`guard-${source.prices[0].published}-${source.prices[1].published}`, guards, [a.guardAuthority]);
    let previous: sdk.OracleObservedEvent | undefined;
    for (let i = 0; i < 5 && Date.now() < deadline; i++) {
      let before = i === 0 ? source : await sources();
      while (before.now < lastSampledAt + 2n && Date.now() < deadline) { await delay(250); before = await sources(); }
      if (!before.eligible || Date.now() >= deadline) break;
      // This is a conditional atomic attempt, not a claim that recovery is
      // already complete. Clearing must reach Normal at the actual landing time;
      // if either sample or trade fails, both roll back. No time rule is relaxed.
      if (previous && previous.oracle.validSince > 0n && before.now + 1n >= previous.oracle.validSince + 6n) {
        stage = 'atomic-recovery-and-trade';
        executed = await executeOneLot(before, true); qualified = true; break;
      }
      await h.sendObservation(`sample-${before.now}`, [sdk.fundingComputeBudget(), await sampleInstruction(a)]);
      // Confirmed events can prepare a subsequent observation, like live quote
      // previews. Every event/wire must reconcile finalized before acceptance.
      const event = h.latestEvents.find(e => e.type === 'oracle'); assert(event);
      const r = sdk.getOracleObservedEventDecoder().decode(Buffer.from(event.bytes, 'base64'));
      lastSampledAt = r.oracle.sampledAt; previous = r;
      window.samples.push({ before, observation: r, preparationCommitment: 'confirmed' }); persist(`${directory}/progress.json`, report);
      if (r.oracle.status === 2 && r.oracle.sampledAt < r.oracle.sourceDeadline) {
        assert.deepEqual(r.oracle.sourceSequences.slice(0, 2), before.prices.map(p => p.published), 'Source changed during the recorded observation; retain race instead of inventing its snapshot');
        report.usedSource = before; qualified = true; break;
      }
      if (r.oracle.status === 0) break;
    }
    if (!qualified) await delay(500);
  }
  assert(qualified, 'No executable source recovery window within the bounded live observation');
  stage = 'priced-action';
  executed ??= await executeOneLot(report.usedSource, false);
  const { route, observation: r } = executed;
  stage = 'finalize-observations'; await h.reconcileObservations();
  stage = 'natural-source-expiry';
  while ((await h.now()) <= r.oracle.sourceDeadline) await delay(500);
  await waitSample(); await h.send('sample-expired-primary', [sdk.fundingComputeBudget(), await sampleInstruction(a)]);
  const expired = await risk(); assert.equal(expired.oracle.status, 0);
  await h.send('reject-priced-action-after-expiry', [sdk.routeComputeBudget(), route], [a.traderOwner], 6118);
  report.expiry = expired;
  assert(ws.acknowledged && ws.buffer.some(n => n.value.signature === h.checks.find(c => c.label === report.tradeLabel)?.signature), 'No actual clearing WS notice for priced action');
  report.result = 'pass'; report.a18RuntimeChecks = true;
  // Full A18 closeout still requires deployment/source manifests and retained actual
  // update-verification provenance for the primary messages consumed in this run.
} catch (error) {
  report.result = 'fail'; report.failedStage = stage;
  report.failure = error instanceof assert.AssertionError ? error.message : 'Transport or execution failure; inspect retained stage/journal';
  process.exitCode = 1;
} finally {
  try { await h.reconcileObservations(); }
  catch { report.result = 'fail'; report.finalizationFailure = 'Original observation history unresolved or differs; no replacement signed'; process.exitCode = 1; }
  report.finishedUtc = new Date().toISOString(); report.checks = h.checks; report.rateLimits = h.rpc.interruptions;
  report.ws = { acknowledged: ws?.acknowledged ?? false, notifications: ws?.buffer ?? [] };
  ws?.close(); persist(`${directory}/report.json`, report);
  console.log(JSON.stringify({ result: report.result, failedStage: report.failedStage, failure: report.failure, report: `${directory}/report.json`, a18Complete: false }));
}
