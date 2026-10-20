import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { getBase58Encoder } from '@solana/kit';
import { Connection } from '@solana/web3.js';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { signInstructions, CUSTODY_CHANGED_EVENT_DISCRIMINATOR, parseCustodyChangedEvent,
  getParticipantRegistryDecoder } from '@rivalt/sdk';
import { custodyCases, payerKey, program, type Harness } from './custody-cases.js';
import { eventually, WireRpc, WireSubscriptions } from './wire.js';

const url = process.env.RIVALT_RPC_URL!;
assert.equal(new URL(url).hostname, '127.0.0.1', 'deterministic keys are local only');
const runDir = process.env.RIVALT_RUN_DIR!;
const rpc = new WireRpc(url), connection = new Connection(url, 'confirmed');
const ws = new WireSubscriptions(process.env.RIVALT_WS_URL!);
const payer = await payerKey();
const checks: unknown[] = [], successfulEvents: ReturnType<typeof parseCustodyChangedEvent>[] = [];
const successfulEventBytes: string[] = [];
const bytes = getBase58Encoder();
const serialize = (v: unknown) => JSON.stringify(v, (_, n) =>
  typeof n === 'bigint' ? n.toString() :
  n instanceof Uint8Array ? Array.from(n) :
  n?.type === 'Buffer' && Array.isArray(n.data) ? n.data : n, 2) + '\n';
await ws.ready();
const subscription = await ws.call('logsSubscribe', [{ mentions: [program] }, { commitment: 'confirmed' }]);
const h: Harness = {
  async rent(size) { return BigInt(await rpc.call('getMinimumBalanceForRentExemption', [size])); },
  async read(key) {
    const account = await rpc.call('getAccountInfo', [key, { encoding: 'base64', commitment: 'finalized' }]);
    if (account.value) assert([program, TOKEN_PROGRAM_ADDRESS].includes(account.value.owner));
    return account.value ? Buffer.from(account.value.data[0], 'base64') : null;
  },
  async send(label, instructions, signers = [], expectedError) {
    const { transaction } = await signInstructions(connection, payer, instructions, signers);
    const wire = Buffer.from(transaction.serialize()).toString('base64');
    const simulation = await rpc.call('simulateTransaction', [wire, { encoding: 'base64', sigVerify: true, commitment: 'confirmed' }]);
    if (expectedError === undefined) assert.equal(simulation.value.err, null, `${label}: ${simulation.value.logs?.join('\n')}`);
    else assert.equal(simulation.value.err?.InstructionError?.[1]?.Custom, expectedError, `${label}: ${simulation.value.logs?.join('\n')}`);
    const signature = await rpc.call('sendTransaction', [wire, { encoding: 'base64', skipPreflight: true }]);
    const statuses = await eventually(() => rpc.call('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]),
      r => r.value[0]?.confirmationStatus === 'finalized', label);
    const history = await eventually(() => rpc.call('getTransaction', [signature, { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]),
      r => Boolean(r), `history ${label}`);
    const err = statuses.value[0].err;
    if (expectedError === undefined) {
      assert.equal(err, null, label);
      assert.equal(history.meta.err, null);
    } else {
      assert.equal(err?.InstructionError?.[1]?.Custom, expectedError, label);
      assert.deepEqual(history.meta.err, err);
    }
    const eventData = history.meta.innerInstructions.flatMap((i: any) => i.instructions)
      .filter((i: any) => history.transaction.message.accountKeys[i.programIdIndex] === program)
      .map((i: any) => Buffer.from(bytes.encode(i.data)))
      .filter((b: Buffer) => b.subarray(8, 16).equals(Buffer.from(CUSTODY_CHANGED_EVENT_DISCRIMINATOR)));
    const events = eventData.map((b: Buffer) => parseCustodyChangedEvent(b.subarray(8)));
    if (expectedError === undefined) {
      successfulEvents.push(...events);
      successfulEventBytes.push(...eventData.map((b: Buffer) => b.subarray(8).toString('base64')));
    }
    if (label.startsWith('rollback earlier')) {
      assert.equal(events.length, 1, 'failed transaction must retain a reverted custody event');
      writeFileSync(`${runDir}/custody-failed-transaction.json`, serialize(history));
    }
    checks.push({ label, signature, status: expectedError === undefined ? 'pass' : 'rejected', error: err,
      bytes: transaction.serialize().length, simulationComputeUnits: simulation.value.unitsConsumed, eventCount: events.length });
  },
};
try {
  const result = await custodyCases(h);
  const tokenBalance = await rpc.call('getTokenAccountBalance', [result.addresses.vault, { commitment: 'finalized' }]);
  assert.equal(tokenBalance.value.decimals, 6);
  assert.equal(tokenBalance.value.amount, '10007');
  await ws.notification(subscription);
  assert(successfulEvents.length >= 10);
  successfulEvents.forEach((event, i) => {
    assert.equal(event.sequence, BigInt(i + 1));
    assert.equal(event.schemaVersion, 1);
    assert.equal(event.market, result.addresses.market);
    assert.equal(event.allocatedVault, event.totalCash + event.settlement + event.insurance + event.fees);
  });
  assert.equal(successfulEvents.at(-1)!.participantCash, 0n);
  assert.equal(successfulEvents.at(-1)!.actualVault, 10_007n);
  const registryBytes = (await h.read(result.addresses.registry))!;
  const live = { accounts: {
    marketState: (await h.read(result.addresses.market))!.toString('base64'),
    participant: (await h.read(result.addresses.participant))!.toString('base64'),
    participantRegistry: registryBytes.toString('base64'),
  }, events: successfulEventBytes };
  writeFileSync(`${runDir}/custody-conformance.json`, serialize(live));
  const legacy = JSON.parse(execFileSync(process.execPath, ['tests/anchor-conformance/custody.cjs', `${runDir}/custody-conformance.json`], { encoding: 'utf8' }));
  const canonical = (value: unknown) => {
    const copy = JSON.parse(serialize(value)); delete copy.discriminator; return copy;
  };
  assert.deepEqual(legacy.accounts.marketState, canonical(result.finalMarket));
  assert.deepEqual(legacy.accounts.participant, canonical(result.finalParticipant));
  assert.deepEqual(legacy.accounts.participantRegistry, canonical(getParticipantRegistryDecoder().decode(registryBytes)));
  legacy.events.forEach((event: any, i: number) => assert.deepEqual(event.data, canonical(successfulEvents[i])));
  const summary = {
    runtime: await rpc.call('getVersion'), genesisHash: await rpc.call('getGenesisHash'),
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
    binarySha256: createHash('sha256').update(readFileSync('target/deploy/clearing.so')).digest('hex'),
    idlSha256: createHash('sha256').update(readFileSync('packages/sdk/idl/clearing.json')).digest('hex'),
    checks, successfulEvents, result, tokenBalance, logsNotifications: ws.notifications.length,
  };
  writeFileSync(`${runDir}/custody.json`, serialize(summary));
  console.log(`Surfpool custody: ${checks.length} signed scenarios; ${successfulEvents.length} committed events; exact vault = insurance = 10007 atoms.`);
} finally { ws.close(); }
