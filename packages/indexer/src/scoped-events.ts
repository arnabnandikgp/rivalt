/** Schema-5 transport authentication. This is not yet connected to the live
 * journal. RPC must supply compiled instructions, loaded keys and stack heights;
 * log text and address-history pagination cannot establish invocation ancestry. */
import {createHash} from 'node:crypto';
import {address, getAddressDecoder, getBase58Encoder} from '@solana/kit';
import clearingIdl from '../../sdk/idl/clearing.json' with {type: 'json'};
import {integer} from './rpc.js';
import type {ScopedEnvelope, ScopedRead, ScopedWrite} from './scoped-history.js';

const eventTag = Buffer.from('e445a52e51cb9a1d', 'hex');
const transitionTag = createHash('sha256').update('event:AccountTransition').digest().subarray(0, 8);
const instructions = new Set(clearingIdl.instructions.map(instruction => Buffer.from(instruction.discriminator).toString('hex')));
const payloadTags = new Set(clearingIdl.events.filter(event => event.name !== 'AccountTransition')
  .map(event => createHash('sha256').update(`event:${event.name}`).digest().subarray(0, 8).toString('hex')));
const addressDecoder = getAddressDecoder();
const base58 = getBase58Encoder();

type Instruction = {program: string; accounts: string[]; bytes: Buffer};
type Frame = {instruction: Instruction; depth: number; financial: Invocation | null; event: boolean};
type Payload = {inner: number; bytes: string};
type Invocation = {outer: number; invocation: number; instruction: Instruction; payloads: Payload[];
  footer: {inner: number; bytes: Buffer} | null};
export type ScopedInvocation = ScopedEnvelope & {instruction: string; venue: string; domain: string;
  payloads: Payload[]; footerInner: number; footerBytes: string};

/** Independent strict Borsh envelope reader, checked against generated codecs
 * during successor integration. Every read is bounded before slicing. */
export function decodeTransition(bytes: Buffer) {
  if (bytes.length < 100 || bytes.length > 1668 || !bytes.subarray(0, 8).equals(transitionTag))
    throw new Error('Invalid scoped envelope size/discriminator');
  let offset = 8;
  const take = (count: number) => {
    if (offset + count > bytes.length) throw new Error('Truncated scoped envelope');
    const value = bytes.subarray(offset, offset + count); offset += count; return value;
  };
  const u16 = () => take(2).readUInt16LE();
  const u32 = () => take(4).readUInt32LE();
  const u64 = () => take(8).readBigUInt64LE();
  const key = () => addressDecoder.decode(take(32));
  if (u16() !== 5) throw new Error('Unsupported scoped envelope schema');
  const venue = key(), domain = take(32).toString('hex'), slot = u64(), instruction = take(8).toString('hex');
  const payloadCount = u16();
  if (payloadCount > 4) throw new Error('Scoped payload count exceeds bound');
  const reads: ScopedRead[] = [], writes: ScopedWrite[] = [], entities = new Set<string>();
  const entity = () => {
    const account = key(), kind = take(1)[0];
    if (kind > 16 || entities.has(account)) throw new Error('Duplicate or invalid scoped entity');
    entities.add(account); return {account, kind};
  };
  const readCount = u32();
  if (readCount > 31) throw new Error('Scoped entity count');
  for (let index = 0; index < readCount; index++) {
    const identity = entity(), revision = u64();
    if (revision === 0n) throw new Error('Uninitialized scoped read');
    reads.push({...identity, revision: revision.toString()});
  }
  const writeCount = u32();
  if (writeCount < 1 || writeCount + readCount > 32) throw new Error('Scoped entity count');
  for (let index = 0; index < writeCount; index++) {
    const identity = entity(), before = u64(), after = u64();
    if (after !== before + 1n) throw new Error('Nonconsecutive scoped mutation');
    writes.push({...identity, before: before.toString(), after: after.toString()});
  }
  if (offset !== bytes.length) throw new Error('Trailing scoped envelope bytes');
  if (![...reads, ...writes].some(entity => entity.account === venue && entity.kind === 0))
    throw new Error('Scoped venue dependency missing');
  return {venue, domain, slot, instruction, payloadCount, reads, writes};
}

function compiledMessage(transaction: any) {
  const message = transaction.transaction?.message, meta = transaction.meta;
  if (!message || !Array.isArray(message.accountKeys) || !Array.isArray(message.instructions))
    throw new Error('Missing compiled message');
  const header = message.header;
  if (!header) throw new Error('Missing message privileges');
  const required = integer(header.numRequiredSignatures), readonlySigned = integer(header.numReadonlySignedAccounts),
    readonlyUnsigned = integer(header.numReadonlyUnsignedAccounts);
  const staticKeys: string[] = message.accountKeys.map((value: unknown) => {
    if (typeof value !== 'string') throw new Error('Parsed keys cannot replace compiled keys');
    return address(value);
  });
  if (required < 1 || required > staticKeys.length || readonlySigned >= required || readonlyUnsigned > staticKeys.length - required)
    throw new Error('Invalid message privileges');
  if (!Array.isArray(transaction.transaction.signatures) || transaction.transaction.signatures.length !== required)
    throw new Error('Invalid transaction signature count');
  const lookups = message.addressTableLookups ?? [];
  if (!Array.isArray(lookups)) throw new Error('Invalid lookup metadata');
  let expectedWritable = 0, expectedReadonly = 0;
  for (const lookup of lookups) {
    address(lookup.accountKey);
    for (const field of ['writableIndexes', 'readonlyIndexes'] as const) {
      if (!Array.isArray(lookup[field]) || lookup[field].some((value: unknown) => integer(value) > 255))
        throw new Error('Invalid lookup indexes');
    }
    expectedWritable += lookup.writableIndexes.length; expectedReadonly += lookup.readonlyIndexes.length;
  }
  const loaded = meta.loadedAddresses ?? {writable: [], readonly: []};
  if (!Array.isArray(loaded.writable) || !Array.isArray(loaded.readonly)
      || loaded.writable.length !== expectedWritable || loaded.readonly.length !== expectedReadonly)
    throw new Error('Missing or inconsistent loaded addresses');
  const loadedWritable: string[] = loaded.writable.map((value: string) => address(value));
  const loadedReadonly: string[] = loaded.readonly.map((value: string) => address(value));
  const keys = [...staticKeys, ...loadedWritable, ...loadedReadonly];
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate compiled account key');
  const writable = new Set([...staticKeys.filter((_, index) => index < required
    ? index < required - readonlySigned : index < staticKeys.length - readonlyUnsigned), ...loadedWritable]);
  const instruction = (value: any): Instruction => {
    const program = keys[integer(value.programIdIndex)];
    if (!program || !Array.isArray(value.accounts) || typeof value.data !== 'string') throw new Error('Invalid compiled instruction');
    const accounts = value.accounts.map((index: unknown) => {
      const account = keys[integer(index)]; if (!account) throw new Error('Invalid instruction account index'); return account;
    });
    return {program, accounts, bytes: Buffer.from(base58.encode(value.data))};
  };
  return {message, writable, instruction};
}

/** Authenticate complete successful financial invocations, including clearing
 * called through an external wrapper and multiple clearing calls in one message.
 * Invalid input returns no partial result. Failed transactions have no effects. */
export function scopedInvocations(signature: string, transaction: any, transactionIndex: number,
  binding: {program: string; eventAuthority: string; venue: string; domain: string}): ScopedInvocation[] {
  if (!transaction?.meta || transaction.transaction?.signatures?.[0] !== signature)
    throw new Error('Missing transaction metadata/identity');
  integer(transaction.slot); integer(transactionIndex);
  if (!Object.hasOwn(transaction.meta, 'err') || transaction.meta.err === undefined) throw new Error('Incomplete transaction metadata');
  if (transaction.meta.err !== null) return [];
  if (!/^[0-9a-f]{64}$/.test(binding.domain)) throw new Error('Invalid scoped deployment domain');
  for (const key of [binding.program, binding.eventAuthority, binding.venue]) address(key);
  const {message, writable, instruction} = compiledMessage(transaction);
  if (!Array.isArray(transaction.meta.innerInstructions)) throw new Error('Missing inner instructions');
  const groups = new Map<number, any[]>();
  for (const group of transaction.meta.innerInstructions) {
    const index = integer(group.index);
    if (index >= message.instructions.length || groups.has(index) || !Array.isArray(group.instructions))
      throw new Error('Invalid or duplicate inner instruction group');
    groups.set(index, group.instructions);
  }
  const invocations: Invocation[] = [];
  for (const [outer, value] of message.instructions.entries()) {
    let invocationIndex = 0;
    const start = (current: Instruction): Invocation | null => {
      if (current.program !== binding.program) return null;
      if (!instructions.has(current.bytes.subarray(0, 8).toString('hex'))) throw new Error('Unknown clearing entrypoint');
      const invocation = {outer, invocation: invocationIndex++, instruction: current, payloads: [], footer: null};
      invocations.push(invocation); return invocation;
    };
    const top = instruction(value);
    const stack: Frame[] = [{instruction: top, depth: 1, financial: start(top), event: false}];
    for (const [inner, value] of (groups.get(outer) ?? []).entries()) {
      const depth = integer(value.stackHeight);
      if (depth < 2 || depth > stack.length + 1) throw new Error('Missing or inconsistent invocation ancestry');
      while (stack.length >= depth) stack.pop();
      const parent = stack.at(-1)!;
      if (parent.event) throw new Error('Event CPI cannot contain a child invocation');
      const current = instruction(value), isEvent = current.program === binding.program && current.bytes.subarray(0, 8).equals(eventTag);
      let financial: Invocation | null = null;
      if (isEvent) {
        if (parent.instruction.program !== binding.program || !parent.financial
            || current.accounts.length !== 1 || current.accounts[0] !== binding.eventAuthority)
          throw new Error('Invalid event authority or foreign invocation frame');
        const invocation = parent.financial, payload = current.bytes.subarray(8);
        if (invocation.footer) throw new Error('Duplicate or trailing event after scoped footer');
        if (payload.subarray(0, 8).equals(transitionTag)) invocation.footer = {inner, bytes: payload};
        else {
          if (payload.length > 8184 || !payloadTags.has(payload.subarray(0, 8).toString('hex')))
            throw new Error('Unknown or oversized critical scoped payload');
          if (invocation.payloads.length >= 4) throw new Error('Scoped payload count exceeds bound');
          invocation.payloads.push({inner, bytes: payload.toString('base64')});
        }
      } else {
        if (parent.financial?.footer) throw new Error('Invocation continues after final scoped footer');
        if (current.program === binding.program && stack.some(frame => frame.financial))
          throw new Error('Recursive financial invocation is unsupported');
        financial = start(current);
      }
      stack.push({instruction: current, depth, financial, event: isEvent});
    }
  }
  const result: ScopedInvocation[] = [];
  for (const invocation of invocations) {
    if (!invocation.footer) throw new Error('Missing scoped footer');
    const footer = decodeTransition(invocation.footer.bytes);
    if (footer.instruction !== invocation.instruction.bytes.subarray(0, 8).toString('hex')
        || footer.slot !== BigInt(transaction.slot) || footer.payloadCount !== invocation.payloads.length)
      throw new Error('Scoped footer instruction/slot/payload mismatch');
    if ([...footer.reads, ...footer.writes].some(entity => !invocation.instruction.accounts.includes(entity.account))
        || footer.writes.some(entity => !writable.has(entity.account)))
      throw new Error('Scoped entity is outside invocation privileges');
    if (footer.venue !== binding.venue) continue;
    if (footer.domain !== binding.domain) throw new Error('Scoped deployment domain mismatch');
    result.push({signature, slot: footer.slot, transactionIndex, outer: invocation.outer,
      invocation: invocation.invocation, instruction: footer.instruction, venue: footer.venue, domain: footer.domain,
      reads: footer.reads, writes: footer.writes, payloads: invocation.payloads,
      footerInner: invocation.footer.inner, footerBytes: invocation.footer.bytes.toString('base64')});
  }
  return result;
}
