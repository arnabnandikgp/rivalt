import assert from 'node:assert/strict';
import type { Instruction } from '@solana/kit';
import { VersionedTransaction } from '@solana/web3.js';

export type LockSet = { read: string[]; write: string[] };
export type Conflict = { address: string; kind: 'write/write' | 'write/read' | 'read/write' };

function canonical(read: Set<string>, write: Set<string>): LockSet {
  return { read: [...read].filter(key => !write.has(key)).sort(), write: [...write].sort() };
}

/** Instruction privileges before the message compiler promotes the fee payer.
 * Union duplicates across the complete atomic transaction, including CPI programs.
 * These are account locks, not Rust borrows or an estimate of actual mutations. */
export function instructionLocks(instructions: readonly Instruction[]): LockSet {
  const read = new Set<string>(), write = new Set<string>();
  for (const instruction of instructions) {
    read.add(instruction.programAddress);
    for (const account of instruction.accounts ?? []) {
      assert([0, 1, 2, 3].includes(account.role), 'Unknown account privilege');
      (account.role & 1 ? write : read).add(account.address);
    }
  }
  return canonical(read, write);
}

/** The signed message is the scheduler contract. Current Rivalt uses no ALTs;
 * reject unresolved lookups rather than silently omitting locked accounts. */
export function transactionLocks(wire: Uint8Array): LockSet {
  const { message } = VersionedTransaction.deserialize(wire);
  if (message.version === 0) assert.equal(message.addressTableLookups.length, 0, 'Resolve ALT addresses before lock analysis');
  const keys = message.getAccountKeys(), read = new Set<string>(), write = new Set<string>();
  for (let index = 0; index < keys.length; index++) {
    const key = keys.get(index);
    assert(key, 'Missing compiled account');
    (message.isAccountWritable(index) ? write : read).add(key.toBase58());
  }
  return canonical(read, write);
}

export function conflicts(left: LockSet, right: LockSet): Conflict[] {
  const rightRead = new Set(right.read), rightWrite = new Set(right.write);
  return [
    ...left.write.filter(key => rightWrite.has(key)).map(address => ({ address, kind: 'write/write' as const })),
    ...left.write.filter(key => rightRead.has(key)).map(address => ({ address, kind: 'write/read' as const })),
    ...left.read.filter(key => rightWrite.has(key)).map(address => ({ address, kind: 'read/write' as const })),
  ].sort((a, b) => a.address.localeCompare(b.address));
}

export type IdlAccount = { name: string; writable?: boolean; signer?: boolean; optional?: boolean; accounts?: IdlAccount[] };
export function flattenAccounts(accounts: IdlAccount[], prefix = ''): { path: string; writable: boolean; signer: boolean; optional: boolean }[] {
  return accounts.flatMap(account => account.accounts ? flattenAccounts(account.accounts, `${prefix}${account.name}.`)
    : [{ path: prefix + account.name, writable: account.writable ?? false,
      signer: account.signer ?? false, optional: account.optional ?? false }]);
}
