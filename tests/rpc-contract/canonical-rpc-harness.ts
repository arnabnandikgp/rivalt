import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { getBase58Decoder, getTransactionDecoder, getCompiledTransactionMessageDecoder } from '@solana/kit';
import { Connection, VersionedTransaction } from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import { payerKey } from './harness.js';
import type { CanonicalHarness } from './canonical-maker-cases.js';
import { CanonicalConformance } from './canonical-maker-conformance.js';
import { WireRpc, WireSubscriptions, eventually } from './wire.js';

export async function openCanonicalRpcHarness(url: string,wsUrl: string,runDir: string,
  options: { computeUnitLimit?: (label: string,instructions: readonly unknown[]) => number;
    maxLoadedAccounts?: (label: string) => number | undefined;
    observeOutcomes?: (label: string) => boolean;
    beforeBroadcast?: (label: string) => Promise<void>;
    deferFinality?: boolean } = {}) {
assert.equal(new URL(url).hostname, '127.0.0.1');
const rpc = new WireRpc(url), connection = new Connection(url, 'confirmed');
const ws = new WireSubscriptions(wsUrl);
const payer = await payerKey();
const checks: Record<string, unknown>[] = [];
const serialize = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2)+'\n';
await ws.ready();
const subscription = await ws.call('logsSubscribe', ['all', { commitment: 'confirmed' }]);
const conformance = new CanonicalConformance();
let latestHistory: any;
let nextTransaction = 0;
let verificationError: unknown;
const verifications: Promise<void>[] = [];
const flush = async () => { await Promise.all(verifications); if (verificationError) throw verificationError; };
const h: CanonicalHarness = {
  async rent(size) { return BigInt(await rpc.call('getMinimumBalanceForRentExemption', [size])); },
  async read(key) {
    const response = await rpc.call('getAccountInfo', [key, { encoding: 'base64', commitment: options.deferFinality ? 'confirmed' : 'finalized' }]);
    return response.value ? Buffer.from(response.value.data[0], 'base64') : null;
  },
  async send(label, instructions, signers = [], expectedError) {
    if (verificationError) throw verificationError;
    const transactionIndex = nextTransaction++;
    const started = performance.now();
    const observeOutcome = options.observeOutcomes?.(label) ?? false;
    const computeUnitLimit = options.computeUnitLimit?.(label,instructions)
      ?? (label.startsWith('reprice ') ? 100_000 : instructions.length > 1 && label.startsWith('atomic') ? 800_000 : 400_000);
    const { transaction, v0Bytes, wireBytes } = await sdk.signCanonicalInstructions(connection, payer, instructions,
      { computeUnitLimit, loadedAccountsDataSizeLimit: 8 * 1024 * 1024 }, signers);
    const wire = transaction.serialize(), wireBase64 = Buffer.from(wire).toString('base64');
    const signedAt = performance.now();
    let confirmedMs: number | undefined;
    const expectedSignature = getBase58Decoder().decode(transaction.signatures[0]);
    const saved = { label, wireBase64, signature: expectedSignature, version: transaction.version, v0Bytes, wireBytes };
    writeFileSync(`${runDir}/wire-${transactionIndex}.json`, serialize(saved));
    console.log(`${transactionIndex}: ${label}: v${transaction.version} ${wireBytes} bytes (v0 ${v0Bytes})`);
    const simulation = await rpc.call('simulateTransaction', [wireBase64, { encoding: 'base64', sigVerify: true, commitment: 'confirmed' }]);
    writeFileSync(`${runDir}/simulation-${transactionIndex}.json`, serialize(simulation));
    if (observeOutcome) { /* Timed offers retain and classify every actual outcome. */ }
    else if (expectedError === undefined) assert.equal(simulation.value.err, null, `${label}: ${simulation.value.logs?.join('\n')}`);
    else assert.equal(simulation.value.err?.InstructionError?.[1]?.Custom, expectedError, `${label}: ${simulation.value.logs?.join('\n')}`);
    // Subscribe after simulation, before broadcast. The acknowledgement is a WS
    // ordering barrier: simulation logs cannot satisfy the landing observation.
    const signatureSubscription = await ws.call('signatureSubscribe', [expectedSignature,
      { commitment: 'finalized', enableReceivedNotification: false }]);
    const notificationOffset = ws.notifications.length;
    await options.beforeBroadcast?.(label);
    const signature = await rpc.call('sendTransaction', [wireBase64, { encoding: 'base64', skipPreflight: true }]);
    assert.equal(signature, expectedSignature);
    const verify = async () => {
    try {
      await eventually(() => rpc.call('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]),
        response => response.value[0]?.confirmationStatus === 'finalized', label);
    } catch (error) {
      // Preserve the actual commitment/expiry state when a local runtime stalls;
      // neither a timeout nor a successful simulation proves final execution.
      const diagnostics = await Promise.allSettled([
        rpc.call('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]),
        rpc.call('getSlot', [{ commitment: 'finalized' }]),
        rpc.call('getBlockHeight', [{ commitment: 'finalized' }]),
      ]);
      writeFileSync(`${runDir}/finality-timeout-${transactionIndex}.json`, serialize({label,signature,
        elapsedMs:performance.now()-started,error:String(error),diagnostics}));
      throw error;
    }
    const history = await eventually(() => rpc.call('getTransaction', [signature,
      { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 1 }]), value => Boolean(value), `fetch ${label}`);
    // Preserve a landed result even when a later resource or parity check fails.
    writeFileSync(`${runDir}/transaction-${transactionIndex}.json`, serialize(history));
    const loadedAccounts = new Set([...history.transaction.message.accountKeys,
      ...history.meta.loadedAddresses?.writable ?? [], ...history.meta.loadedAddresses?.readonly ?? []]).size;
    const maximumLoadedAccounts = options.maxLoadedAccounts?.(label);
    if (maximumLoadedAccounts !== undefined) assert(loadedAccounts <= maximumLoadedAccounts, `${label}: loaded account budget`);
    assert.equal(history.transaction.signatures[0], signature);
    if (observeOutcome) { /* Acceptance separately audits successes and atomic failures. */ }
    else if (expectedError === undefined) assert.equal(history.meta.err, null, label);
    else assert.equal(history.meta.err?.InstructionError?.[1]?.Custom, expectedError, label);
    assert(history.meta.computeUnitsConsumed <= computeUnitLimit * 0.8, `${label}: 20% CU headroom`);
    const binary = await rpc.call('getTransaction', [signature, { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 1 }]);
    const fetched = Buffer.from(binary.transaction[0], 'base64');
    assert.deepEqual(fetched, Buffer.from(wire));
    const decoded = VersionedTransaction.deserialize(fetched);
    assert.equal(decoded.version, transaction.version);
    const independent = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(fetched).messageBytes);
    assert.equal(independent.version, transaction.version);
    const notification: any = await eventually(async () => ws.notifications.slice(notificationOffset).find(message => message.params?.subscription === subscription
      && message.params.result.value.signature === signature), Boolean, `WS ${label}`);
    const signatureNotification = await ws.notification(signatureSubscription);
    // WS is a discovery hint; finalized fetched status controls application.
    // Surfpool 1.6.1 can announce rejected transactions with err:null. Preserve
    // the discrepancy and prove failed state is excluded via case snapshots.
    if (!observeOutcome && expectedError === undefined) assert.equal(notification.params.result.value.err, null);
    const wsErrorMatchesFinalized = JSON.stringify(notification.params.result.value.err) === JSON.stringify(history.meta.err);
    writeFileSync(`${runDir}/ws-${transactionIndex}.json`, serialize({ logs: notification, signature: signatureNotification }));
    checks[transactionIndex] = { label, signature, version: transaction.version, v0Bytes, bytes: wireBytes,
      error: history.meta.err, confirmationMs: performance.now() - started, computeUnits: history.meta.computeUnitsConsumed, computeUnitLimit,
      buildSignMs: signedAt - started, signedToConfirmedMs: confirmedMs, simulationError: simulation.value.err,
      loadedAccounts, feeLamports: String(history.meta.fee), signatures: transaction.signatures.length, ws: true, wsErrorMatchesFinalized, wsError: notification.params.result.value.err, signatureWsError: signatureNotification.params.result.value.err };
    conformance.record(instructions, history);
    latestHistory = history;
    };
    if (options.deferFinality) {
      // Live qualification cannot wait 32 slots between every independent
      // publication. Keep the full finalized-byte/resource/WS audit in flight,
      // require confirmed execution now, and require flush before any pass claim.
      verifications.push(verify().catch(error => { verificationError ??= error; }));
      const confirmed = await eventually(() => rpc.call('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]),
        response => ['confirmed', 'finalized'].includes(response.value[0]?.confirmationStatus), `confirmed ${label}`);
      confirmedMs = performance.now() - signedAt;
      if (observeOutcome) { /* Preserve an observed rejection without hiding RPC/resource failures. */ }
      else if (expectedError === undefined) assert.equal(confirmed.value[0].err, null, label);
      else assert.equal(confirmed.value[0].err?.InstructionError?.[1]?.Custom, expectedError, label);
    } else await verify();
  },
  async quote(label, instruction, expected) {
    const transactionIndex = nextTransaction;
    await h.send(label, [instruction]);
    await flush();
    const history = options.deferFinality ? await rpc.call('getTransaction', [checks[transactionIndex].signature,
      { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 1 }]) : latestHistory;
    assert.equal(history.meta.returnData.programId, instruction.programAddress);
    const raw = Buffer.from(history.meta.returnData.data[0], 'base64');
    assert.equal(raw.length, 204);
    const quote = sdk.makerA.getMakerQuoteResponseDecoder().decode(raw);
    assert.equal(quote.gross, expected, label);
  },
};
return { rpc,ws,h,checks,conformance,flush };
}
