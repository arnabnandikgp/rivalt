import type { Instruction } from '@solana/kit';
import { ComputeBudgetProgram, Connection, Keypair, TransactionMessage, VersionedTransaction, type PublicKey } from '@solana/web3.js';
import type {Blockhash} from '@solana/kit';

export const V0_PACKET_LIMIT = 1_232;
export const V1_PACKET_LIMIT = 4_096;
export type CanonicalTransactionBudget = {
  computeUnitLimit: number;
  loadedAccountsDataSizeLimit: number;
};

/** Profile-4 transport only. Existing profiles retain their established transport.
 * Resource limits are explicit in both versions; v1 encodes them in its header.
 * Selection happens before signing/broadcast. There is no retry with a new signature.
 */
export function compileCanonicalTransaction(
  common:{payerKey:PublicKey;recentBlockhash:Blockhash},
  instructions: Instruction[],
  budget: CanonicalTransactionBudget,
) {
  if (!Number.isInteger(budget.computeUnitLimit) || budget.computeUnitLimit < 1 || budget.computeUnitLimit > 1_400_000
    || !Number.isInteger(budget.loadedAccountsDataSizeLimit) || budget.loadedAccountsDataSizeLimit < 1
    || budget.loadedAccountsDataSizeLimit > 64 * 1024 * 1024) throw new Error('Invalid canonical transaction resource budget');
  if (instructions.length === 0) throw new Error('Empty canonical transaction');
  if (instructions.some(ix => ix.programAddress === ComputeBudgetProgram.programId.toBase58())) {
    throw new Error('Pass resource limits through the budget, not compute-budget instructions');
  }
  const v0 = new VersionedTransaction(new TransactionMessage({ ...common, instructions: [
    ComputeBudgetProgram.setComputeUnitLimit({ units: budget.computeUnitLimit }),
    ComputeBudgetProgram.setLoadedAccountsDataSizeLimit({ accountDataSizeLimit: budget.loadedAccountsDataSizeLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0n }),
    ...instructions,
  ] }).compileToV0Message());
  const v0Bytes = v0.serialize().length;
  const transaction = v0Bytes <= V0_PACKET_LIMIT ? v0 : new VersionedTransaction(new TransactionMessage({
    ...common, instructions,
  }).compileToV1Message({ ...budget, priorityFeeLamports: 0n }));
  const wireBytes = transaction.serialize().length;
  const limit = transaction.version === 0 ? V0_PACKET_LIMIT : V1_PACKET_LIMIT;
  if (wireBytes > limit) throw new Error(`Canonical transaction is ${wireBytes} bytes; v${transaction.version} limit is ${limit}`);
  return {transaction,v0Bytes,wireBytes};
}

export async function signCanonicalInstructions(
  connection: Pick<Connection, 'getLatestBlockhash'>,
  payer: Keypair,
  instructions: Instruction[],
  budget: CanonicalTransactionBudget,
  additionalSigners: Keypair[] = [],
) {
  const lifetime = await connection.getLatestBlockhash('confirmed');
  const {transaction,v0Bytes,wireBytes}=compileCanonicalTransaction({payerKey:payer.publicKey,recentBlockhash:lifetime.blockhash},instructions,budget);
  const signers = [...new Map([payer, ...additionalSigners].map(signer => [signer.address, signer])).values()];
  await transaction.sign(signers);
  return { transaction, lifetime, v0Bytes, wireBytes };
}
