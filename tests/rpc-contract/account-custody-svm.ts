import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getAddressEncoder, getTransactionDecoder, lamports } from '@solana/kit';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { getTransferSolInstruction } from '@solana-program/system';
import * as sdk from '@rivalt/sdk';
import { addresses, fixtureKey, payerKey, program, type Harness } from './custody-cases.js';
import { accountCustodyCases, accountPda, accountMarket } from './account-custody-cases.js';

const artifact = '.local/account-centric/clearing.so';
const svm = new LiteSVM().withSigverify(true).withBlockhashCheck(true);
svm.addProgramFromFile(program, artifact);
const payer = await payerKey(), deployment = await addresses();
svm.airdrop(payer.address, lamports(100_000_000_000n));
const programData = svm.getAccount(deployment.programData); assert(programData.exists);
const deploymentBytes = Uint8Array.from(programData.data);
// Deployment loader metadata only. All financial and registry state comes from signed instructions.
deploymentBytes[12] = 1; deploymentBytes.set(getAddressEncoder().encode(payer.address), 13);
svm.setAccount({ ...programData, data: deploymentBytes });
const checks: { label: string; status: string; bytes: number; accounts: number; computeUnits: string }[] = [];
const h: Harness = {
  async rent(size) { return svm.minimumBalanceForRentExemption(BigInt(size)); },
  async read(key) { const account = svm.getAccount(key); return account.exists ? Buffer.from(account.data) : null; },
  async send(label, instructions, signers = [], expectedError) {
    svm.expireBlockhash();
    const { transaction } = await sdk.signInstructions({ async getLatestBlockhash() {
      return { blockhash: svm.latestBlockhash(), lastValidBlockHeight: 1_000_000n };
    } }, payer, [sdk.routeComputeBudget(), ...instructions], signers);
    const wire = transaction.serialize();
    assert(wire.length <= 1232, `${label}: packet overflow`);
    const result = svm.sendTransaction(getTransactionDecoder().decode(wire));
    const metadata = result instanceof FailedTransactionMetadata ? result.meta() : result;
    if (expectedError === undefined) {
      assert(!(result instanceof FailedTransactionMetadata), `${label}: ${metadata.logs().join('\n')}`);
      assert(metadata.computeUnitsConsumed() <= 320_000n, `${label}: less than 20% CU headroom`);
    } else {
      assert(result instanceof FailedTransactionMetadata, `${label}: unexpectedly accepted`);
      assert(metadata.logs().some(line => line.includes(`Error Number: ${expectedError}.`)), `${label}: expected ${expectedError}\n${metadata.logs().join('\n')}`);
    }
    checks.push({ label, status: expectedError === undefined ? 'pass' : 'rejected', bytes: wire.length,
      accounts: transaction.message.staticAccountKeys.length, computeUnits: metadata.computeUnitsConsumed().toString() });
  },
};
const result = await accountCustodyCases(h);
const common = { venue: result.venue, custody: result.custody, safety: result.safety,
  btcLedger: result.ledgers[0], ethLedger: result.ledgers[1] };
const encode = getAddressEncoder();
const u16 = (value: number) => { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes; };
let count = result.roots.length;
for (let operator = 0; count < 64; operator++) {
  const owner = await fixtureKey(`p23-capacity-${operator}`);
  await h.send('capacity owner rent', [getTransferSolInstruction({ source: payer, destination: owner.address, amount: 100_000_000n })]);
  const portfolio = await accountPda('portfolio-v3', encode.encode(result.venue), encode.encode(owner.address), u16(0));
  await h.send('capacity portfolio', [await sdk.getCreatePortfolioInstructionAsync({ ...common, venue: result.venue, owner, portfolio, index: 0,
    program, eventAuthority: deployment.eventAuthority })], [owner]);
  for (let subaccountIndex = 0; subaccountIndex <= 8 && count < 64; subaccountIndex++) {
    const margin = await accountPda('margin-v3', encode.encode(portfolio), u16(subaccountIndex));
    await h.send(`actual registry member ${count}`, [await sdk.getRegisterMarginInstructionAsync({ ...common, venue: result.venue,
      registry: result.registry, owner, portfolio, margin, subaccountIndex, mode: subaccountIndex === 0 ? 0 : 1,
      isolatedMarketIndex: subaccountIndex === 0 ? 255 : subaccountIndex % 2, role: 0,
      program, eventAuthority: deployment.eventAuthority })], [owner]);
    count++;
  }
}
const owner = await fixtureKey('p23-owner');
const extra = await accountPda('margin-v3', encode.encode(result.portfolios[0]), u16(3));
const before = (await h.read(result.registry))!;
await h.send('reject member 65 without leaked registration', [await sdk.getRegisterMarginInstructionAsync({ ...common, venue: result.venue,
  registry: result.registry, owner, portfolio: result.portfolios[0], margin: extra, subaccountIndex: 3, mode: 1,
  isolatedMarketIndex: 0, role: 0, program, eventAuthority: deployment.eventAuthority })], [owner], 6105);
assert.equal(await h.read(extra), null);
assert.deepEqual(await h.read(result.registry), before);
assert.equal(sdk.getVenueRegistryDecoder().decode(before).count, 64);

// Explicit adversarial corruption checks are isolated and restored. They never
// provide successful custody/fill evidence or qualify a source/financial path.
const safetyAccount = svm.getAccount(result.safety); assert(safetyAccount.exists);
for (const mode of [1, 2, 3, 4]) {
  const safety = sdk.getVenueSafetyDecoder().decode(safetyAccount.data);
  svm.setAccount({ ...safetyAccount, data: sdk.getVenueSafetyEncoder().encode({ ...safety, mode }) });
  await h.send(`reject custody outflow in financial/frozen mode ${mode}`, [await sdk.getWithdrawAccountCustodyInstructionAsync({
    ...common, vault: result.vault, margin: result.roots[0], owner, quoteMint: result.quoteMint,
    userToken: result.userToken, amount: 1n, program, eventAuthority: deployment.eventAuthority })], [owner], 6108);
  svm.setAccount(safetyAccount);
}
const root = svm.getAccount(result.roots[0]); assert(root.exists);
const decoded = sdk.getMarginAccountDecoder().decode(root.data);
decoded.positions[1].virtualScaled = -1n;
svm.setAccount({ ...root, data: sdk.getMarginAccountEncoder().encode(decoded) });
await h.send('reject flat residual claim escape', [await sdk.getTransferAccountCustodyInstructionAsync({
  ...common, venue: result.venue, vault: result.vault, donor: result.roots[0], recipient: result.roots[1], owner, amount: 1n,
  program, eventAuthority: deployment.eventAuthority })], [owner], 6108);
svm.setAccount(root);

// A fabricated foreign venue field must fail even with the same root owner.
const foreignRoot = sdk.getMarginAccountDecoder().decode(root.data);
foreignRoot.venue = await accountPda('venue-v3', new Uint8Array(32).fill(42));
svm.setAccount({ ...root, data: sdk.getMarginAccountEncoder().encode(foreignRoot) });
await h.send('reject foreign-venue root ownership', [await sdk.getWithdrawAccountCustodyInstructionAsync({
  ...common, vault: result.vault, margin: result.roots[0], owner, quoteMint: result.quoteMint,
  userToken: result.userToken, amount: 1n, program, eventAuthority: deployment.eventAuthority })], [owner], 2001);
svm.setAccount(root);
const wrongSchema = sdk.getMarginAccountDecoder().decode(root.data);
wrongSchema.schemaVersion = 2;
svm.setAccount({ ...root, data: sdk.getMarginAccountEncoder().encode(wrongSchema) });
await h.send('reject foreign schema in canonical root', [await sdk.getWithdrawAccountCustodyInstructionAsync({
  ...common, vault: result.vault, margin: result.roots[0], owner, quoteMint: result.quoteMint,
  userToken: result.userToken, amount: 1n, program, eventAuthority: deployment.eventAuthority })], [owner], 6108);
svm.setAccount(root);
// The default release profile must reject even an otherwise valid schema-3
// deposit; existing financial accounts are retained across the code replacement.
svm.addProgramFromFile(program, '.local/account-centric/clearing-default.so');
await h.send('default build rejects account-centric custody', [await sdk.getDepositAccountInstructionAsync({
  ...common, venue: result.venue, vault: result.vault, margin: result.roots[0], owner, quoteMint: result.quoteMint,
  userToken: result.userToken, amount: 1n, program, eventAuthority: deployment.eventAuthority })], [owner], 6108);

const serialize = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2)+'\n';
mkdirSync('.local/account-centric', { recursive: true });
writeFileSync('.local/account-centric/p23-svm.json', serialize({
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  trackedDirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() !== '',
  runtime: 'LiteSVM 1.6.1', signatureVerification: true, blockhashVerification: true,
  binarySha256: createHash('sha256').update(readFileSync(artifact)).digest('hex'), checks, result,
}));
console.log(`P23: ${checks.length} signed SVM scenarios; full 64-member registry; final vault = 18 market-attributed insurance atoms.`);
