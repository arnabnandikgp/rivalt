import { describe, expect, it } from 'vitest';
import { ComputeBudgetProgram, Keypair, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { getBase58Decoder, blockhash } from '@solana/kit';
import { receiptMetrics, observedDistribution, type Receipt } from './receipt-metrics.js';

const payer = await Keypair.fromSeed(new Uint8Array(32).fill(1));
const clearing = (await Keypair.fromSeed(new Uint8Array(32).fill(2))).publicKey;
const maker = (await Keypair.fromSeed(new Uint8Array(32).fill(3))).publicKey;
const contracts = [
  { address: clearing.toBase58(), name: 'clearing', instructions: [{ name: 'trade', discriminator: [1, 2, 3, 4, 5, 6, 7, 8] }] },
  { address: maker.toBase58(), name: 'maker', instructions: [{ name: 'quote', discriminator: [8, 7, 6, 5, 4, 3, 2, 1] }] },
];
const base58 = getBase58Decoder();
async function sample(failed = false) {
  const instruction = new TransactionInstruction({ programId: clearing, keys: [{ pubkey: maker, isSigner: false, isWritable: false }],
    data: Buffer.from(contracts[0].instructions[0].discriminator) });
  const message = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash(payer.publicKey.toBase58()),
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 11 }), instruction,
      ...(failed ? [instruction] : [])] }).compileToV0Message();
  const transaction = new VersionedTransaction(message); await transaction.sign([payer]);
  const keys = message.staticAccountKeys.map(key => key.toBase58());
  const receipt: Receipt = { slot: 1, transaction: { signatures: transaction.signatures.map(value => base58.decode(value)),
    message: { accountKeys: keys, instructions: message.compiledInstructions.map(value => ({ programIdIndex: value.programIdIndex,
      accounts: [...value.accountKeyIndexes], data: base58.decode(value.data) })) } },
    meta: { err: failed ? { InstructionError: [2, { Custom: 6000 }] } : null, computeUnitsConsumed: 25_300, fee: 5002,
      innerInstructions: [{ index: 2, instructions: [{ programIdIndex: keys.indexOf(maker.toBase58()),
        accounts: [], data: base58.decode(Uint8Array.from(contracts[1].instructions[0].discriminator)), stackHeight: 2 }] }],
      logMessages: [`Program ${clearing} invoke [1]`, `Program ${maker} invoke [2]`,
        `Program ${maker} consumed 5000 of 95000 compute units`, `Program ${maker} success`,
        `Program ${clearing} consumed 25000 of 99700 compute units`, `Program ${clearing} ${failed ? 'failed: custom program error: 0x1770' : 'success'}`] } };
  return { receipt, wire: transaction.serialize() };
}
describe('signed receipt resource attribution', () => {
  it('separates inclusive CPI consumption and transaction cost with requested-limit priority rounding', async () => {
    const { receipt, wire } = await sample(), measured = receiptMetrics(receipt, wire, contracts);
    expect(measured.computeUnits).toBe(25_300);
    expect(measured.invocations.map(value => value.inclusiveCu)).toEqual([25_000, 5_000]);
    expect(measured.priorityLamports).toBe('2'); // ceil(100000 * 11 / 1e6), not consumed CU
  });
  it('does not credit a rolled-back child as successful coverage or count unexecuted later instructions', async () => {
    const { receipt, wire } = await sample(true), measured = receiptMetrics(receipt, wire, contracts);
    expect(measured.invocations).toHaveLength(2);
    expect(measured.invocations[1].instructionSucceeded).toBe(true);
    expect(measured.invocations.every(value => !value.transactionSucceeded)).toBe(true);
  });
  it.each(['truncated', 'wrong-program', 'body', 'signature', 'missing-inner'] as const)('rejects %s evidence corruption', async kind => {
    const { receipt, wire } = await sample();
    if (kind === 'truncated') receipt.meta.logMessages!.pop();
    if (kind === 'wrong-program') receipt.meta.logMessages![2] = `Program ${clearing} consumed 5000 of 95000 compute units`;
    if (kind === 'body') receipt.transaction.message.instructions[2].data = '11111111';
    if (kind === 'signature') receipt.transaction.signatures[0] = 'invalid';
    if (kind === 'missing-inner') receipt.meta.innerInstructions = [];
    expect(() => receiptMetrics(receipt, wire, contracts)).toThrow();
  });
  it('uses explicit nearest-rank observed quantiles', () => {
    expect(observedDistribution([3, 1, 4, 2])).toEqual({ n: 4, min: 1, p50: 2, p95: 4, p99: 4, max: 4 });
    expect(() => observedDistribution([])).toThrow();
  });
});
