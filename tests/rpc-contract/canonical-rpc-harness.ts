import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { getBase58Decoder, getTransactionDecoder, getCompiledTransactionMessageDecoder } from '@solana/kit';
import { Connection, VersionedTransaction } from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import { payerKey } from './custody-cases.js';
import type { CanonicalHarness } from './canonical-maker-cases.js';
import { CanonicalConformance } from './canonical-maker-conformance.js';
import { WireRpc, WireSubscriptions, eventually } from './wire.js';

export async function openCanonicalRpcHarness(url: string,wsUrl: string,runDir: string,
  options: { computeUnitLimit?: (label: string,instructions: readonly unknown[]) => number;
    maxLoadedAccounts?: (label: string) => number | undefined } = {}) {
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
const h: CanonicalHarness = {
  async rent(size) { return BigInt(await rpc.call('getMinimumBalanceForRentExemption', [size])); },
  async read(key) {
    const response = await rpc.call('getAccountInfo', [key, { encoding: 'base64', commitment: 'finalized' }]);
    return response.value ? Buffer.from(response.value.data[0], 'base64') : null;
  },
  async send(label, instructions, signers = [], expectedError) {
    const started = performance.now();
    const computeUnitLimit = options.computeUnitLimit?.(label,instructions)
      ?? (label.startsWith('reprice ') ? 100_000 : instructions.length > 1 && label.startsWith('atomic') ? 800_000 : 400_000);
    const { transaction, v0Bytes, wireBytes } = await sdk.signCanonicalInstructions(connection, payer, instructions,
      { computeUnitLimit, loadedAccountsDataSizeLimit: 8 * 1024 * 1024 }, signers);
    const wire = transaction.serialize(), wireBase64 = Buffer.from(wire).toString('base64');
    const expectedSignature = getBase58Decoder().decode(transaction.signatures[0]);
    const saved = { label, wireBase64, signature: expectedSignature, version: transaction.version, v0Bytes, wireBytes };
    writeFileSync(`${runDir}/wire-${checks.length}.json`, serialize(saved));
    console.log(`${checks.length}: ${label}: v${transaction.version} ${wireBytes} bytes (v0 ${v0Bytes})`);
    const simulation = await rpc.call('simulateTransaction', [wireBase64, { encoding: 'base64', sigVerify: true, commitment: 'confirmed' }]);
    writeFileSync(`${runDir}/simulation-${checks.length}.json`, serialize(simulation));
    if (expectedError === undefined) assert.equal(simulation.value.err, null, `${label}: ${simulation.value.logs?.join('\n')}`);
    else assert.equal(simulation.value.err?.InstructionError?.[1]?.Custom, expectedError, `${label}: ${simulation.value.logs?.join('\n')}`);
    // Subscribe after simulation, before broadcast. The acknowledgement is a WS
    // ordering barrier: simulation logs cannot satisfy the landing observation.
    const signatureSubscription = await ws.call('signatureSubscribe', [expectedSignature,
      { commitment: 'finalized', enableReceivedNotification: false }]);
    const notificationOffset = ws.notifications.length;
    const signature = await rpc.call('sendTransaction', [wireBase64, { encoding: 'base64', skipPreflight: true }]);
    assert.equal(signature, expectedSignature);
    await eventually(() => rpc.call('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]),
      response => response.value[0]?.confirmationStatus === 'finalized', label);
    const history = await eventually(() => rpc.call('getTransaction', [signature,
      { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 1 }]), value => Boolean(value), `fetch ${label}`);
    // Preserve a landed result even when a later resource or parity check fails.
    writeFileSync(`${runDir}/transaction-${checks.length}.json`, serialize(history));
    const loadedAccounts = new Set([...history.transaction.message.accountKeys,
      ...history.meta.loadedAddresses?.writable ?? [], ...history.meta.loadedAddresses?.readonly ?? []]).size;
    const maximumLoadedAccounts = options.maxLoadedAccounts?.(label);
    if (maximumLoadedAccounts !== undefined) assert(loadedAccounts <= maximumLoadedAccounts, `${label}: loaded account budget`);
    assert.equal(history.transaction.signatures[0], signature);
    if (expectedError === undefined) assert.equal(history.meta.err, null, label);
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
    if (expectedError === undefined) assert.equal(notification.params.result.value.err, null);
    const wsErrorMatchesFinalized = JSON.stringify(notification.params.result.value.err) === JSON.stringify(history.meta.err);
    writeFileSync(`${runDir}/ws-${checks.length}.json`, serialize({ logs: notification, signature: signatureNotification }));
    checks.push({ label, signature, version: transaction.version, v0Bytes, bytes: wireBytes,
      error: history.meta.err, confirmationMs: performance.now() - started, computeUnits: history.meta.computeUnitsConsumed, computeUnitLimit,
      loadedAccounts, feeLamports: String(history.meta.fee), signatures: transaction.signatures.length, ws: true, wsErrorMatchesFinalized, wsError: notification.params.result.value.err, signatureWsError: signatureNotification.params.result.value.err });
    conformance.record(instructions, history);
    latestHistory = history;
  },
  async quote(label, instruction, expected) {
    await h.send(label, [instruction]);
    assert.equal(latestHistory.meta.returnData.programId, instruction.programAddress);
    const raw = Buffer.from(latestHistory.meta.returnData.data[0], 'base64');
    assert.equal(raw.length, 204);
    const quote = sdk.makerA.getQuoteResponseV4Decoder().decode(raw);
    assert.equal(quote.gross, expected, label);
  },
};
return { rpc,ws,h,checks,conformance };
}
