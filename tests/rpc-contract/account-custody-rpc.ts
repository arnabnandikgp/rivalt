import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getBase58Encoder } from '@solana/kit';
import { Connection } from '@solana/web3.js';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import * as sdk from '@rivalt/sdk';
import { payerKey, program, type Harness } from './custody-cases.js';
import { accountCustodyCases } from './account-custody-cases.js';
import { WireRpc, WireSubscriptions, eventually } from './wire.js';

const url = process.env.RIVALT_RPC_URL!, runDir = process.env.RIVALT_RUN_DIR!;
assert.equal(new URL(url).hostname, '127.0.0.1');
const rpc = new WireRpc(url), connection = new Connection(url, 'confirmed');
const ws = new WireSubscriptions(process.env.RIVALT_WS_URL!);
const payer = await payerKey(), base58 = getBase58Encoder();
const checks: Record<string, unknown>[] = [], committed: ReturnType<typeof sdk.parseAccountCustodyChangedEvent>[] = [];
const eventBytes: string[] = [];
const serialize = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2)+'\n';
await ws.ready();
const subscription = await ws.call('logsSubscribe', [{ mentions: [program] }, { commitment: 'confirmed' }]);
const h: Harness = {
  async rent(size) { return BigInt(await rpc.call('getMinimumBalanceForRentExemption', [size])); },
  async read(key) {
    const response = await rpc.call('getAccountInfo', [key, { encoding: 'base64', commitment: 'finalized' }]);
    if (response.value) assert([program, TOKEN_PROGRAM_ADDRESS].includes(response.value.owner));
    return response.value ? Buffer.from(response.value.data[0], 'base64') : null;
  },
  async send(label, instructions, signers = [], expectedError) {
    const { transaction } = await sdk.signInstructions(connection, payer, [sdk.routeComputeBudget(), ...instructions], signers);
    const wire = transaction.serialize(); assert(wire.length <= 1232);
    const wireBase64 = Buffer.from(wire).toString('base64');
    writeFileSync(`${runDir}/wire-${checks.length}.json`, serialize({ label, wireBase64 }));
    const simulation = await rpc.call('simulateTransaction', [wireBase64, { encoding: 'base64', sigVerify: true, commitment: 'confirmed' }]);
    if (expectedError === undefined) assert.equal(simulation.value.err, null, `${label}: ${simulation.value.logs?.join('\n')}`);
    else assert.equal(simulation.value.err?.InstructionError?.[1]?.Custom, expectedError, `${label}: ${simulation.value.logs?.join('\n')}`);
    const signature = await rpc.call('sendTransaction', [wireBase64, { encoding: 'base64', skipPreflight: true }]);
    await eventually(() => rpc.call('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]),
      response => response.value[0]?.confirmationStatus === 'finalized', label);
    const history = await eventually(() => rpc.call('getTransaction', [signature, { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]),
      value => Boolean(value), `fetch ${label}`);
    assert.equal(history.transaction.signatures[0], signature);
    if (expectedError === undefined) assert.equal(history.meta.err, null, label);
    else assert.equal(history.meta.err?.InstructionError?.[1]?.Custom, expectedError, label);
    assert(history.meta.computeUnitsConsumed <= 320_000, `${label}: CU headroom`);
    const bytes = (history.meta.innerInstructions ?? []).flatMap((outer: any) => outer.instructions)
      .filter((instruction: any) => history.transaction.message.accountKeys[instruction.programIdIndex] === program)
      .map((instruction: any) => Buffer.from(base58.encode(instruction.data)))
      .filter((data: Buffer) => data.subarray(8, 16).equals(Buffer.from(sdk.ACCOUNT_CUSTODY_CHANGED_EVENT_DISCRIMINATOR)));
    const events = bytes.map((data: Buffer) => sdk.parseAccountCustodyChangedEvent(data.subarray(8)));
    if (expectedError === undefined) {
      committed.push(...events);
      eventBytes.push(...bytes.map((data: Buffer) => data.subarray(8).toString('base64')));
    }
    if (label.startsWith('rollback transfer')) assert.equal(events.length, 1, 'retain reverted event; exclude its financial effects');
    writeFileSync(`${runDir}/transaction-${checks.length}.json`, serialize(history));
    if ((checks.length + 1) % 10 === 0) console.log(`P23 RPC: ${checks.length + 1} outcomes fetched and decoded`);
    checks.push({ label, signature, status: expectedError === undefined ? 'pass' : 'rejected',
      error: history.meta.err, bytes: wire.length, accounts: history.transaction.message.accountKeys.length,
      computeUnits: history.meta.computeUnitsConsumed, feeLamports: String(history.meta.fee), decodedEvents: events.length });
  },
};
try {
  const result = await accountCustodyCases(h);
  await ws.notification(subscription);
  const ledgerState = new Map<number, {settlement: bigint; insurance: bigint; fees: bigint}>();
  for (const [index, event] of committed.entries()) {
    assert.equal(event.sequence, BigInt(index + 1)); assert.equal(event.venue, result.venue);
    assert.equal(event.schemaVersion, 3);
    for (const ledger of event.ledgers) ledgerState.set(ledger.marketIndex, ledger);
    assert.equal(event.allocatedVault, event.totalCash + [...ledgerState.values()].reduce((sum, ledger) =>
      sum + ledger.settlement + ledger.insurance + ledger.fees, 0n));
  }
  assert.equal(committed.at(-1)!.totalCash, 0n);
  const accountKeys = { venue: result.venue, venueRegistry: result.registry, custody: result.custody,
    venueSafety: result.safety, marginAccount: result.roots[0], portfolio: result.portfolios[0],
    market: result.markets[1], marketLedger: result.ledgers[1] };
  const accounts: Record<string, string> = Object.fromEntries(await Promise.all(Object.entries(accountKeys).map(async ([name, key]) => [name, (await h.read(key))!.toString('base64')])));
  const conformancePath = `${runDir}/legacy-input.json`;
  writeFileSync(conformancePath, serialize({ accounts, events: eventBytes }));
  const legacy = JSON.parse(execFileSync(process.execPath, ['tests/anchor-conformance/account-custody.cjs', conformancePath], { encoding: 'utf8' }));
  const canonical = (value: unknown): unknown => {
    if (value instanceof Uint8Array) return [...value];
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object' && '__option' in value) {
      if (value.__option === 'None') return null;
      assert(value.__option === 'Some' && 'value' in value);
      return canonical(value.value);
    }
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'discriminator').map(([key, item]) => [key, canonical(item)]));
    return value;
  };
  for (const [name, data] of Object.entries(accounts)) {
    const decoder = (sdk as any)[`get${name[0].toUpperCase()+name.slice(1)}Decoder`]();
    assert.deepEqual(legacy.accounts[name], canonical(decoder.decode(Buffer.from(data, 'base64'))));
  }
  legacy.events.forEach((event: any, index: number) => assert.deepEqual(event.data, canonical(committed[index])));
  const balance = await rpc.call('getTokenAccountBalance', [result.vault, { commitment: 'finalized' }]);
  assert.equal(balance.value.amount, '18'); assert.equal(balance.value.decimals, 6);
  const rawAccounts = Object.fromEntries(await Promise.all([result.venue, result.custody, result.safety, result.registry, result.vault,
    result.userToken, ...result.roots, ...result.markets, ...result.ledgers].map(async key => [key, (await h.read(key))!.toString('base64')])));
  writeFileSync(`${runDir}/summary.json`, serialize({ revision: execFileSync('git', ['rev-parse','HEAD'], { encoding: 'utf8' }).trim(),
    trackedDirty: execFileSync('git', ['status','--porcelain','--untracked-files=no'], { encoding: 'utf8' }).trim() !== '',
    runtime: await rpc.call('getVersion'), genesis: await rpc.call('getGenesisHash'),
    binarySha256: createHash('sha256').update(readFileSync('.local/account-centric/clearing.so')).digest('hex'),
    idlSha256: createHash('sha256').update(readFileSync('packages/sdk/idl/clearing.json')).digest('hex'),
    checks, committedEvents: committed, wsNotifications: ws.notifications.length, legacyAccounts: Object.keys(accounts), rawAccounts, result }));
  console.log(`P23 RPC: ${checks.length} finalized signed scenarios; ${committed.length} committed events; legacy account/event parity.`);
} finally { ws.close(); }
