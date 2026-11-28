import {expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {getAddressDecoder, getBase58Decoder} from '@solana/kit';
import {getAccountTransitionEventDecoder, getAccountTransitionEventEncoder, SHADOW_COVERAGE_ARTIFACT_SET, VERIFIED_COVERAGE_ARTIFACT_SET} from '@rivalt/sdk';
import clearingIdl from '../../sdk/idl/clearing.json' with {type: 'json'};
import {decodeAccountInvocations} from './account-events.js';
import {decodeTransition, scopedInvocations} from './scoped-events.js';

// Literal transport fixtures only. These intentionally do not claim signed or
// successful economic executions; rebuilt RPC/SDK parity is a separate gate.
const key = (byte: number) => getAddressDecoder().decode(new Uint8Array(32).fill(byte));
const keys = [1, 2, 3, 4, 5, 6, 7].map(key);
const [payer, root, venue, program, eventAuthority, wrapper] = keys;
const binding = {program, eventAuthority, venue, domain: '09'.repeat(32)};
const instruction = Buffer.from(clearingIdl.instructions.find(value => value.name === 'deposit_account')!.discriminator);
const tag = Buffer.from('e445a52e51cb9a1d', 'hex');
const transitionTag = createHash('sha256').update('event:AccountTransition').digest().subarray(0, 8);
const encoded = (bytes: Buffer) => getBase58Decoder().decode(bytes);
const u16 = (value: number) => {const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes;};
const u32 = (value: number) => {const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes;};
const u64 = (value: bigint) => {const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(value); return bytes;};
const footer = (payloadCount = 1, before = 7n) => Buffer.concat([
  transitionTag, u16(10), Buffer.alloc(32, 3), Buffer.alloc(32, 9), u64(42n), instruction, u16(payloadCount),
  u32(1), Buffer.alloc(32, 3), Buffer.from([0]), u64(1n),
  u32(1), Buffer.alloc(32, 2), Buffer.from([5]), u64(before), u64(before + 1n),
]);
const call = (programIdIndex = 3, stackHeight = 1) => ({programIdIndex, accounts: [1, 2, 4, 3], data: encoded(instruction), stackHeight});
const event = (payload: Buffer, stackHeight = 2) => ({programIdIndex: 3, accounts: [4], data: encoded(Buffer.concat([tag, payload])), stackHeight});
const financialPayload = createHash('sha256').update('event:AccountCustodyChanged').digest().subarray(0, 8);
const tx = () => ({slot: 42, blockTime: 100, transaction: {signatures: ['original'], message: {
  header: {numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 5},
  accountKeys: [...keys], instructions: [call()], addressTableLookups: [] as any[],
}}, meta: {err: null as unknown, innerInstructions: [{index: 0, instructions: [event(financialPayload), event(footer())]}],
  loadedAddresses: {writable: [] as string[], readonly: [] as string[]}, logMessages: ['untrusted program data']}});
const decode = (transaction: any) => scopedInvocations('original', transaction, 3, binding);

it('authenticates direct and multiple outer invocations without a global sequence', () => {
  const transaction = tx();
  expect(decode(transaction)).toMatchObject([{outer: 0, invocation: 0, transactionIndex: 3, slot: 42n,
    reads: [{account: venue, kind: 0, revision: '1'}], writes: [{account: root, kind: 5, before: '7', after: '8'}],
    payloads: [{inner: 0, bytes: financialPayload.toString('base64')}], footerInner: 1}]);
  transaction.transaction.message.instructions.push(call());
  transaction.meta.innerInstructions.push({index: 1, instructions: [event(footer(0, 8n))]});
  expect(decode(transaction).map(value => [value.outer, value.invocation, value.payloads.length])).toEqual([[0, 0, 1], [1, 0, 0]]);
});

it('authenticates two clearing CPI frames under an external wrapper', () => {
  const transaction = tx();
  transaction.transaction.message.instructions = [call(5)];
  transaction.meta.innerInstructions[0].instructions = [call(3, 2), event(financialPayload, 3), event(footer(), 3),
    call(3, 2), event(footer(0, 8n), 3)];
  expect(decode(transaction).map(value => [value.outer, value.invocation, value.footerInner])).toEqual([[0, 0, 2], [0, 1, 4]]);
  const wrongParent = structuredClone(transaction);
  wrongParent.meta.innerInstructions[0].instructions[0].programIdIndex = 6;
  expect(() => decode(wrongParent)).toThrow(/foreign invocation/);
  const missingHeight: any = structuredClone(transaction);
  delete missingHeight.meta.innerInstructions[0].instructions[1].stackHeight;
  expect(() => decode(missingHeight)).toThrow();
  const gap = structuredClone(transaction);
  gap.meta.innerInstructions[0].instructions[1].stackHeight = 4;
  expect(() => decode(gap)).toThrow(/ancestry/);
});

it('rejects missing, duplicate, trailing, wrong-frame and mismatched footers atomically', () => {
  for (const mutate of [
    (value: ReturnType<typeof tx>) => value.meta.innerInstructions[0].instructions.pop(),
    (value: ReturnType<typeof tx>) => value.meta.innerInstructions[0].instructions.push(event(footer())),
    (value: ReturnType<typeof tx>) => value.meta.innerInstructions[0].instructions.push(event(financialPayload)),
    (value: ReturnType<typeof tx>) => value.meta.innerInstructions[0].instructions.push(call(6, 2)),
    (value: ReturnType<typeof tx>) => {value.meta.innerInstructions[0].instructions[1] = event(footer(0));},
    (value: ReturnType<typeof tx>) => {value.meta.innerInstructions[0].instructions[0].accounts = [1];},
    (value: ReturnType<typeof tx>) => {value.slot = 43;},
    (value: ReturnType<typeof tx>) => {value.transaction.message.instructions[0].accounts = [1, 4, 3];},
    (value: ReturnType<typeof tx>) => {value.transaction.message.header.numReadonlyUnsignedAccounts = 6;},
  ]) {
    const transaction = tx(); mutate(transaction); expect(() => decode(transaction)).toThrow();
  }
  const unknownPayload = tx(); unknownPayload.meta.innerInstructions[0].instructions[0] = event(Buffer.alloc(8));
  expect(() => decode(unknownPayload)).toThrow(/Unknown or oversized critical/);
  const wrongCall = tx(); wrongCall.transaction.message.instructions[0].data = encoded(Buffer.alloc(8, 255));
  expect(() => decode(wrongCall)).toThrow(/Unknown clearing/);
  expect(() => scopedInvocations('original', tx(), 3, {...binding, domain: '08'.repeat(32)})).toThrow(/domain mismatch/);
});

it('resolves loaded keys and writable privileges without treating ALT entries as static keys', () => {
  const transaction = tx();
  // Move the margin root to loaded writable position 6; all static keys are R
  // except payer. Preserve actual account-key indexes in every affected instruction.
  transaction.transaction.message.accountKeys = [payer, venue, program, eventAuthority, wrapper, keys[6]];
  transaction.transaction.message.header.numReadonlyUnsignedAccounts = 5;
  transaction.transaction.message.addressTableLookups = [{accountKey: key(8), writableIndexes: [11], readonlyIndexes: []}];
  transaction.meta.loadedAddresses.writable = [root];
  transaction.transaction.message.instructions[0] = {...call(), programIdIndex: 2, accounts: [6, 1, 3, 2]};
  transaction.meta.innerInstructions[0].instructions = [financialPayload, footer()].map(payload => ({...event(payload), programIdIndex: 2, accounts: [3]}));
  expect(decode(transaction)[0].writes[0].account).toBe(root);
  transaction.meta.loadedAddresses.writable = [];
  expect(() => decode(transaction)).toThrow(/loaded addresses/);
});

it('excludes reverted effects but rejects incomplete success metadata and conflicting transport identities', () => {
  const transaction = tx(); transaction.meta.err = {InstructionError: [0, 'Custom']};
  expect(decode(transaction)).toEqual([]);
  expect(() => scopedInvocations('different', tx(), 3, binding)).toThrow(/identity/);
  const duplicate = tx(); duplicate.meta.innerInstructions.push(duplicate.meta.innerInstructions[0]);
  expect(() => decode(duplicate)).toThrow(/duplicate inner/);
  const absent: any = tx(); delete absent.meta.innerInstructions;
  expect(() => decode(absent)).toThrow(/Missing inner/);
  const missingError: any = tx(); delete missingError.meta.err;
  expect(() => decode(missingError)).toThrow(/metadata/);
});

it('checks literal envelope widths, revisions, bounded counts, aliases and complete consumption', () => {
  expect(decodeTransition(footer())).toMatchObject({payloadCount: 1, slot: 42n, domain: binding.domain});
  for (const mutate of [
    (bytes: Buffer) => {bytes.writeUInt16LE(4, 8);},
    (bytes: Buffer) => {bytes.writeUInt16LE(5, 90);},
    (bytes: Buffer) => {bytes.writeUInt32LE(32, 92);},
    (bytes: Buffer) => {bytes.writeBigUInt64LE(0n, 129);},
    (bytes: Buffer) => {bytes.writeUInt32LE(0, 137);},
    (bytes: Buffer) => {bytes.fill(3, 141, 173);},
    (bytes: Buffer) => {bytes[173] = 35;},
    (bytes: Buffer) => {bytes.writeBigUInt64LE(9n, 182);},
  ]) {const bytes = footer(); mutate(bytes); expect(() => decodeTransition(bytes)).toThrow();}
  for (let kind=17;kind<=34;kind++) {const bytes=footer();bytes[173]=kind;expect(decodeTransition(bytes).writes[0].kind).toBe(kind);}
  expect(() => decodeTransition(footer().subarray(0, -1))).toThrow(/Truncated/);
  expect(() => decodeTransition(Buffer.concat([footer(), Buffer.from([0])]))).toThrow(/Trailing/);
});

it('matches the rebuilt generated SDK against the literal schema-10 envelope', () => {
  const bytes = footer(), [value, end] = getAccountTransitionEventDecoder().read(bytes, 0);
  expect(end).toBe(190);
  expect(value.schemaVersion).toBe(10);
  expect(value.venue).toBe(venue);
  expect(value.reads).toEqual([{account: venue, kind: 0, revision: 1n}]);
  expect(value.writes).toEqual([{account: root, kind: 5, before: 7n, after: 8n}]);
  expect(Buffer.from(getAccountTransitionEventEncoder().encode(value))).toEqual(bytes);
});

it('admits a wider certificate footer only for the authenticated book instruction and exact account roles',()=>{
  const book=clearingIdl.instructions.find(ix=>ix.name==='verify_inventory_book')!.discriminator;
  const reads=[0,1,2,3,24,10,6,6,7,7].map((kind,i)=>({account:key(3+i),kind,revision:1n}));
  const writes=Array.from({length:23},(_,i)=>({account:key(20+i),kind:i===0?17:18,before:1n,after:2n}));
  const value={schemaVersion:10,venue,domain:new Uint8Array(32).fill(9),slot:42n,instruction:Uint8Array.from(book),payloadCount:1,reads,writes};
  const bytes=(event:typeof value)=>Buffer.from(getAccountTransitionEventEncoder().encode(event));
  expect(decodeTransition(bytes(value)).writes).toHaveLength(23);
  expect(()=>decodeTransition(bytes({...value,instruction:Uint8Array.from(instruction)}))).toThrow();
  expect(()=>decodeTransition(bytes({...value,writes:writes.map((row,i)=>i===1?{...row,kind:5}:row)}))).toThrow();
  expect(()=>decodeTransition(bytes({...value,reads:[...reads].reverse()}))).toThrow();
});

it('accepts search scratch alongside a financial instruction and preserves its event boundary', () => {
  const transaction=tx();
  const sealTag=Buffer.from(clearingIdl.instructions.find(ix=>ix.name==='seal_search')!.discriminator);
  transaction.transaction.message.instructions.unshift({...call(),data:encoded(sealTag),accounts:[1,2,4]});
  transaction.meta.innerInstructions[0].index=1;
  expect(decode(transaction).map(ix=>ix.outer)).toEqual([1]);
  transaction.transaction.message.instructions[0].accounts.push(5);
  expect(decode(transaction).map(ix=>ix.outer)).toEqual([1]);
  transaction.meta.innerInstructions.unshift({index:0,instructions:[event(financialPayload)]});
  expect(()=>decode(transaction)).toThrow(/Invalid event authority or foreign invocation frame/);
});

it('binds coverage bookkeeping to the selected binary during independent block replay', () => {
  const transaction = tx();
  const accounts = [1, 2];
  const data = encoded(createHash('sha256').update('global:record_coverage_row').digest().subarray(0, 8));
  transaction.transaction.message.instructions = [{...call(), accounts, data}];
  transaction.meta.innerInstructions = [];
  const replay = (artifactSet?: string) => decodeAccountInvocations('original', transaction, 0, {...binding, artifactSet});
  expect(() => replay()).toThrow(/Unknown clearing entrypoint/);
  expect(replay(SHADOW_COVERAGE_ARTIFACT_SET)).toEqual([]);
  accounts.push(3);
  expect(() => replay(SHADOW_COVERAGE_ARTIFACT_SET)).toThrow(/Invalid local coverage observation/);
});

it('uses the pinned account list for the read-only market backing check', () => {
  const transaction = tx();
  const discriminator = createHash('sha256').update('global:observe_coverage').digest().subarray(0,8);
  const accounts = Array<number>(12).fill(1);
  transaction.transaction.message.instructions = [{...call(),accounts,data:encoded(Buffer.concat([discriminator,Buffer.from([1])]))}];
  transaction.meta.innerInstructions = [];
  const replay = (artifactSet: string) => decodeAccountInvocations('original',transaction,0,{...binding,artifactSet});
  expect(replay(SHADOW_COVERAGE_ARTIFACT_SET)).toEqual([]);
  expect(() => replay(VERIFIED_COVERAGE_ARTIFACT_SET)).toThrow(/Invalid local coverage observation/);
  accounts.push(0,2);
  expect(replay(VERIFIED_COVERAGE_ARTIFACT_SET)).toEqual([]);
  expect(() => replay(SHADOW_COVERAGE_ARTIFACT_SET)).toThrow(/Invalid local coverage observation/);
});

it('admits a footerless default preview only on the pinned verifier with a complete wire envelope', () => {
  const transaction = tx();
  const view = clearingIdl.instructions.find(value => value.name === 'verify_indexed_default')!;
  const data = Buffer.concat([Buffer.from(view.discriminator), u64(1n), Buffer.from([1]), u32(0), u32(1), u32(3)]);
  const preview = transaction.transaction.message.instructions[0];
  preview.data = encoded(data);
  preview.accounts = Array(12).fill(2);
  transaction.meta.innerInstructions = [];
  const read = () => scopedInvocations('original', transaction, 3, {...binding, indexedDefault: true});
  expect(read()).toEqual([]);
  expect(() => decode(transaction)).toThrow(/Missing scoped footer/);
  preview.data = encoded(data.subarray(0, -1));
  expect(read).toThrow(/Invalid indexed default preview/);
  preview.data = encoded(data);
  transaction.meta.innerInstructions = [{index: 0, instructions: [event(financialPayload)]}];
  expect(read).toThrow(/foreign invocation/);
});
