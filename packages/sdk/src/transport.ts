import type { Instruction } from '@solana/kit';
import { Connection, Keypair, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

/** Build and sign a v0 message using web3.js v3's native Kit instruction interoperability. */
export async function signInstructions(
  connection: Pick<Connection, 'getLatestBlockhash'>,
  payer: Keypair,
  instructions: Instruction[],
  additionalSigners: Keypair[] = [],
) {
  const lifetime = await connection.getLatestBlockhash('confirmed');
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: lifetime.blockhash,
    instructions,
  }).compileToV0Message());
  await transaction.sign([payer, ...additionalSigners]);
  return { transaction, lifetime };
}
