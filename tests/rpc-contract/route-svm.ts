import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getAddressEncoder, getAddressDecoder, getTransactionDecoder, lamports, type Instruction } from '@solana/kit';
import { Keypair } from '@solana/web3.js';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import * as sdk from '@rivalt/sdk';
import { addresses, custodyCases, payerKey } from './custody-cases.js';
import { makerCases, makerIds } from './maker-cases.js';
import { routeCases, type RouteHarness } from './route-cases.js';
const svm = new LiteSVM().withSigverify(true).withBlockhashCheck(true);
svm.addProgramFromFile(sdk.CLEARING_PROGRAM_ADDRESS, 'target/deploy/clearing.so');
for (const [id, p] of makerIds.entries()) svm.addProgramFromFile(p, `target/deploy/maker_${id === 0 ? 'a' : 'b'}.so`);
const payer = await payerKey();svm.airdrop(payer.address, lamports(100_000_000_000n));
const a = await addresses();
const pd = svm.getAccount(a.programData);assert(pd.exists);const bytes = Uint8Array.from(pd.data);bytes[12] = 1;bytes.set(getAddressEncoder().encode(payer.address), 13);svm.setAccount({ ...pd, data: bytes });
const checks: unknown[] = [];
async function send(label: string, instructions: Instruction[], signers: Keypair[] = [], expectedError?: number | 'reject') {
  svm.expireBlockhash();
  const { transaction } = await sdk.signInstructions({ async getLatestBlockhash() { return { blockhash: svm.latestBlockhash(), lastValidBlockHeight: 1_000_000n }; } }, payer, instructions, signers);
  const result = svm.sendTransaction(getTransactionDecoder().decode(transaction.serialize()));
  if (expectedError === undefined) {
    assert(!(result instanceof FailedTransactionMetadata), `${label}: ${result instanceof FailedTransactionMetadata ? result.meta().logs().join('\n') : ''}`);
    checks.push({ label, status: 'pass', computeUnits: result.computeUnitsConsumed().toString(), transactionBytes: transaction.serialize().length });return result;
  }
  assert(result instanceof FailedTransactionMetadata, `${label}: unexpectedly succeeded`);
  if (expectedError !== 'reject') assert(result.meta().logs().some(l => l.includes(`Error Number: ${expectedError}.`)), `${label}: expected ${expectedError}\n${result.meta().logs().join('\n')}`);
  checks.push({ label, status: 'rejected', error: expectedError });return undefined;
}
const h: RouteHarness = {
  async replaceMaker(hostile) { svm.addProgramFromFile(makerIds[1], `target/deploy/${hostile ? 'hostile_maker' : 'maker_b'}.so`); },
  async rent(n) { return svm.minimumBalanceForRentExemption(BigInt(n)); },
  async read(k) { const x = svm.getAccount(k);return x.exists ? Buffer.from(x.data) : null; },
  async send(...args) { await send(...args); },
  async quote(label, ix) { const meta = (await send(label, [ix]))!;return { producer: getAddressDecoder().decode(meta.returnData().programId()), data: meta.returnData().data() }; },
  async slot() { return svm.getClock().slot; },
  async waitUntil(slot) { svm.warpToSlot(slot); },
};
await custodyCases(h);
await makerCases(h);
const setupCount = checks.length;
svm.addProgramFromFile(a.program, '.local/clearing-no-routes.so');
await h.send('default compiled artifact refuses test trading activation', [await sdk.getInitializeTestRoutesInstructionAsync({...a,authority:payer,reference:60_000n,duration:3600n})], [], 6108);
svm.addProgramFromFile(a.program, 'target/deploy/clearing.so');
const result = await routeCases(h);
const evidence = { revision: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()!=='',runtime:'litesvm node 1.6.1',setupCount,checks,result,
  binaries:Object.fromEntries(['clearing','maker_a','maker_b','hostile_maker'].map(n=>[n,createHash('sha256').update(readFileSync(`target/deploy/${n}.so`)).digest('hex')])) };
writeFileSync('.local/p04-svm.json',JSON.stringify(evidence,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
console.log(`Route LiteSVM: ${checks.length-setupCount} signed P04 scenarios plus ${setupCount} real custody setup scenarios passed.`);
