import { describe, expect, it } from 'vitest';
import { AccountRole, address, blockhash, type Instruction } from '@solana/kit';
import { PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { conflicts, flattenAccounts, instructionLocks, transactionLocks } from './lock-model.js';

const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));
const account = (byte: number, role: AccountRole) => ({ address: address(key(byte).toBase58()), role });
const instruction = (accounts: ReturnType<typeof account>[]): Instruction => ({ programAddress: address(key(9).toBase58()), accounts, data: new Uint8Array([1]) });
const compile = (instructions: Instruction[], payer = 1, version: 0 | 1 = 0) => {
  const message = new TransactionMessage({ payerKey: key(payer), recentBlockhash: blockhash(key(10).toBase58()), instructions });
  return new VersionedTransaction(version === 0 ? message.compileToV0Message() : message.compileToV1Message({
    computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: 8 * 1024 * 1024, priorityFeeLamports: 0n,
  })).serialize();
};

describe('performance lock analysis', () => {
  it('distinguishes read sharing from both directions of write conflicts', () => {
    expect(conflicts({ read: ['a'], write: [] }, { read: ['a'], write: [] })).toEqual([]);
    expect(conflicts({ read: ['a', 'b'], write: ['c', 'd'] }, { read: ['c'], write: ['a', 'd'] })).toEqual([
      { address: 'a', kind: 'read/write' }, { address: 'c', kind: 'write/read' }, { address: 'd', kind: 'write/write' },
    ]);
  });
  it('unions the entire atomic batch and promotes aliases to writable', () => {
    const result = instructionLocks([instruction([account(2, AccountRole.READONLY_SIGNER), account(3, AccountRole.WRITABLE)]),
      instruction([account(2, AccountRole.WRITABLE), account(3, AccountRole.READONLY)])]);
    expect(result).toEqual({ read: [key(9).toBase58()], write: [key(2).toBase58(), key(3).toBase58()].sort() });
  });
  for (const version of [0, 1] as const) it(`reads actual v${version} message privileges including the fee payer`, () => {
    const first = [instruction([account(2, AccountRole.READONLY_SIGNER), account(3, AccountRole.WRITABLE)])];
    const second = [instruction([account(4, AccountRole.WRITABLE)])];
    expect(conflicts(instructionLocks(first), instructionLocks(second))).toEqual([]);
    expect(conflicts(transactionLocks(compile(first, 1, version)), transactionLocks(compile(second, 1, version))))
      .toEqual([{ address: key(1).toBase58(), kind: 'write/write' }]);
    expect(conflicts(transactionLocks(compile(first, 1, version)), transactionLocks(compile(second, 5, version)))).toEqual([]);
  });
  it('retains a payer that is also an explicit economic write', () => {
    const inputs = [instruction([account(1, AccountRole.WRITABLE)])];
    expect(instructionLocks(inputs).write).toContain(key(1).toBase58());
    expect(transactionLocks(compile(inputs)).write).toContain(key(1).toBase58());
  });
  it('preserves nested, optional and signer roles in the IDL inventory', () => {
    expect(flattenAccounts([{ name: 'identity', accounts: [{ name: 'custody', writable: true }] },
      { name: 'second', optional: true }, { name: 'actor', signer: true }])).toEqual([
      { path: 'identity.custody', writable: true, signer: false, optional: false },
      { path: 'second', writable: false, signer: false, optional: true },
      { path: 'actor', writable: false, signer: true, optional: false },
    ]);
  });
});
