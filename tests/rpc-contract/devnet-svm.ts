import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { address, getAddressEncoder, getTransactionDecoder, lamports, type Instruction } from '@solana/kit';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import * as sdk from '@rivalt/sdk';
import { devnetContext, guardInstruction, profile, sampleInstruction, setupDevnet, type DevnetHarness } from './devnet-context.js';

const svm = new LiteSVM().withSigverify(true).withBlockhashCheck(true);
const sourceAgeOnly = process.argv.includes('--source-age-only');
const atomicOnly = process.argv.includes('--atomic-recovery-only') || sourceAgeOnly;
const a = await devnetContext(true), checks: unknown[] = [];
for (const [name, key] of Object.entries(profile.programs)) svm.addProgramFromFile(address(key), `.local/devnet/deploy/${name}.so`);
svm.airdrop(a.payer.address, lamports(100_000_000_000n));
svm.warpToSlot(514_222_000n);
function setTime(now: bigint) { const c = svm.getClock(); c.unixTimestamp = now; svm.setClock(c); }
setTime(1_792_752_688n);
const pd = svm.getAccount(a.programData); assert(pd.exists);
const pdBytes = Buffer.from(pd.data); pdBytes[12] = 1; pdBytes.set(getAddressEncoder().encode(a.payer.address), 13); svm.setAccount({ ...pd, data: pdBytes });
// Explicit dependency replay for local adapter rejection tests. This is not a
// devnet verifier execution; actual upstream verification is separately retained.
for (const [i, f] of a.primary.entries()) {
  const data = Buffer.from(readFileSync(`docs/evidence/p13/sponsored/${i === 0 ? 'btc' : 'collateral'}-account.hex`, 'utf8').trim(), 'hex');
  svm.setAccount({ address: f.account, programAddress: address(f.receiver), data, executable: false, space: BigInt(data.length), lamports: lamports(5_000_000n) });
}
const h: DevnetHarness = {
  async read(k) { const x = svm.getAccount(k); return x.exists ? Buffer.from(x.data) : null; },
  async rent(n) { return svm.minimumBalanceForRentExemption(BigInt(n)); },
  async slot() { return svm.getClock().slot; }, async now() { return svm.getClock().unixTimestamp; },
  async send(label, instructions, signers = [], error) {
    svm.expireBlockhash();
    const { transaction } = await sdk.signInstructions({ async getLatestBlockhash() { return { blockhash: svm.latestBlockhash(), lastValidBlockHeight: 1_000_000_000n }; } }, a.payer, instructions, signers);
    const before = await Promise.all([a.market, a.routeState, a.trader, a.vault, ...a.makers.map(x => x.capital)].map(k => h.read(k)));
    const result = svm.sendTransaction(getTransactionDecoder().decode(transaction.serialize()));
    if (error === undefined) {
      assert(!(result instanceof FailedTransactionMetadata), `${label}: ${result instanceof FailedTransactionMetadata ? result.meta().logs().join('\n') : ''}`);
      checks.push({ label, result: 'pass', computeUnits: result.computeUnitsConsumed().toString(), transactionBytes: transaction.serialize().length });
    } else {
      assert(result instanceof FailedTransactionMetadata, `${label}: unexpectedly succeeded`);
      if (error !== 'reject') assert(result.meta().logs().some(s => s.includes(`Error Number: ${error}.`)), `${label}: ${result.meta().logs().join('\n')}`);
      assert.deepEqual(await Promise.all([a.market, a.routeState, a.trader, a.vault, ...a.makers.map(x => x.capital)].map(k => h.read(k))), before, 'Rejected instruction changed financial state');
      checks.push({ label, result: 'rejected', error });
    }
  },
};
await setupDevnet(h, a);
const setupCount = checks.length;
const risk = async () => sdk.getTestRouteStateDecoder().decode((await h.read(a.routeState))!);
const market = async () => sdk.getMarketStateDecoder().decode((await h.read(a.market))!);
const participant = async (key = a.trader) => sdk.getParticipantDecoder().decode((await h.read(key))!);
const guard = async () => {
  await h.send('publish-declared-guard', [guardInstruction(a, 0, 81_649_327_449n, 68_172_551n, await h.now()), guardInstruction(a, 1, 999_839n, 83n, await h.now())], [a.guardAuthority]);
};
for (let i = 0; i < (sourceAgeOnly ? 3 : atomicOnly ? 2 : 4); i++) {
  setTime(1_792_752_688n + (sourceAgeOnly ? 20n : 0n) + BigInt(i * (atomicOnly ? 3 : 2))); await guard();
  await h.send(`real-schema-recovery-${i}`, [sdk.fundingComputeBudget(), await sampleInstruction(a)]);
}
let r = await risk();
assert.equal(r.oracle.status, atomicOnly && !sourceAgeOnly ? 1 : 2);
assert.equal(r.referencePrice, 81_649_327_449n / 999_839n);
assert.deepEqual(r.oracle.sourceSequences.slice(0, 2), [1_792_752_688n, 1_792_752_688n]);
const m = await market(), p = await participant(), x = a.makers[0], reg = sdk.getMakerRegistrationDecoder().decode((await h.read(x.registration))!);
const gross = r.referencePrice + 10n; // Independent one-lot A vector, zero inventory/prefix.
const fee = (gross + 4_999n) / 5_000n;
const route = await sdk.getExecuteRouteInstructionAsync({ ...a, owner: a.traderOwner,
  firstCapital: x.capital, firstRegistration: x.registration, firstProgram: x.pricingProgram, firstProgramData: x.programData, firstConfig: x.config,
  domain: m.domain, termsEpoch: m.termsEpoch, configEpoch: m.configEpoch, observationSequence: r.observationSequence + (atomicOnly ? 1n : 0n), nonce: p.nonce,
  startSlot: await h.slot(), expirySlot: (await h.slot()) + 150n, side: 0, lots: 1n, allInLimit: gross + fee, maxFee: fee,
  reduceOnly: false, generation: p.generation, legs: [{ lots: 1n, quoteEpoch: reg.quoteEpoch, authorityEpoch: reg.authorityEpoch }] }, a.options);
if (sourceAgeOnly) {
  assert.equal(profile.sourceMaxAgeSeconds, 30);
  setTime(1_792_752_717n);
  await h.send('atomic-devnet-source-age-29', [sdk.fundingComputeBudget(), await sampleInstruction(a), route], [a.traderOwner]);
  assert.equal((await risk()).oracle.sourceDeadline, 1_792_752_718n);
} else if (atomicOnly) {
  setTime(1_792_752_693n);
  await h.send('atomic-recovery-too-early-rolls-back', [sdk.fundingComputeBudget(), await sampleInstruction(a), route], [a.traderOwner], 6124);
  setTime(1_792_752_694n);
  await h.send('atomic-six-second-recovery-and-route', [sdk.fundingComputeBudget(), await sampleInstruction(a), route], [a.traderOwner]);
  assert.equal((await risk()).oracle.status, 2);
} else await h.send('admit-authenticated-one-lot-route', [sdk.routeComputeBudget(), route], [a.traderOwner]);
const after = await participant(), maker = await participant(x.capital), afterMarket = await market();
assert.equal(after.cash, 100_000_000n - fee); assert.equal(maker.cash, 500_000_000n);
assert.equal(after.lots, 1n); assert.equal(maker.lots, -1n);
assert.equal(after.virtualScaled, -gross * 1_000_000_000n); assert.equal(maker.virtualScaled, gross * 1_000_000_000n);
assert.equal(afterMarket.fees, fee); assert.equal(afterMarket.allocatedVault, 1_100_000_000n);
if (atomicOnly) {
  const accepted = checks.at(-1) as { computeUnits: string; transactionBytes: number };
  assert(BigInt(accepted.computeUnits) <= 960_000n); assert(accepted.transactionBytes <= 1232);
  if (sourceAgeOnly) {
    const args = sdk.getExecuteRouteInstructionDataDecoder().decode(route.data);
    const fresh = await sdk.getExecuteRouteInstructionAsync({ ...a, owner: a.traderOwner, ...args,
      nonce: after.nonce, generation: after.generation, observationSequence: (await risk()).observationSequence + 1n,
      firstCapital: x.capital, firstRegistration: x.registration, firstProgram: x.pricingProgram,
      firstProgramData: x.programData, firstConfig: x.config }, a.options);
    setTime(1_792_752_718n);
    await h.send('exclusive-source-deadline-30-rolls-back', [sdk.fundingComputeBudget(), await sampleInstruction(a), fresh], [a.traderOwner], 6124);
  }
  const report = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '', a18Complete: false,
    scope: sourceAgeOnly ? 'Compiled devnet 30-second source boundary: age 29 trade, exclusive deadline 30 rollback; local fixture, not devnet execution' : 'Compiled devnet-profile conditional atomic recovery/trade; explicit local upstream fixtures, not a devnet execution', setupCount, checks,
    independentRoute: { gross, fee, trader: after, maker, market: afterMarket },
    binaries: Object.fromEntries(Object.keys(profile.programs).map(name => [name, createHash('sha256').update(readFileSync(`.local/devnet/deploy/${name}.so`)).digest('hex')])) };
  writeFileSync(sourceAgeOnly ? '.local/devnet/svm-age.json' : '.local/devnet/svm-bundle.json', JSON.stringify(report, (_, x) => typeof x === 'bigint' ? x.toString() : x, 2) + '\n');
  console.log(JSON.stringify({ checks: checks.length, setupCount, ...accepted, a18Complete: false }));
  process.exit(0);
}
setTime((await h.now()) + 2n);
const sample = await sampleInstruction(a);
await h.send('reject-wrong-primary-account', [sdk.fundingComputeBudget(), { ...sample, accounts: sample.accounts.map(meta => meta.address === a.primary[0].account ? { ...meta, address: a.primary[1].account } : meta) }], [], 6123);
const original = svm.getAccount(a.primary[0].account); assert(original.exists);
svm.setAccount({ ...original, programAddress: address('rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ') });
await h.send('reject-wrong-primary-owner', [sdk.fundingComputeBudget(), sample], [], 6123);
svm.setAccount(original);
for (const [label, mutate] of [
  ['partial-verification', (b: Buffer) => { b[40] = 0; }],
  ['wrong-feed-id', (b: Buffer) => { b[41] ^= 1; }],
  ['regressed-publish-time', (b: Buffer) => { b.writeBigInt64LE(1_792_752_687n, 93); }],
] as const) {
  const bad = Buffer.from(original.data); mutate(bad); svm.setAccount({ ...original, data: bad });
  setTime((await h.now()) + 2n); await guard();
  await h.send(`restrict-${label}`, [sdk.fundingComputeBudget(), sample]); r = await risk();
  assert.equal(r.oracle.status, 0); assert.equal(r.oracle.heldUntil, 0n);
  assert.equal(r.oracle.sourceSequences[0], 1_792_752_688n);
}
svm.setAccount(original); setTime(1_792_752_688n + BigInt(profile.sourceMaxAgeSeconds ?? 20) + 1n); await guard();
await h.send('restrict-stale-primary-with-fresh-guard', [sdk.fundingComputeBudget(), sample]);
assert.equal((await risk()).oracle.status, 0);
await h.send('stale-primary-cannot-execute', [sdk.routeComputeBudget(), route], [a.traderOwner], 6118);
// A fully authenticated future-dated source advances its monotonic identity but
// fails policy. Do this last so the stale-age test above is not a regression test.
const future = Buffer.from(original.data); future.writeBigInt64LE(1_792_752_900n, 93);
svm.setAccount({ ...original, data: future }); setTime((await h.now()) + 2n);
await h.send('restrict-future-primary', [sdk.fundingComputeBudget(), sample]);
assert.equal((await risk()).oracle.status, 0);
assert.equal((await risk()).oracle.sourceSequences[0], 1_792_752_900n);
const report = { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
  runtime: 'LiteSVM 1.6.1', a18Complete: false, scope: 'Signed devnet-profile adapter test with explicitly replayed upstream account fixtures',
  setupCount, checks, independentRoute: { gross, fee, cash: after.cash, makerCash: maker.cash, allocatedVault: afterMarket.allocatedVault },
  binaries: Object.fromEntries(Object.keys(profile.programs).map(name => [name, createHash('sha256').update(readFileSync(`.local/devnet/deploy/${name}.so`)).digest('hex')])) };
writeFileSync('.local/devnet/svm.json', JSON.stringify(report, (_, x) => typeof x === 'bigint' ? x.toString() : x, 2) + '\n');
console.log(`${checks.length} signed scoped checks, including ${setupCount} setup; devnet A18 remains pending.`);
