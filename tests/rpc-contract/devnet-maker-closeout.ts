import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import * as sdk from '@rivalt/sdk';
import { json } from '../../packages/indexer/src/events.js';
import { devnetContext, privateKey, profile } from './devnet-context.js';
import { DevnetRpc, persist } from './devnet-rpc.js';
import { programDataIdentity } from './devnet-preflight-support.js';
import rollout from '../../ops/devnet-maker-rollout.json';

const directory = process.env.RIVALT_MAKER_ROLLOUT_DIR ?? '.local/devnet/maker-rollout-r030';
assert(/^\.local\/devnet\/[a-z0-9-]+$/.test(directory), 'Use a dedicated local rollout directory');
const baseline = JSON.parse(readFileSync(`${directory}/baseline.json`, 'utf8'));
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), '', 'Commit acceptance before signing');
const context = await devnetContext();
const harness = new DevnetRpc(context, `${directory}/journal`);
const reportPath = `${directory}/acceptance-${new Date().toISOString().replaceAll(':', '-')}.json`;
const report: Record<string, any> = { revision, sourceDirty: false, startedUtc: new Date().toISOString(), baseline: `${directory}/baseline.json` };
let stage = 'verify-deployed-artifacts';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const data = (account: any) => Buffer.from(account.data[0], 'base64');
const original = (key: string) => data(baseline.accounts[key]);
const marketBefore = sdk.getMarketStateDecoder().decode(original(context.market));
// A profile label may change after initialization. Existing market authority
// always comes from its stored domain, never a newly derived profile hash.
const domain = marketBefore.domain;
const checkpoints = `${directory}/checkpoints`;
mkdirSync(checkpoints, { recursive: true, mode: 0o700 });

// A completed step keeps its original capture. Interrupted steps reuse the
// existing exact signed wire through DevnetRpc before checking current state.
async function step(label: string, check: () => Promise<void>) {
  stage = label;
  const path = `${checkpoints}/${label}.json`;
  if (existsSync(path)) return;
  await check();
  persist(path, { revision, completedUtc: new Date().toISOString() });
  console.log(JSON.stringify({ check: label, result: 'pass' }));
}

try {
  await harness.open();
  report.programs = [];
  for (const deployed of baseline.programs) {
    const account = (await harness.account(deployed.programData)).value;
    const identity = programDataIdentity(account);
    assert.equal(identity.upgradeAuthority, profile.deployer);
    const maker = rollout.makers.find(item => item.name === deployed.name);
    if (maker) {
      const payload = data(account).subarray(45);
      assert.equal(hash(payload.subarray(0, maker.elfBytes)), maker.elfSha256);
      assert(payload.length >= maker.elfBytes && payload.subarray(maker.elfBytes).every(byte => byte === 0));
    } else assert.equal(identity.accountSha256, deployed.accountSha256);
    report.programs.push({ name: deployed.name, program: deployed.program, programData: deployed.programData, ...identity });
  }
  const owner = await privateKey(process.env.RIVALT_MAKER_TEST_OWNER_ROLE ?? 'r030-owner');
  const [capital] = await sdk.findParticipantPda({ market: context.market, owner: owner.address }, context.options);
  report.owner = owner.address; report.capital = capital;
  await step('fund-test-owner-rent', async () => {
    await harness.send('fund-test-owner-rent', [getTransferSolInstruction({ source: context.payer, destination: owner.address, amount: 20_000_000n })]);
  });
  const configs = await Promise.all(context.makers.map(async maker => (await getProgramDerivedAddress({ programAddress: maker.pricingProgram,
    seeds: [Buffer.from('maker'), getAddressEncoder().encode(capital)] }))[0]));
  for (const [index, maker] of context.makers.entries()) {
    const api = index === 0 ? sdk.makerA : sdk.makerB;
    await step(`maker-${index}-reject-missing-capital`, async () => {
      assert.equal(await harness.read(capital), null);
      await harness.send(`maker-${index}-reject-missing-capital`, [await api.getInitializeConfigInstructionAsync({ owner, capital,
        config: configs[index], market: context.market, domain, duration: 3600n }, { programAddress: maker.pricingProgram })], [owner], 6001);
      assert.equal(await harness.read(configs[index]), null);
    });
  }
  await step('register-test-participant', async () => {
    await harness.send('register-test-participant', [await sdk.getRegisterParticipantInstructionAsync({ ...context, owner, participant: capital }, context.options)], [owner]);
    const participant = sdk.getParticipantDecoder().decode((await harness.read(capital))!);
    assert.equal(participant.owner, owner.address); assert.equal(participant.cash, 0n); assert.equal(participant.lots, 0n);
  });
  report.approvalsPerformed = 0;
  for (const [index, maker] of context.makers.entries()) {
    const api = index === 0 ? sdk.makerA : sdk.makerB;
    const input = { owner, capital, config: configs[index], market: context.market, domain, duration: 3600n };
    await step(`maker-${index}-reject-unrelated-owner`, async () => {
      const before = await harness.read(capital);
      await harness.send(`maker-${index}-reject-unrelated-owner`, [await api.getInitializeConfigInstructionAsync({ ...input, owner: context.payer },
        { programAddress: maker.pricingProgram })], [], 6000);
      assert.equal(await harness.read(configs[index]), null);
      assert.deepEqual(await harness.read(capital), before);
    });
    await step(`maker-${index}-initialize-legitimate-owner`, async () => {
      await harness.send(`maker-${index}-initialize-legitimate-owner`, [await api.getInitializeConfigInstructionAsync(input,
        { programAddress: maker.pricingProgram })], [owner]);
      const config = api.getMakerConfigDecoder().decode((await harness.read(configs[index]))!).state;
      assert.equal(config.owner, owner.address); assert.equal(config.capital, capital);
      assert.equal(config.market, context.market); assert.equal(config.makerId, index);
      assert.deepEqual(Buffer.from(config.domain), Buffer.from(domain));
    });
    const initialRegistration = sdk.getMakerRegistrationDecoder().decode(original(maker.registration));
    const deployedHash = hash((await harness.read(maker.programData))!);
    // A separate ownership-only rerun must not repeat a completed upgrade or
    // manufacture another approval merely to exercise the old-hash rejection.
    if (Buffer.from(initialRegistration.approvedHash).toString('hex') === deployedHash) continue;
    await step(`maker-${index}-reject-unapproved-upgrade`, async () => {
      await harness.send(`maker-${index}-reject-unapproved-upgrade`, [await sdk.getSyncMakerEpochInstructionAsync({ ...context, ...maker }, context.options)], [], 6114);
    });
    await step(`maker-${index}-jointly-approve`, async () => {
      await harness.send(`maker-${index}-jointly-approve`, [await sdk.getApproveMakerInstructionAsync({ ...context, ...maker, authority: context.payer }, context.options)], [maker.owner]);
      const registration = sdk.getMakerRegistrationDecoder().decode((await harness.read(maker.registration))!);
      const before = sdk.getMakerRegistrationDecoder().decode(original(maker.registration));
      assert.equal(Buffer.from(registration.approvedHash).toString('hex'), hash((await harness.read(maker.programData))!));
      assert.equal(registration.authorityEpoch, before.authorityEpoch + 1n);
      assert.equal(registration.quarantined, false);
      assert.equal(registration.buyConsumed, before.buyConsumed); assert.equal(registration.sellConsumed, before.sellConsumed);
    });
    report.approvalsPerformed++;
  }
  stage = 'final-account-reconciliation';
  const keys = [...Object.keys(baseline.accounts), capital, ...configs] as Address[];
  const accounts = await harness.rpc.call('getMultipleAccounts', [keys, { encoding: 'base64', commitment: 'finalized' }]);
  report.accounts = Object.fromEntries(keys.map((key, index) => [key, accounts.value[index]]));
  const changed = new Set<string>([context.market, context.registry, ...context.makers.map(maker => maker.registration)]);
  for (const key of Object.keys(baseline.accounts)) if (!changed.has(key)) {
    assert.equal(report.accounts[key].owner, baseline.accounts[key].owner);
    assert.deepEqual(data(report.accounts[key]), original(key), `Unexpected existing-account mutation: ${key}`);
  }
  const marketAfter = sdk.getMarketStateDecoder().decode(data(report.accounts[context.market]));
  assert.equal(marketBefore.mode, 2);
  assert.equal(json(marketAfter), json({ ...marketBefore, sequence: marketBefore.sequence + 1n + BigInt(report.approvalsPerformed),
    configEpoch: marketBefore.configEpoch + BigInt(report.approvalsPerformed) }));
  const registryBefore = sdk.getParticipantRegistryDecoder().decode(original(context.registry));
  const registryAfter = sdk.getParticipantRegistryDecoder().decode(data(report.accounts[context.registry]));
  assert.equal(json(registryAfter), json({ ...registryBefore, count: registryBefore.count + 1, members: [...registryBefore.members, capital] }));
  report.market = context.market; report.registry = context.registry; report.vault = context.vault;
  report.makers = context.makers.map((maker, index) => ({ capital: maker.capital, registration: maker.registration, config: configs[index] }));
  report.checks = readdirSync(harness.journal).filter(file => file.endsWith('.json')).map(file => {
    const entry = JSON.parse(readFileSync(`${harness.journal}/${file}`, 'utf8'));
    assert.equal(entry.finalized, true); return { label: entry.label, signature: entry.signature, error: entry.history.meta.err,
      feeLamports: entry.feeLamports, journal: `${harness.journal}/${file}` };
  });
  assert.equal(report.checks.length, 8 + 2 * report.approvalsPerformed);
  report.result = 'pass';
} catch (error) {
  report.result = 'fail'; report.failedStage = stage;
  // Assertion text is bounded to this harness; provider exception text is omitted.
  if (error instanceof assert.AssertionError) report.assertion = error.message.slice(0, 500);
  process.exitCode = 1;
} finally {
  report.finishedUtc = new Date().toISOString(); persist(reportPath, report);
  console.log(JSON.stringify({ result: report.result, failedStage: report.failedStage, report: reportPath }));
}
