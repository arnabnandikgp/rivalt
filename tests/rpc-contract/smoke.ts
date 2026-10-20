import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { getAddressEncoder, getBase58Decoder, getBase58Encoder, getProgramDerivedAddress, isSome } from '@solana/kit';
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import {
  CLEARING_PROGRAM_ADDRESS, findRecordPda, getProbeInstructionAsync,
  getProbeInstructionDataDecoder, getProbeRecordDecoder, parseProbeRecordedEvent,
  PROBE_RECORDED_EVENT_DISCRIMINATOR, signInstructions,
} from '@rivalt/sdk';
import { eventually, WireRpc, WireSubscriptions } from './wire.js';

const url = process.env.RIVALT_RPC_URL!;
assert(new URL(url).hostname === '127.0.0.1', 'P01 fixture keys are restricted to loopback');
const runDir = process.env.RIVALT_RUN_DIR!;
const rpc = new WireRpc(url);
const connection = new Connection(url, { commitment: 'confirmed', wsEndpoint: process.env.RIVALT_WS_URL });
const payer = await Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync('.local/keys/payer.json', 'utf8'))));
const program = CLEARING_PROGRAM_ADDRESS;
const [eventAuthority] = await getProgramDerivedAddress({ programAddress: program, seeds: [new TextEncoder().encode('__event_authority')] });
const base58 = getBase58Decoder();
const unbase58 = getBase58Encoder();
const json = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
const save = (name: string, value: unknown) => writeFileSync(`${runDir}/${name}.json`, json(value));
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const websocket = new WireSubscriptions(process.env.RIVALT_WS_URL!);
const subscriptions: Array<{ method: string; id: number }> = [];
const summary: Record<string, unknown> = {
  startedUtc: new Date().toISOString(),
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
  program, binarySha256: hash('target/deploy/clearing.so'), idlSha256: hash('packages/sdk/idl/clearing.json'),
  cargoLockSha256: hash('Cargo.lock'), pnpmLockSha256: hash('pnpm-lock.yaml'),
  runId: runDir.split('/').at(-1), signatureVerification: true, blockhashVerification: true,
};

async function probe(nonce: bigint, signedValue = -(1n << 127n)) {
  return getProbeInstructionAsync({ owner: payer, eventAuthority, program, nonce, signedValue,
    optionalValue: (1n << 64n) - 1n, choice: { __kind: 'Number', value: 9007199254740993n } });
}
async function finalized(signature: string) {
  return eventually(() => rpc.call('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]),
    result => result.value[0]?.confirmationStatus === 'finalized', `finalized ${signature}`);
}
async function fetchTransaction(signature: string) {
  return eventually(() => rpc.call('getTransaction', [signature, { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]),
    value => Boolean(value), 'transaction history');
}
async function subscribe(method: string, params: unknown[]) {
  const id = await websocket.call(method, params);
  subscriptions.push({ method, id });
  return id;
}

try {
  await websocket.ready();
  summary.runtime = await rpc.call('getVersion');
  summary.genesisHash = await rpc.call('getGenesisHash');
  summary.blockHeight = await rpc.call('getBlockHeight', [{ commitment: 'confirmed' }]);
  const nonce = 9007199254740993n;
  const firstInstruction = await probe(nonce);
  const record = firstInstruction.accounts[1].address;
  const accountSub = await subscribe('accountSubscribe', [record, { encoding: 'base64', commitment: 'confirmed' }]);
  const programSub = await subscribe('programSubscribe', [program, { encoding: 'base64', commitment: 'confirmed' }]);
  const logsSub = await subscribe('logsSubscribe', [{ mentions: [program] }, { commitment: 'confirmed' }]);
  const slotSub = await subscribe('slotSubscribe', []);
  const { transaction } = await signInstructions(connection, payer, [firstInstruction]);
  const signature = base58.decode(transaction.signatures[0]);
  const signatureSub = await subscribe('signatureSubscribe', [signature, { commitment: 'confirmed' }]);
  const wire = transaction.serialize();
  const simulation = await rpc.call('simulateTransaction', [Buffer.from(wire).toString('base64'), { encoding: 'base64', sigVerify: true, commitment: 'confirmed' }]);
  assert.equal(simulation.value.err, null);
  const badSignature = Uint8Array.from(wire);
  badSignature[1] ^= 1;
  await assert.rejects(rpc.call('sendTransaction', [Buffer.from(badSignature).toString('base64'), { encoding: 'base64', skipPreflight: true }]), /signature/i);
  assert.equal(await connection.sendRawTransaction(wire, { skipPreflight: false, preflightCommitment: 'confirmed' }), signature);
  const firstStatus = await finalized(signature);
  assert.equal(firstStatus.value[0].err, null);
  const history = await fetchTransaction(signature);
  assert.equal(history.meta.err, null);
  const fetchedWire = await rpc.call('getTransaction', [signature, { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
  assert.deepEqual(Buffer.from(fetchedWire.transaction[0], 'base64'), Buffer.from(wire));
  const fetched = VersionedTransaction.deserialize(Buffer.from(fetchedWire.transaction[0], 'base64'));
  const publicKey = createPublicKey({ key: Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(getAddressEncoder().encode(payer.address)),
  ]), format: 'der', type: 'spki' });
  assert(verify(null, fetched.message.serialize(), publicKey, fetched.signatures[0]));
  const outer = history.transaction.message.instructions.find((ix: any) => history.transaction.message.accountKeys[ix.programIdIndex] === program);
  const decodedInstruction = getProbeInstructionDataDecoder().decode(unbase58.encode(outer.data));
  assert.equal(decodedInstruction.nonce, nonce);
  assert.equal(decodedInstruction.signedValue, -(1n << 127n));
  const account = await rpc.call('getAccountInfo', [record, { encoding: 'base64', commitment: 'finalized' }]);
  assert.equal(account.value.owner, program);
  const decodedAccount = getProbeRecordDecoder().decode(Buffer.from(account.value.data[0], 'base64'));
  assert.equal(decodedAccount.owner, payer.address);
  assert.equal(decodedAccount.nonce, nonce);
  assert.equal(decodedAccount.signedValue, -(1n << 127n));
  assert(isSome(decodedAccount.optionalValue));
  assert.equal(decodedAccount.optionalValue.value, (1n << 64n) - 1n);
  assert.deepEqual(decodedAccount.choice, { __kind: 'Number', value: 9007199254740993n });
  // Anchor event-CPI: 8-byte instruction tag followed by event discriminator and payload.
  const inner = history.meta.innerInstructions.flatMap((entry: any) => entry.instructions)
    .filter((ix: any) => history.transaction.message.accountKeys[ix.programIdIndex] === program);
  const eventData = inner.map((ix: any) => Buffer.from(unbase58.encode(ix.data)))
    .find((bytes: Buffer) => bytes.subarray(8, 16).equals(Buffer.from(PROBE_RECORDED_EVENT_DISCRIMINATOR)));
  assert(eventData, 'critical event must be recoverable from inner instructions');
  assert.equal(eventData.subarray(0, 8).toString('hex'), 'e445a52e51cb9a1d');
  const decodedEvent = parseProbeRecordedEvent(eventData.subarray(8));
  assert.equal(decodedEvent.record, record);
  assert.equal(decodedEvent.signedValue, decodedAccount.signedValue);
  assert.equal(decodedEvent.nonce, nonce);
  assert.equal(decodedEvent.schemaVersion, 1);
  assert.deepEqual(decodedEvent.choice, decodedAccount.choice);
  save('live-conformance', { accountBase64: account.value.data[0], eventBase64: eventData.subarray(8).toString('base64'),
    nonce, signedValue: decodedAccount.signedValue, record });
  execFileSync(process.execPath, ['tests/anchor-conformance/conformance.cjs', `${runDir}/live-conformance.json`]);
  const notifications = await Promise.all([accountSub, programSub, logsSub, slotSub, signatureSub].map(id => websocket.notification(id)));
  assert.equal(notifications[0].params.result.value.owner, program);
  assert.equal(notifications[2].params.result.value.signature, signature);
  assert.equal(notifications[4].params.result.value.err, null);
  save('subscriptions', notifications);
  save('transaction', history);
  save('account', account);
  save('event', decodedEvent);
  const signatures = [signature];
  for (const next of [2n, 3n]) {
    const { transaction: tx } = await signInstructions(connection, payer, [await probe(next, next)]);
    const sig = await connection.sendRawTransaction(tx.serialize());
    assert.equal((await finalized(sig)).value[0].err, null);
    signatures.push(sig);
  }
  const rollbackNonce = 4n;
  const failureNonce = (1n << 64n) - 1n;
  const { transaction: failed } = await signInstructions(connection, payer, [await probe(rollbackNonce), await probe(failureNonce)]);
  const failedSignature = await connection.sendRawTransaction(failed.serialize(), { skipPreflight: true });
  assert.notEqual((await finalized(failedSignature)).value[0].err, null);
  const failedHistory = await fetchTransaction(failedSignature);
  assert.deepEqual(failedHistory.meta.err, { InstructionError: [1, { Custom: 6000 }] });
  const revertedEvents = failedHistory.meta.innerInstructions.flatMap((entry: any) => entry.instructions)
    .filter((ix: any) => failedHistory.transaction.message.accountKeys[ix.programIdIndex] === program)
    .map((ix: any) => Buffer.from(unbase58.encode(ix.data)))
    .filter((bytes: Buffer) => bytes.subarray(8, 16).equals(Buffer.from(PROBE_RECORDED_EVENT_DISCRIMINATOR)));
  assert.equal(revertedEvents.length, 1, 'failed transaction retains the first instruction’s event; it must not be projected');
  assert.equal(parseProbeRecordedEvent(revertedEvents[0].subarray(8)).nonce, rollbackNonce);
  const failedAccounts = await rpc.call('getMultipleAccounts', [
    await Promise.all([rollbackNonce, failureNonce].map(async n => (await findRecordPda({ owner: payer.address, nonce: n }))[0])),
    { encoding: 'base64', commitment: 'finalized' },
  ]);
  assert.deepEqual(failedAccounts.value, [null, null]);
  save('failed-transaction', failedHistory);
  const programAccounts = await rpc.call('getProgramAccounts', [program, { encoding: 'base64', commitment: 'finalized' }]);
  assert.equal(programAccounts.length, 3);
  const multiple = await rpc.call('getMultipleAccounts', [[record, program], { encoding: 'base64', commitment: 'finalized' }]);
  assert.deepEqual(multiple.value[0], account.value);
  assert.equal(multiple.value[1].executable, true);
  const allHistory = await rpc.call('getSignaturesForAddress', [program, { limit: 100, commitment: 'finalized' }]);
  const collected: any[] = [];
  let before: string | undefined;
  for (let page = 0; page < 30; page++) {
    const entries = await rpc.call('getSignaturesForAddress', [program, { limit: 2, commitment: 'finalized', ...(before ? { before } : {}) }]);
    if (!entries.length) break;
    collected.push(...entries);
    before = entries.at(-1).signature;
  }
  assert.deepEqual(collected.map(e => e.signature), allHistory.map((e: any) => e.signature));
  assert.equal(new Set(collected.map(e => e.signature)).size, collected.length);
  for (const sig of [...signatures, failedSignature]) assert(collected.some(e => e.signature === sig));
  assert.notEqual(collected.find(e => e.signature === failedSignature).err, null);
  const until = allHistory[2].signature;
  const bounded = await rpc.call('getSignaturesForAddress', [program, { until, limit: 100, commitment: 'finalized' }]);
  assert.deepEqual(bounded.map((e: any) => e.signature), allHistory.slice(0, 2).map((e: any) => e.signature));
  save('history', { allHistory, paginated: collected, until, bounded });
  Object.assign(summary, { result: 'pass', finishedUtc: new Date().toISOString(), signatures, failedSignature,
    simulationUnits: simulation.value.unitsConsumed, transactionBytes: wire.length,
    accountCount: history.transaction.message.accountKeys.length, historyEntries: collected.length,
    subscriptions: subscriptions.map(s => s.method), independentSignatureVerification: 'pass',
    legacyLiveDecode: 'pass', failedTransactionRollback: 'pass',
    limitations: ['Offline Surfpool is not consensus finality evidence.', 'Token balance reads begin with actual custody in P02; SQL recovery is P05.'] });
  save('summary', summary);
  console.log(json(summary));
} catch (error) {
  save('summary', { ...summary, result: 'fail', error: String(error) });
  throw error;
} finally {
  for (const { method, id } of subscriptions) {
    if (method !== 'signatureSubscribe') await websocket.call(method.replace('Subscribe', 'Unsubscribe'), [id]).catch(() => {});
  }
  websocket.close();
}
