import { describe, expect, it } from 'vitest';
import { blockhash, address, getCompiledTransactionMessageDecoder, getTransactionDecoder } from '@solana/kit';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { signCanonicalInstructions } from './canonical-transport.js';

const connection = { getLatestBlockhash: async () => ({ blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 100n }) };
const budget = { computeUnitLimit: 400_000, loadedAccountsDataSizeLimit: 8 * 1024 * 1024 };
const instruction = (bytes: number) => ({ programAddress: address('11111111111111111111111111111111'), accounts: [], data: new Uint8Array(bytes) });

describe('canonical transaction version and resource selection', () => {
  it('keeps smaller signed messages in v0 and measures the complete wire', async () => {
    const payer = await Keypair.fromSeed(new Uint8Array(32).fill(30));
    const result = await signCanonicalInstructions(connection, payer, [instruction(8)], budget);
    expect(result.transaction.version).toBe(0);
    expect(result.wireBytes).toBe(result.transaction.serialize().length);
    expect(result.wireBytes).toBeLessThanOrEqual(1232);
    expect(result.transaction.message.compiledInstructions).toHaveLength(4);
  });
  it('selects v1 above the v0 limit with explicit header budgets and both decoders', async () => {
    const payer = await Keypair.fromSeed(new Uint8Array(32).fill(30));
    const result = await signCanonicalInstructions(connection, payer, [instruction(1250)], budget);
    expect(result.v0Bytes).toBeGreaterThan(1232);
    expect(result.wireBytes).toBeGreaterThan(1232);
    expect(result.wireBytes).toBeLessThanOrEqual(4096);
    expect(result.transaction.version).toBe(1);
    const bytes = result.transaction.serialize();
    const web3 = VersionedTransaction.deserialize(bytes);
    expect(web3.message.compiledInstructions).toHaveLength(1);
    const kit = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(bytes).messageBytes);
    expect(kit.version).toBe(1);
    if (kit.version !== 1) throw new Error('Expected v1');
    expect(kit.configMask).toBe(15);
    expect(kit.configValues).toEqual([{ kind: 'u64', value: 0n }, { kind: 'u32', value: 400_000 },
      { kind: 'u32', value: 8 * 1024 * 1024 }]);
    expect(Buffer.from(web3.serialize())).toEqual(Buffer.from(bytes));
    expect(result.transaction.signatures[0].some(byte => byte !== 0)).toBe(true);
  });
  it('switches exactly at the complete 1232-byte v0 boundary', async () => {
    const payer = await Keypair.fromSeed(new Uint8Array(32).fill(30));
    const measured = await signCanonicalInstructions(connection, payer, [instruction(900)], budget);
    const boundaryDataBytes = 900 + 1232 - measured.v0Bytes;
    const fits = await signCanonicalInstructions(connection, payer, [instruction(boundaryDataBytes)], budget);
    const exceeds = await signCanonicalInstructions(connection, payer, [instruction(boundaryDataBytes+1)], budget);
    expect(fits.v0Bytes).toBe(1232); expect(fits.transaction.version).toBe(0);
    expect(exceeds.v0Bytes).toBe(1233); expect(exceeds.transaction.version).toBe(1);
  });
  it('rejects packets larger than v1 before signing or sending', async () => {
    const payer = await Keypair.fromSeed(new Uint8Array(32).fill(30));
    await expect(signCanonicalInstructions(connection, payer, [instruction(4096)], budget)).rejects.toThrow('limit is 4096');
  });
  it('rejects implicit, excessive and conflicting budgets', async () => {
    const payer = await Keypair.fromSeed(new Uint8Array(32).fill(30));
    for (const invalid of [{ ...budget, computeUnitLimit: 0 }, { ...budget, computeUnitLimit: 1_400_001 },
      { ...budget, loadedAccountsDataSizeLimit: 0 }]) {
      await expect(signCanonicalInstructions(connection, payer, [instruction(8)], invalid)).rejects.toThrow('resource budget');
    }
    await expect(signCanonicalInstructions(connection, payer, [{ ...instruction(8),
      programAddress: address('ComputeBudget111111111111111111111111111111') }], budget)).rejects.toThrow('through the budget');
  });
});
