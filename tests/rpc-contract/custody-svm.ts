import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getAddressEncoder, getTransactionDecoder, lamports } from '@solana/kit';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { getTransferSolInstruction } from '@solana-program/system';
import {
  signInstructions, findParticipantPda, getRegisterParticipantInstructionAsync,
  getParticipantRegistryDecoder, getDepositInstructionAsync, getWithdrawInstructionAsync,
} from '@rivalt/sdk';
import { addresses, custodyCases, fixtureKey, payerKey, program, type Harness } from './custody-cases.js';

const svm = new LiteSVM().withSigverify(true).withBlockhashCheck(true);
svm.addProgramFromFile(program, 'target/deploy/clearing.so');
const payer = await payerKey();
svm.airdrop(payer.address, lamports(100_000_000_000n));
const a = await addresses();
// Deployment metadata fixture only: LiteSVM loads programs immutable by default.
// No market, participant, cash, mint or token balances are inserted.
const programData = svm.getAccount(a.programData);
assert(programData.exists);
const deploymentBytes = Uint8Array.from(programData.data);
deploymentBytes[12] = 1; // bincode Option<upgrade authority>
deploymentBytes.set(getAddressEncoder().encode(payer.address), 13);
svm.setAccount({ ...programData, data: deploymentBytes });
const checks: unknown[] = [];
const h: Harness = {
  async rent(bytes) { return svm.minimumBalanceForRentExemption(BigInt(bytes)); },
  async read(key) { const account = svm.getAccount(key); return account.exists ? Buffer.from(account.data) : null; },
  async send(label, instructions, signers = [], expectedError) {
    svm.expireBlockhash();
    const { transaction } = await signInstructions({
      async getLatestBlockhash() { return { blockhash: svm.latestBlockhash(), lastValidBlockHeight: 1_000_000n }; },
    }, payer, instructions, signers);
    const tx = getTransactionDecoder().decode(transaction.serialize());
    const result = svm.sendTransaction(tx);
    if (expectedError === undefined) {
      assert(!(result instanceof FailedTransactionMetadata), `${label}: ${result instanceof FailedTransactionMetadata ? result.meta().logs().join('\n') : ''}`);
      checks.push({ label, status: 'pass', computeUnits: result.computeUnitsConsumed().toString() });
    } else {
      assert(result instanceof FailedTransactionMetadata, `${label}: unexpectedly succeeded`);
      assert(result.meta().logs().some(l => l.includes(`Error Number: ${expectedError}.`)), `${label}: expected ${expectedError}\n${result.meta().logs().join('\n')}`);
      checks.push({ label, status: 'rejected', error: expectedError });
    }
  },
};
const result = await custodyCases(h);

// Capacity is tested on actual registrations, not injected membership.
for (let i = 1; i < 64; i++) {
  const owner = await fixtureKey(`capacity-${i}`);
  await h.send(`register capacity member ${i}`, [
    getTransferSolInstruction({ source: payer, destination: owner.address, amount: 10_000_000n }),
    await getRegisterParticipantInstructionAsync({ ...a, owner }),
  ], [owner]);
}
const extra = await fixtureKey('capacity-64');
const [extraParticipant] = await findParticipantPda({ market: a.market, owner: extra.address });
const registryBefore = (await h.read(a.registry))!;
await h.send('reject 65th member atomically', [
  getTransferSolInstruction({ source: payer, destination: extra.address, amount: 10_000_000n }),
  await getRegisterParticipantInstructionAsync({ ...a, owner: extra }),
], [extra], 6105);
assert.equal(await h.read(extraParticipant), null);
assert.deepEqual(await h.read(a.registry), registryBefore);
assert.equal(getParticipantRegistryDecoder().decode(registryBefore).count, 64);

// Explicit adversarial corruption fixtures. Snapshot and restore exact bytes; never
// use mutated balances as the evidence for a successful economic transition.
const trader = await fixtureKey('trader'), userToken = await fixtureKey('user-token');
const transfer = { ...a, owner: trader, participant: result.addresses.participant, quoteMint: result.addresses.quoteMint, userToken: userToken.address, amount: 1n };
const vault = svm.getAccount(a.vault);
assert(vault.exists);
const corruptVault = Buffer.from(vault.data);
corruptVault.writeBigUInt64LE(10_006n, 64);
svm.setAccount({ ...vault, data: corruptVault });
await h.send('reject detected vault deficit', [await getDepositInstructionAsync(transfer)], [trader], 6107);
svm.setAccount(vault);
const participant = svm.getAccount(result.addresses.participant);
assert(participant.exists);
const corruptParticipant = Buffer.from(participant.data);
// 8 discriminator + 2 schema + 32 market + 32 owner + 2 id + 8 cash = lot offset 84.
corruptParticipant.writeBigInt64LE(1n, 84);
svm.setAccount({ ...participant, data: corruptParticipant });
await h.send('reject withdrawal outside custody profile', [await getWithdrawInstructionAsync(transfer)], [trader], 6108);
svm.setAccount(participant);

const summary = {
  runtime: 'litesvm node 1.6.1', signatureVerification: true, blockhashVerification: true,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
  binarySha256: createHash('sha256').update(readFileSync('target/deploy/clearing.so')).digest('hex'),
  checks, result,
};
writeFileSync('.local/p02-svm.json', JSON.stringify(summary, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n');
console.log(`LiteSVM custody: ${checks.length} signed scenarios passed; full 64-member capacity and corruption rejection verified.`);
