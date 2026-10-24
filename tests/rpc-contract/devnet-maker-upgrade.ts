import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { Rpc } from '../../packages/indexer/src/rpc.js';
import * as sdk from '@rivalt/sdk';
import { devnetContext, privateKey, profile } from './devnet-context.js';
import { checkedGenesis, configuration, observeSlot, programDataAddress, programDataIdentity, unsigned } from './devnet-preflight-support.js';
import { persist } from './devnet-rpc.js';
import rollout from '../../ops/devnet-maker-rollout.json';

// This bounded maintenance command upgrades only the two pinned devnet makers.
// CLI retries apply to program uploads; financial acceptance uses DevnetRpc's
// original-signature journal separately. Existing captures are never overwritten.
const directory = '.local/devnet/maker-rollout-r030';
const configurationValues = configuration(process.env);
const rpc = new Rpc(configurationValues.rpc);
const run = promisify(execFile);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), '', 'Commit the rollout before execution');
execFileSync('git', ['diff', '--exit-code', rollout.buildRevision, 'HEAD', '--', 'programs', 'crates', 'Cargo.toml', 'Cargo.lock'], { stdio: 'pipe' });
process.umask(0o077);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const reportPath = `${directory}/upgrade-${new Date().toISOString().replaceAll(':', '-')}.json`;
const report: Record<string, any> = { revision, sourceDirty: false, build: rollout, startedUtc: new Date().toISOString(), commands: [] };
let stage = 'preflight';

async function inventory() {
  const names = Object.keys(profile.programs);
  const programs = await rpc.call('getMultipleAccounts', [names.map(name => profile.programs[name]), { encoding: 'base64', commitment: 'finalized' }]);
  const addresses = programs.value.map(programDataAddress);
  const accounts = await rpc.call('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'finalized', minContextSlot: programs.context.slot }]);
  return names.map((name, index) => ({ name, program: profile.programs[name], programData: addresses[index],
    account: accounts.value[index], ...programDataIdentity(accounts.value[index]) }));
}
function matches(account: any, length: number, hash: string) {
  const payload = Buffer.from(account.data[0], 'base64').subarray(45);
  return payload.length >= length && sha256(payload.subarray(0, length)) === hash && payload.subarray(length).every(byte => byte === 0);
}
function validateInventory(rows: Awaited<ReturnType<typeof inventory>>, requireNew: boolean) {
  for (const row of rows) {
    assert.equal(row.upgradeAuthority, profile.deployer);
    const maker = rollout.makers.find(item => item.name === row.name);
    if (maker) assert(matches(row.account, maker.elfBytes, maker.elfSha256) ||
      (!requireNew && matches(row.account, maker.previousElfBytes, maker.previousElfSha256)), `Unexpected ${row.name} bytes`);
    else assert.equal(row.accountSha256, rollout.unchangedProgramDataHashes[row.name as keyof typeof rollout.unchangedProgramDataHashes]);
  }
}
async function finalizedHistory(signature: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const history = await rpc.call('getTransaction', [signature, { commitment: 'finalized', encoding: 'json', maxSupportedTransactionVersion: 0 }]);
    if (history?.meta) {
      assert.equal(history.transaction.signatures[0], signature);
      assert.equal(history.meta.err, null);
      return history;
    }
    await delay(1000);
  }
  throw new Error('Upgrade signature not yet finalized');
}

try {
  report.genesis = checkedGenesis(await rpc.call('getGenesisHash'));
  report.websocket = await observeSlot(configurationValues.ws);
  const context = await devnetContext();
  for (const maker of rollout.makers) {
    const artifact = readFileSync(`${rollout.artifactDirectory}/${maker.name}.so`);
    assert.equal(artifact.length, maker.elfBytes); assert.equal(sha256(artifact), maker.elfSha256);
    assert.equal((await privateKey(maker.keyRole)).address, profile.programs[maker.name]);
  }
  report.before = await inventory(); validateInventory(report.before, false);
  const baselinePath = `${directory}/baseline.json`;
  if (!existsSync(baselinePath)) {
    // Preserve the original pre-upgrade accounts through every resumable attempt.
    const registryAccount = await rpc.call('getAccountInfo', [context.registry, { encoding: 'base64', commitment: 'finalized' }]);
    const registry = sdk.getParticipantRegistryDecoder().decode(Buffer.from(registryAccount.value.data[0], 'base64'));
    const addresses = [...new Set([context.market, context.registry, context.vault, context.routeState, context.exitGuard,
      ...registry.members, ...context.makers.flatMap(maker => [maker.capital, maker.registration, maker.config])])];
    const accounts = await rpc.call('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'finalized' }]);
    assert(accounts.value.every(Boolean), 'Existing deployment accounts must exist');
    persist(baselinePath, { revision, observedUtc: new Date().toISOString(), programs: report.before,
      slot: unsigned(accounts.context.slot), accounts: Object.fromEntries(addresses.map((key, index) => [key, accounts.value[index]])) });
  }
  report.balanceBefore = unsigned((await rpc.call('getBalance', [profile.deployer, { commitment: 'finalized' }])).value);
  assert(BigInt(report.balanceBefore) >= 1_500_000_000n, 'Insufficient test SOL for temporary upload buffer and fees');
  for (const maker of rollout.makers) {
    const current = (await inventory()).find(row => row.name === maker.name)!;
    if (matches(current.account, maker.elfBytes, maker.elfSha256)) continue;
    stage = `upgrade-${maker.name}`;
    await privateKey(`r030-${maker.keyRole}-buffer`);
    console.log(JSON.stringify({ stage, program: current.program }));
    const result = await run('solana', ['program', 'deploy', `${rollout.artifactDirectory}/${maker.name}.so`,
      '--program-id', current.program, '--upgrade-authority', '.local/devnet/keys/deployer.json',
      '--buffer', `.local/devnet/keys/r030-${maker.keyRole}-buffer.json`, '--keypair', '.local/devnet/keys/deployer.json',
      '--url', configurationValues.rpc, '--use-rpc', '--max-sign-attempts', '20', '--with-compute-unit-price', '0', '--output', 'json'],
    { timeout: 900_000, maxBuffer: 4 * 1024 * 1024 });
    // Keep only structured public fields; CLI diagnostics may contain URLs.
    const output = JSON.parse(result.stdout);
    assert.equal(output.programId, current.program);
    assert.equal(typeof output.signature, 'string');
    report.commands.push({ maker: maker.name, signature: output.signature, history: await finalizedHistory(output.signature) });
    persist(reportPath, report);
  }
  stage = 'finalized-program-verification';
  report.after = await inventory(); validateInventory(report.after, true);
  report.balanceAfter = unsigned((await rpc.call('getBalance', [profile.deployer, { commitment: 'finalized' }])).value);
  report.result = 'pass';
} catch {
  report.result = 'fail'; report.failedStage = stage; process.exitCode = 1;
  // The next invocation first inspects actual program bytes and resumes the same
  // explicit buffers. It does not infer failure/nonexecution from a CLI error.
} finally {
  report.finishedUtc = new Date().toISOString(); persist(reportPath, report);
  console.log(JSON.stringify({ result: report.result, failedStage: report.failedStage, report: reportPath }));
}
