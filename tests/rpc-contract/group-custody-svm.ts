import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getAddressEncoder, getTransactionDecoder, lamports } from '@solana/kit';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { getTransferSolInstruction } from '@solana-program/system';
import * as sdk from '@rivalt/sdk';
import { addresses, fixtureKey, payerKey, program, type Harness } from './custody-cases.js';
import { groupCustodyCases, groupPda, groupMarket } from './group-custody-cases.js';

const artifact = '.local/successor/clearing.so';
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
const result = await groupCustodyCases(h);
const encode = getAddressEncoder();
const u16 = (value: number) => { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes; };
let count = result.roots.length;
for (let operator = 0; count < 64; operator++) {
  const owner = await fixtureKey(`p18a-capacity-${operator}`);
  await h.send('capacity owner rent', [getTransferSolInstruction({ source: payer, destination: owner.address, amount: 100_000_000n })]);
  const portfolio = await groupPda('portfolio-v2', encode.encode(result.group), encode.encode(owner.address), u16(0));
  await h.send('capacity portfolio', [await sdk.getCreatePortfolioV2InstructionAsync({ group: result.group, owner, portfolio, index: 0,
    program, eventAuthority: deployment.eventAuthority })], [owner]);
  for (let subaccountIndex = 0; subaccountIndex <= 8 && count < 64; subaccountIndex++) {
    const margin = await groupPda('margin-v2', encode.encode(portfolio), u16(subaccountIndex));
    await h.send(`actual registry member ${count}`, [await sdk.getRegisterMarginV2InstructionAsync({ group: result.group,
      registry: result.registry, owner, portfolio, margin, subaccountIndex, mode: subaccountIndex === 0 ? 0 : 1,
      isolatedMarketIndex: subaccountIndex === 0 ? 255 : subaccountIndex % 2, role: 0,
      program, eventAuthority: deployment.eventAuthority })], [owner]);
    count++;
  }
}
const owner = await fixtureKey('p18a-owner');
const extra = await groupPda('margin-v2', encode.encode(result.portfolios[0]), u16(3));
const before = (await h.read(result.registry))!;
await h.send('reject member 65 without leaked registration', [await sdk.getRegisterMarginV2InstructionAsync({ group: result.group,
  registry: result.registry, owner, portfolio: result.portfolios[0], margin: extra, subaccountIndex: 3, mode: 1,
  isolatedMarketIndex: 0, role: 0, program, eventAuthority: deployment.eventAuthority })], [owner], 6105);
assert.equal(await h.read(extra), null);
assert.deepEqual(await h.read(result.registry), before);
assert.equal(sdk.getGroupRegistryV2Decoder().decode(before).count, 64);

// Explicit adversarial corruption checks are isolated and restored. They never
// provide successful custody/fill evidence or qualify a source/financial path.
const groupAccount = svm.getAccount(result.group); assert(groupAccount.exists);
for (const mode of [1, 2, 3]) {
  const group = sdk.getClearingGroupV2Decoder().decode(groupAccount.data);
  svm.setAccount({ ...groupAccount, data: sdk.getClearingGroupV2Encoder().encode({ ...group, mode }) });
  await h.send(`reject custody outflow in financial/frozen mode ${mode}`, [await sdk.getWithdrawGroupCustodyV2InstructionAsync({
    group: result.group, vault: result.vault, margin: result.roots[0], owner, quoteMint: result.quoteMint,
    userToken: result.userToken, amount: 1n, program, eventAuthority: deployment.eventAuthority })], [owner], 6108);
  svm.setAccount(groupAccount);
}
const root = svm.getAccount(result.roots[0]); assert(root.exists);
const decoded = sdk.getMarginAccountV2Decoder().decode(root.data);
decoded.positions[1].virtualScaled = -1n;
svm.setAccount({ ...root, data: sdk.getMarginAccountV2Encoder().encode(decoded) });
await h.send('reject flat residual claim escape', [await sdk.getTransferGroupCustodyV2InstructionAsync({
  group: result.group, vault: result.vault, donor: result.roots[0], recipient: result.roots[1], owner, amount: 1n,
  program, eventAuthority: deployment.eventAuthority })], [owner], 6108);
svm.setAccount(root);

const foreignDomain = new Uint8Array(32).fill(42);
const foreignGroup = await groupPda('group-v2', foreignDomain);
const foreignRegistry = await groupPda('registry-v2', encode.encode(foreignGroup));
const foreignVault = await groupPda('vault-v2', encode.encode(foreignGroup));
const foreign = { group: foreignGroup, registry: foreignRegistry, vault: foreignVault,
  authority: payer, owner, quoteMint: result.quoteMint, programData: deployment.programData,
  program, eventAuthority: deployment.eventAuthority };
await h.send('initialize independent group', [await sdk.getInitializeGroupV2InstructionAsync({ ...foreign, domain: foreignDomain })]);
for (const index of [0,1]) await h.send('initialize independent group market', [sdk.getInitializeGroupMarketV2Instruction({
  ...foreign, index, market: await groupMarket(foreignGroup,index) })]);
const foreignPortfolio = await groupPda('portfolio-v2', encode.encode(foreignGroup), encode.encode(owner.address), u16(0));
await h.send('create separate-group portfolio for same owner', [await sdk.getCreatePortfolioV2InstructionAsync({ ...foreign,
  portfolio: foreignPortfolio, index: 0 })], [owner]);
const foreignRoot = await groupPda('margin-v2', encode.encode(foreignPortfolio), u16(0));
await h.send('register same-owner foreign-group root', [await sdk.getRegisterMarginV2InstructionAsync({ ...foreign,
  portfolio: foreignPortfolio, margin: foreignRoot, subaccountIndex: 0, mode: 0, isolatedMarketIndex: 255, role: 0 })], [owner]);
const snapshotBefore = await Promise.all([result.group, result.roots[0], foreignGroup, foreignRoot].map(h.read));
await h.send('reject same-owner cross-group allocation', [await sdk.getTransferGroupCustodyV2InstructionAsync({
  group: result.group, vault: result.vault, donor: result.roots[0], recipient: foreignRoot, owner, amount: 1n,
  program, eventAuthority: deployment.eventAuthority })], [owner], 2001);
assert.deepEqual(await Promise.all([result.group, result.roots[0], foreignGroup, foreignRoot].map(h.read)), snapshotBefore);

// The default release profile must reject even an otherwise valid schema-2
// deposit; existing financial accounts are retained across the code replacement.
svm.addProgramFromFile(program, '.local/successor/clearing-default.so');
await h.send('default build rejects successor custody', [await sdk.getDepositGroupV2InstructionAsync({
  group: result.group, vault: result.vault, margin: result.roots[0], owner, quoteMint: result.quoteMint,
  userToken: result.userToken, amount: 1n, program, eventAuthority: deployment.eventAuthority })], [owner], 6108);

const serialize = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2)+'\n';
mkdirSync('.local/successor', { recursive: true });
writeFileSync('.local/successor/p18a-svm.json', serialize({
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  trackedDirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() !== '',
  runtime: 'LiteSVM 1.6.1', signatureVerification: true, blockhashVerification: true,
  binarySha256: createHash('sha256').update(readFileSync(artifact)).digest('hex'), checks, result,
}));
console.log(`P18A: ${checks.length} signed SVM scenarios; full 64-member registry; final vault = 7 insurance atoms.`);
