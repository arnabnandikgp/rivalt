// Resource attribution from fetched signed transactions, not simulation or log text names.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getBase58Encoder, getBase58Decoder } from '@solana/kit';
import { VersionedTransaction } from '@solana/web3.js';
import { transactionLocks } from './lock-model.js';

export type ProgramContract = { address: string; name: string; instructions: { name: string; discriminator: number[] }[] };
type CompiledInstruction = { programIdIndex: number; accounts: number[]; data: string; stackHeight?: number | null };
export type Receipt = {
  slot: number;
  transaction: { signatures: string[]; message: { accountKeys: string[]; instructions: CompiledInstruction[] } };
  meta: { err: null | { InstructionError: [number, unknown] }; computeUnitsConsumed: number; fee: number;
    loadedAccountsDataSize?: number; loadedAddresses?: { writable: string[]; readonly: string[] };
    innerInstructions: { index: number; instructions: CompiledInstruction[] }[] | null; logMessages: string[] | null };
};
type Frame = { program: string; depth: number; consumed?: number; failed?: boolean };
const budgetProgram = 'ComputeBudget111111111111111111111111111111';
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function receiptMetrics(receipt: Receipt, wire: Uint8Array, contracts: ProgramContract[]) {
  const transaction = VersionedTransaction.deserialize(wire), message = transaction.message;
  assert([0, 1].includes(Number(message.version)), 'Only qualified v0/v1 messages');
  const locks = transactionLocks(wire); // refuses unresolved address lookups
  assert.equal(getBase58Decoder().decode(transaction.signatures[0]), receipt.transaction.signatures[0], 'Original signature');
  assert.deepEqual(transaction.signatures.map(signature => getBase58Decoder().decode(signature)), receipt.transaction.signatures);
  const keys = message.staticAccountKeys.map(key => key.toBase58());
  assert.deepEqual(keys, receipt.transaction.message.accountKeys, 'Fetched account keys must match signed wire');
  assert.equal((receipt.meta.loadedAddresses?.writable.length ?? 0) + (receipt.meta.loadedAddresses?.readonly.length ?? 0), 0);
  assert.equal(receipt.transaction.message.instructions.length, message.compiledInstructions.length);
  for (const [index, instruction] of message.compiledInstructions.entries()) {
    const fetched = receipt.transaction.message.instructions[index];
    assert.equal(instruction.programIdIndex, fetched.programIdIndex);
    assert.deepEqual([...instruction.accountKeyIndexes], fetched.accounts, 'Fetched privileges use the signed account indices');
    assert.deepEqual(Buffer.from(instruction.data), Buffer.from(getBase58Encoder().encode(fetched.data)), 'Fetched instruction matches signed wire');
  }
  assert(Number.isSafeInteger(receipt.meta.computeUnitsConsumed) && receipt.meta.computeUnitsConsumed > 0);
  assert(Number.isSafeInteger(receipt.meta.fee) && receipt.meta.fee >= 0);
  const contractsByAddress = new Map(contracts.map(contract => [contract.address, contract]));
  const frames: Frame[] = [], stack: Frame[] = [];
  for (const line of receipt.meta.logMessages ?? []) {
    let match = /^Program (\w+) invoke \[(\d+)\]$/.exec(line);
    if (match) {
      const frame: Frame = { program: match[1], depth: Number(match[2]) };
      assert.equal(frame.depth, stack.length + 1, 'Complete invocation ancestry');
      frames.push(frame); stack.push(frame); continue;
    }
    match = /^Program (\w+) consumed (\d+) of \d+ compute units$/.exec(line);
    if (match) {
      const frame = stack.at(-1); assert(frame && frame.program === match[1], 'CU must belong to immediate program frame');
      assert.equal(frame.consumed, undefined, 'Duplicate consumption'); frame.consumed = Number(match[2]); continue;
    }
    match = /^Program (\w+) (success|failed:.*)$/.exec(line);
    if (match) {
      const frame = stack.pop(); assert(frame && frame.program === match[1], 'Balanced authenticated log ancestry');
      frame.failed = match[2] !== 'success';
    }
  }
  assert.equal(stack.length, 0, 'Truncated logs cannot establish instruction CU');
  const failedOuter = receipt.meta.err?.InstructionError?.[0];
  assert(receipt.meta.err === null || Number.isInteger(failedOuter), 'Unsupported failure shape');
  const compiled: { program: string; name: string | undefined; depth: number; outer: number; data: Uint8Array }[] = [];
  for (const [outer, instruction] of receipt.transaction.message.instructions.entries()) {
    if (failedOuter !== undefined && outer > failedOuter) break; // not executed after atomic failure
    const rows = [{ ...instruction, stackHeight: 1 }, ...(receipt.meta.innerInstructions?.find(group => group.index === outer)?.instructions ?? [])];
    for (const row of rows) {
      const program = keys[row.programIdIndex], contract = contractsByAddress.get(program);
      if (!contract) continue;
      assert(Number.isInteger(row.stackHeight) && row.stackHeight! > 0, 'Explicit CPI stack height required');
      const data = new Uint8Array(getBase58Encoder().encode(row.data));
      const entry = contract.instructions.find(entry => Buffer.from(entry.discriminator).equals(Buffer.from(data.subarray(0, 8))));
      compiled.push({ program, name: entry ? `${contract.name}.${entry.name}` : undefined, depth: row.stackHeight!, outer, data });
    }
  }
  const measuredFrames = frames.filter(frame => contractsByAddress.has(frame.program));
  assert.equal(measuredFrames.length, compiled.length, 'Every compiled Rivalt invocation must have a complete log frame');
  const invocations = compiled.flatMap((instruction, index) => {
    const frame = measuredFrames[index];
    assert.equal(frame.program, instruction.program); assert.equal(frame.depth, instruction.depth);
    assert(frame.consumed !== undefined && frame.consumed > 0, 'Missing instruction consumption');
    assert(frame.consumed <= receipt.meta.computeUnitsConsumed, 'Inclusive instruction CU exceeds transaction');
    if (!instruction.name) return []; // event self-CPI is included in its financial parent, not a public entrypoint
    return [{ name: instruction.name, outer: instruction.outer, depth: instruction.depth, inclusiveCu: frame.consumed,
      instructionSucceeded: !frame.failed, transactionSucceeded: receipt.meta.err === null,
      dataSha256: digest(instruction.data) }];
  });
  let requestedCu: number | undefined, priorityLamports: bigint | undefined, microLamports = 0n;
  if (message.version === 1) {
    requestedCu = message.transactionConfig?.computeUnitLimit;
    priorityLamports = message.transactionConfig?.priorityFeeLamports ?? 0n;
  } else {
    for (const instruction of message.compiledInstructions) {
      if (keys[instruction.programIdIndex] !== budgetProgram) continue;
      const data = Buffer.from(instruction.data);
      if (data[0] === 2) { assert.equal(requestedCu, undefined); requestedCu = data.readUInt32LE(1); }
      if (data[0] === 3) microLamports = data.readBigUInt64LE(1);
    }
    if (requestedCu !== undefined) priorityLamports = (BigInt(requestedCu) * microLamports + 999_999n) / 1_000_000n;
  }
  assert(requestedCu !== undefined && priorityLamports !== undefined, 'Explicit resource/fee contract required');
  assert(receipt.meta.computeUnitsConsumed <= requestedCu);
  return { signature: receipt.transaction.signatures[0], slot: receipt.slot, outcome: receipt.meta.err === null ? 'success' : 'rejected',
    computeUnits: receipt.meta.computeUnitsConsumed, requestedCu, feeLamports: String(receipt.meta.fee),
    priorityLamports: String(priorityLamports), version: message.version, wireBytes: wire.length,
    signatures: transaction.signatures.length, loadedAccounts: keys.length,
    loadedDataBytes: receipt.meta.loadedAccountsDataSize ?? null, locks,
    wireSha256: digest(wire), invocations };
}

/** Nearest-rank quantiles of observations, not a model of unobserved landing. */
export function observedDistribution(values: number[]) {
  assert(values.length && values.every(Number.isFinite));
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (portion: number) => sorted[Math.ceil(portion * sorted.length) - 1];
  return { n: values.length, min: sorted[0], p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: sorted.at(-1)! };
}
