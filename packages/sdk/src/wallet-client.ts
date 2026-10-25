import {getBase58Decoder, type Address, type Instruction} from '@solana/kit';
import {MessageV0, PublicKey, TransactionMessage, VersionedTransaction} from '@solana/web3.js';
import * as c from './generated/index.js';
import {walletComputeBudget} from './route-budget.js';

export const hex = (bytes: ArrayLike<number>) => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
export const toBase64 = (bytes: ArrayLike<number>) => btoa(Array.from(bytes, value => String.fromCharCode(value)).join(''));
export const fromBase64 = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));
export function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function rpcInteger(value: unknown): bigint {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'Invalid RPC integer');
  return BigInt(value);
}

export class UserRpc {
  private request = 0;
  constructor(readonly url: string) {}
  async call(method: string, params: unknown[] = []): Promise<any> {
    const id = ++this.request;
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new Error('RPC unavailable. Refresh to reconcile any signed transaction.');
    }
    requireValue(response.ok, 'RPC request unavailable.');
    const body = await response.json();
    requireValue(body.id === id, 'RPC response identity mismatch.');
    if (body.error)
      throw new Error(
        `RPC ${method} rejected: ${transactionError(body.error.data?.err ?? body.error.message)}`,
      );
    return body.result;
  }
}
export function transactionError(error: any): string {
  const code = error?.InstructionError?.[1]?.Custom;
  if (typeof code === 'number') {
    try {
      const message = c.getClearingErrorMessage(code as c.ClearingError);
      if (message && !message.includes('not available in production')) return `${message} (${code}).`;
    } catch {
      // A custom code may belong to SPL or another invoked program.
    }
    return `Program rejected instruction ${error.InstructionError[0] + 1} (code ${code}). Check balances, current authority and expiry before preparing again.`;
  }
  return typeof error === 'string' ? error.slice(0, 240) : 'Transaction rejected; no confirmed execution.';
}
export type PreparedTransaction = {
  label: string;
  transaction: VersionedTransaction;
  message: string;
  fee: bigint;
  lastValidBlockHeight: bigint;
  owner: Address;
  details: string[];
};
export type SignedIntent = {
  id: string;
  owner: Address;
  signature: string;
  wire: string;
  blockhash: string;
  lastValidBlockHeight: string;
  label: string;
  createdAt: number;
  status: 'pending' | 'confirmed' | 'finalized' | 'failed' | 'unresolved';
  error?: string;
  fee?: string;
};

/** Public message metadata only; no signature/private key or broadcast. */
export function walletMessageDifference(preparedMessage: string, transaction: VersionedTransaction) {
  try {
    const expected = MessageV0.deserialize(fromBase64(preparedMessage)), actual = transaction.message;
    const describe = (m: typeof expected) => m.compiledInstructions.map(ix => ({
      program: m.staticAccountKeys[ix.programIdIndex].toString(), data: hex(ix.data),
      accounts: ix.accountKeyIndexes.map(i => ({ address: m.staticAccountKeys[i].toString(), signer: m.isAccountSigner(i), writable: m.isAccountWritable(i) })),
    }));
    if (actual.version !== 0 || actual.addressTableLookups.length) return { unsupportedReturnedMessage: true };
    const before = describe(expected), after = describe(actual);
    return { blockhashChanged: expected.recentBlockhash !== actual.recentBlockhash,
      payerChanged: expected.staticAccountKeys[0].toString() !== actual.staticAccountKeys[0].toString(),
      expectedInstructions: before.length, returnedInstructions: after.length,
      originalInstructionsPreserved: before.every(ix => after.some(other => JSON.stringify(ix) === JSON.stringify(other))),
      addedInstructions: after.filter(ix => !before.some(other => JSON.stringify(ix) === JSON.stringify(other))).map(ix => ({ program: ix.program, data: ix.data.slice(0, 80) })) };
  } catch { return { unsupportedMessageDifference: true }; }
}

/** Shared immutable wallet transport. Each protocol client authenticates its own
 * deployment and chooses its measured instruction budget before preview. */
export abstract class WalletClient {
  readonly rpc: UserRpc;
  constructor(rpcUrl: string) { this.rpc = new UserRpc(rpcUrl); }
  abstract environment(): Promise<void>;
  protected walletInstructions(instructions: Instruction[]): Instruction[] { return walletComputeBudget(instructions); }
  async prepare(
    label: string,
    owner: Address,
    instructions: Instruction[],
    details: string[] = [],
  ): Promise<PreparedTransaction> {
    await this.environment();
    const latest = await this.rpc.call('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: new PublicKey(owner),
        recentBlockhash: latest.value.blockhash,
        instructions: this.walletInstructions(instructions),
      }).compileToV0Message(),
    );
    requireValue(transaction.serialize().length <= 1232, 'Transaction exceeds the supported message size.');
    const simulation = await this.rpc.call('simulateTransaction', [
      toBase64(transaction.serialize()),
      { encoding: 'base64', sigVerify: false, commitment: 'confirmed' },
    ]);
    requireValue(
      simulation.value.err === null,
      `Preview rejected: ${transactionError(simulation.value.err)} Refresh before signing.`,
    );
    const message = toBase64(transaction.message.serialize()),
      fee = await this.rpc.call('getFeeForMessage', [message, { commitment: 'confirmed' }]);
    requireValue(fee.value !== null, 'Network fee unavailable; refresh.');
    return {
      label,
      transaction,
      message,
      fee: rpcInteger(fee.value),
      lastValidBlockHeight: rpcInteger(latest.value.lastValidBlockHeight),
      owner,
      details,
    };
  }
  async signed(prepared: PreparedTransaction, transaction: VersionedTransaction): Promise<SignedIntent> {
    if (toBase64(transaction.message.serialize()) !== prepared.message)
      throw new Error(`Wallet returned a different transaction. Nothing was sent. ${JSON.stringify(walletMessageDifference(prepared.message, transaction))}`);
    requireValue(
      transaction.signatures.length === 1 &&
        transaction.message.staticAccountKeys[0].address === prepared.owner,
      'Unexpected signer. Nothing was sent.',
    );
    requireValue(
      await transaction.message.staticAccountKeys[0].verifySignature(
        transaction.signatures[0] as any,
        transaction.message.serialize(),
      ),
      'Invalid wallet signature. Nothing was sent.',
    );
    await this.environment();
    const wire = toBase64(transaction.serialize()),
      signature = getBase58Decoder().decode(transaction.signatures[0]);
    return {
      id: crypto.randomUUID(),
      owner: prepared.owner,
      signature,
      wire,
      blockhash: transaction.message.recentBlockhash,
      lastValidBlockHeight: prepared.lastValidBlockHeight.toString(),
      label: prepared.label,
      createdAt: Date.now(),
      status: 'pending',
    };
  }
  async broadcast(intent: SignedIntent) {
    const transaction = VersionedTransaction.deserialize(fromBase64(intent.wire));
    requireValue(
      transaction.signatures.length === 1 &&
        transaction.message.staticAccountKeys[0].address === intent.owner &&
        transaction.message.recentBlockhash === intent.blockhash &&
        getBase58Decoder().decode(transaction.signatures[0]) === intent.signature,
      'Saved transaction identity mismatch. Nothing was sent.',
    );
    requireValue(
      await transaction.message.staticAccountKeys[0].verifySignature(
        transaction.signatures[0] as any,
        transaction.message.serialize(),
      ),
      'Saved signature is invalid. Nothing was sent.',
    );
    await this.environment();
    // prepare() already simulates the reviewed message. Like the durable relay,
    // submit the signed bytes to on-chain validation without a second preflight:
    // a race should be observable as a failed transaction, not silently replace
    // an already signed intent after an RPC-only rejection. Fees still apply.
    const signature = await this.rpc.call('sendTransaction', [
      intent.wire,
      { encoding: 'base64', skipPreflight: true, maxRetries: 0 },
    ]);
    requireValue(
      signature === intent.signature,
      'Broadcast acknowledgement mismatch; reconcile the saved signature.',
    );
  }
  async reconcile(intent: SignedIntent): Promise<SignedIntent> {
    await this.environment();
    const statuses = await this.rpc.call('getSignatureStatuses', [
        [intent.signature],
        { searchTransactionHistory: true },
      ]),
      status = statuses.value[0];
    if (status?.confirmationStatus === 'finalized') {
      const tx = await this.rpc.call('getTransaction', [
        intent.signature,
        { commitment: 'finalized', encoding: 'base64', maxSupportedTransactionVersion: 0 },
      ]);
      if (
        !tx?.meta ||
        tx.transaction?.[1] !== 'base64' ||
        tx.transaction[0] !== intent.wire ||
        JSON.stringify(status.err) !== JSON.stringify(tx.meta.err)
      )
        return {
          ...intent,
          status: 'unresolved',
          error: 'Finalized transaction details are unavailable or conflict with the saved transaction.',
        };
      return {
        ...intent,
        status: tx.meta.err === null ? 'finalized' : 'failed',
        fee: rpcInteger(tx.meta.fee).toString(),
        error: tx.meta.err === null ? undefined : transactionError(tx.meta.err),
      };
    }
    if (status?.confirmationStatus === 'confirmed') return { ...intent, status: 'confirmed' };
    const valid = await this.rpc.call('isBlockhashValid', [intent.blockhash, { commitment: 'finalized' }]);
    return {
      ...intent,
      status: valid.value ? 'pending' : 'unresolved',
      error: valid.value
        ? undefined
        : 'Lifetime ended without conclusive history. Do not repeat the action; refresh this saved signature.',
    };
  }
}
