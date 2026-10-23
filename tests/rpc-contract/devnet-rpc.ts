import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { blockhash, getBase58Decoder, type Address, type Instruction } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import { Rpc } from '../../packages/indexer/src/rpc.js';
import { decode, json } from '../../packages/indexer/src/events.js';
import { checkedGenesis, configuration, unsigned } from './devnet-preflight-support.js';
import { profile, type DevnetContext, type DevnetHarness } from './devnet-context.js';

const digest = (value: unknown) => createHash('sha256').update(json(value)).digest('hex');
export function persist(path: string, value: unknown) {
  const fd = openSync(path + '.tmp', 'w', 0o600);
  try { writeFileSync(fd, json(value) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(path + '.tmp', path);
}
type Entry = { label: string; instructionHash: string; signature: string; wire: string; error?: number | 'reject'; feeLamports?: string;
  history?: any; events?: ReturnType<typeof decode>; before?: Array<string | null>; after?: Array<string | null>; finalized: boolean };

export class DevnetRpc implements DevnetHarness {
  readonly config = configuration(process.env);
  readonly rpc = new Rpc(this.config.rpc);
  readonly journal = '.local/devnet/acceptance/journal';
  readonly checks: Array<{ label: string; signature: string; result: string; feeLamports: string }> = [];
  constructor(readonly a: DevnetContext) {
    assert.equal(a.payer.address, profile.deployer, 'Local SVM keys cannot submit to devnet');
    mkdirSync(this.journal, { recursive: true, mode: 0o700 });
  }
  async open() {
    checkedGenesis(await this.rpc.call('getGenesisHash'));
    // Resolve existing exact wires before any new source/operator/user intent.
    for (const file of readdirSync(this.journal).filter(f => f.endsWith('.json')).sort()) {
      const entry: Entry = JSON.parse(readFileSync(`${this.journal}/${file}`, 'utf8'));
      if (!entry.finalized) await this.finish(entry);
    }
  }
  async account(key: string, commitment = 'finalized') {
    return this.rpc.call('getAccountInfo', [key, { encoding: 'base64', commitment }]);
  }
  async read(key: Address) {
    const r = await this.account(key); return r.value ? Buffer.from(r.value.data[0], 'base64') : null;
  }
  async rent(bytes: number) { return BigInt(unsigned(await this.rpc.call('getMinimumBalanceForRentExemption', [bytes]))); }
  async slot() { return BigInt(unsigned(await this.rpc.call('getSlot', [{ commitment: 'confirmed' }]))); }
  async now() {
    const r = await this.account('SysvarC1ock11111111111111111111111111111111', 'confirmed');
    return Buffer.from(r.value.data[0], 'base64').readBigInt64LE(32);
  }
  async stateHashes() {
    const keys = [this.a.market, this.a.routeState, this.a.vault, this.a.trader, ...this.a.makers.flatMap(m => [m.capital, m.registration])];
    const r = await this.rpc.call('getMultipleAccounts', [keys, { encoding: 'base64', commitment: 'finalized' }]);
    return r.value.map((v: any) => v === null ? null : digest({ owner: v.owner, data: v.data })) as Array<string | null>;
  }
  async send(label: string, instructions: Instruction[], signers: Parameters<DevnetHarness['send']>[2] = [], error?: number | 'reject') {
    assert(/^[a-z0-9-]{1,128}$/.test(label));
    const path = `${this.journal}/${label}.json`;
    const instructionHash = digest(instructions.map(ix => ({ program: ix.programAddress, data: Buffer.from(ix.data ?? []).toString('hex'), accounts: ix.accounts?.map(x => ({ address: x.address, role: x.role })) })));
    let entry: Entry;
    if (existsSync(path)) {
      entry = JSON.parse(readFileSync(path, 'utf8'));
      assert.equal(entry.instructionHash, instructionHash, 'Persisted intent changed; do not silently replace it');
      assert.equal(entry.error, error);
    } else {
      const spentOrHeld = readdirSync(this.journal).filter(f => f.endsWith('.json')).reduce((sum, f) => {
        const e: Entry = JSON.parse(readFileSync(`${this.journal}/${f}`, 'utf8')); return sum + BigInt(e.feeLamports ?? '20000');
      }, 0n);
      assert(spentOrHeld + 20_000n <= 10_000_000n, 'P13 acceptance network-fee budget exhausted');
      const { transaction } = await sdk.signInstructions({ getLatestBlockhash: async () => {
        const r = await this.rpc.call('getLatestBlockhash', [{ commitment: 'confirmed' }]);
        return { blockhash: blockhash(r.value.blockhash), lastValidBlockHeight: BigInt(unsigned(r.value.lastValidBlockHeight)) };
      } }, this.a.payer, instructions, signers);
      entry = { label, instructionHash, signature: getBase58Decoder().decode(transaction.signatures[0]), wire: Buffer.from(transaction.serialize()).toString('base64'),
        error, finalized: false, before: error === undefined ? undefined : await this.stateHashes() };
      // Exact signed bytes and reservation precede submission, including rejection tests.
      persist(path, entry);
    }
    if (!entry.finalized) {
      try {
        const signature = await this.rpc.call('sendTransaction', [entry.wire, { encoding: 'base64', skipPreflight: true, maxRetries: 3 }]);
        assert.equal(signature, entry.signature);
      } catch { /* Unknown acknowledgement: reconcile the same persisted signature below. */ }
      await this.finish(entry);
    }
    this.expectedOutcome(entry);
    this.checks.push({ label, signature: entry.signature, result: entry.error === undefined ? 'pass' : 'rejected', feeLamports: entry.feeLamports! });
  }
  private async finish(entry: Entry) {
    const deadline = Date.now() + 90_000;
    let status: any = null;
    while (Date.now() < deadline) {
      try { status = (await this.rpc.call('getSignatureStatuses', [[entry.signature], { searchTransactionHistory: true }])).value[0]; }
      catch { /* Provider interruption cannot be treated as failure or absence. */ }
      if (status?.confirmationStatus === 'finalized') break;
      await delay(500);
    }
    assert.equal(status?.confirmationStatus, 'finalized', `Unresolved original signature ${entry.signature}; no replacement signed`);
    const history = await this.rpc.call('getTransaction', [entry.signature, { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
    const wire = await this.rpc.call('getTransaction', [entry.signature, { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
    assert(history?.meta && wire?.transaction && history.transaction.signatures[0] === entry.signature);
    assert.equal(wire.transaction[0], entry.wire, 'Fetched signed bytes differ');
    entry.history = history; entry.events = decode(entry.signature, history, this.a.eventAuthority, this.a.program);
    entry.feeLamports = unsigned(history.meta.fee); assert(BigInt(entry.feeLamports) <= 20_000n);
    if (entry.error !== undefined) entry.after = await this.stateHashes();
    // Persist actual failures and their logs/fee before asserting the expected gate.
    entry.finalized = true; persist(`${this.journal}/${entry.label}.json`, entry);
    this.expectedOutcome(entry);
  }
  private expectedOutcome(entry: Entry) {
    if (entry.error === undefined) assert.equal(entry.history.meta.err, null, `${entry.label}: ${json(entry.history.meta.err)}`);
    else {
      assert.notEqual(entry.history.meta.err, null, `${entry.label}: unexpectedly succeeded`);
      if (entry.error !== 'reject') assert.equal(entry.history.meta.err.InstructionError?.[1]?.Custom, entry.error);
      assert.deepEqual(entry.after, entry.before, 'Rejected instruction changed financial state');
      assert.deepEqual(entry.events, []);
    }
  }
}
