// Focused fast execution of the exact P30 lifecycle before the slower RPC/WS gate.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { getAddressEncoder, getTransactionDecoder, getProgramDerivedAddress, lamports } from '@solana/kit';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import * as sdk from '@rivalt/sdk';
import { CanonicalConformance } from './canonical-maker-conformance.js';
import { LOADER, payerKey } from './custody-cases.js';
import { canonicalMakerCases, type CanonicalHarness } from './canonical-maker-cases.js';
const svm = new LiteSVM().withSigverify(true).withBlockhashCheck(true);
const payer = await payerKey();
svm.airdrop(payer.address, lamports(100_000_000_000n));
for (const [name, program] of [['clearing',sdk.CLEARING_PROGRAM_ADDRESS], ['maker_a',sdk.makerA.MAKER_A_PROGRAM_ADDRESS],
  ['maker_b',sdk.makerB.MAKER_B_PROGRAM_ADDRESS]] as const) {
  svm.addProgramFromFile(program, `.local/canonical-maker/${name}.so`);
  const [key] = await getProgramDerivedAddress({ programAddress: LOADER, seeds: [getAddressEncoder().encode(program)] });
  const data = svm.getAccount(key); assert(data.exists);
  const bytes = Uint8Array.from(data.data); bytes[12] = 1; bytes.set(getAddressEncoder().encode(payer.address), 13);
  svm.setAccount({ ...data, data: bytes }); // Deployment authority only; no financial state injection.
}
const clock = svm.getClock(); clock.slot = 100n; clock.unixTimestamp = 1_800_000_000n; svm.setClock(clock);
const checks: any[] = [];
const conformance = new CanonicalConformance();
let returned = new Uint8Array();
const h: CanonicalHarness = {
  async rent(size) { return svm.minimumBalanceForRentExemption(BigInt(size)); },
  async read(key) { const data = svm.getAccount(key); return data.exists ? Buffer.from(data.data) : null; },
  async elapseSeconds(seconds) { const clock = svm.getClock(); clock.unixTimestamp += BigInt(seconds); svm.setClock(clock); },
  async send(label, instructions, signers = [], expectedError) {
    svm.expireBlockhash();
    const computeUnitLimit = label.startsWith('reprice ') ? 100_000 : label.startsWith('atomic') ? 800_000 : 400_000;
    const { transaction, wireBytes } = await sdk.signCanonicalInstructions({ async getLatestBlockhash() {
      return { blockhash: svm.latestBlockhash(), lastValidBlockHeight: 1_000_000n };
    } }, payer, instructions, { computeUnitLimit, loadedAccountsDataSizeLimit: 8*1024*1024 }, signers);
    conformance.record(instructions);
    const result = svm.sendTransaction(getTransactionDecoder().decode(transaction.serialize()));
    if (expectedError === undefined) {
      assert(!(result instanceof FailedTransactionMetadata), `${label}: ${result instanceof FailedTransactionMetadata ? result.meta().logs().join('\n') : ''}`);
      assert(result.computeUnitsConsumed() <= BigInt(computeUnitLimit * 0.8), `${label}: headroom`);
      returned = Uint8Array.from(result.returnData().data());
      checks.push({ label, version: transaction.version, bytes: wireBytes, computeUnits: String(result.computeUnitsConsumed()) });
    } else {
      assert(result instanceof FailedTransactionMetadata, `${label}: unexpectedly succeeded`);
      assert(result.meta().logs().some(log => log.includes(`Error Number: ${expectedError}.`)), `${label}: ${result.meta().logs().join('\n')}`);
      checks.push({ label, rejected: expectedError });
    }
  },
  async quote(label, instruction, expected) {
    await h.send(label, [instruction]);
    assert.equal(sdk.makerA.getMakerQuoteResponseDecoder().decode(returned).gross, expected, label);
  },
};
const result = await canonicalMakerCases(h);
const parity = await conformance.finish('.local/canonical-maker', [
  ...result.registrations.map(key => ({ program: sdk.CLEARING_PROGRAM_ADDRESS, name: 'makerRegistration', key })),
  ...await Promise.all(result.markets.map(async market => ({ program: sdk.CLEARING_PROGRAM_ADDRESS,
    name: 'liquidityRegistry', key: (await sdk.findLiquidityRegistryPda({ market }))[0] }))),
  ...result.makerAccounts.flatMap(item => [{ program: item.program, name: 'makerCurve', key: item.config },
    { program: item.program, name: 'makerPrice', key: item.price }]),
], h.read);
writeFileSync('.local/canonical-maker/lifecycle-svm.json', JSON.stringify({ checks, result, parity }, null, 2)+'\n');
console.log(`P30 compiled lifecycle: ${checks.length} cases, ${checks.filter(check => check.rejected).length} rejections.`);
