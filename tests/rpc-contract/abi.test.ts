import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getProgramDerivedAddress, isSome } from '@solana/kit';
import { Keypair } from '@solana/web3.js';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter';
import {
  CLEARING_PROGRAM_ADDRESS, findRecordPda, getProbeInstructionAsync,
  getProbeInstructionDataDecoder, getProbeInstructionDataEncoder, getProbeRecordDecoder,
  getProbeRecordedEventEncoder, parseProbeRecordedEvent,
} from '@rivalt/sdk';

const legacy = JSON.parse(execFileSync(process.execPath, ['tests/anchor-conformance/conformance.cjs'], { encoding: 'utf8' }));
const payer = await Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync('.local/keys/payer.json', 'utf8'))));
const [eventAuthority] = await getProgramDerivedAddress({
  programAddress: CLEARING_PROGRAM_ADDRESS, seeds: [new TextEncoder().encode('__event_authority')],
});
const hex = (bytes: ArrayLike<number>) => Buffer.from(bytes).toString('hex');

describe('generated SDK versus isolated Anchor 1.2.1 / web3.js 1.99.0', () => {
  it('loads the pinned modern wallet providers', () => {
    expect(typeof ConnectionProvider).toBe('function');
    expect(typeof WalletProvider).toBe('function');
  });
  for (const vector of legacy) {
    it(`matches instruction, PDA, flags, and account at nonce ${vector.input.nonce}`, async () => {
      const input = {
        nonce: BigInt(vector.input.nonce), signedValue: BigInt(vector.input.signedValue),
        optionalValue: vector.input.optionalValue === null ? null : BigInt(vector.input.optionalValue),
        choice: vector.input.choice.number
          ? { __kind: 'Number' as const, value: BigInt(vector.input.choice.number.value) }
          : { __kind: 'Empty' as const },
      };
      const ix = await getProbeInstructionAsync({ owner: payer, eventAuthority, program: CLEARING_PROGRAM_ADDRESS, ...input });
      expect(hex(ix.data)).toBe(vector.data);
      expect(ix.accounts.map(a => ({ address: a.address, signer: (a.role & 2) !== 0, writable: (a.role & 1) !== 0 }))).toEqual(vector.accounts);
      expect(await findRecordPda({ owner: payer.address, nonce: input.nonce })).toEqual([vector.record, vector.bump]);
      const decoded = getProbeInstructionDataDecoder().decode(ix.data);
      expect(decoded.nonce).toBe(input.nonce);
      expect(decoded.signedValue).toBe(input.signedValue);
      expect(isSome(decoded.optionalValue) ? decoded.optionalValue.value : null).toBe(input.optionalValue);
      expect(decoded.choice).toEqual(input.choice);
      const account = getProbeRecordDecoder().decode(Buffer.from(vector.accountBytes, 'hex'));
      expect(account.owner).toBe(payer.address);
      expect(account.nonce).toBe(input.nonce);
      expect(account.signedValue).toBe(input.signedValue);
      expect(account.choice).toEqual(input.choice);
      expect(isSome(account.optionalValue) ? account.optionalValue.value : null).toBe(input.optionalValue);
      expect(account.bump).toBe(vector.bump);
    });
  }

  it('matches independently constructed discriminator and little-endian signed bytes', () => {
    const encoded = getProbeInstructionDataEncoder().encode({
      nonce: 0x0102030405060708n, signedValue: -2n, optionalValue: null, choice: { __kind: 'Empty' },
    });
    const discriminator = createHash('sha256').update('global:probe').digest().subarray(0, 8).toString('hex');
    expect(hex(encoded)).toBe(discriminator + '0807060504030201' + 'fe' + 'ff'.repeat(15) + '00' + '00');
  });

  it('rejects values outside u64 and i128 instead of wrapping', () => {
    const base = { nonce: 0n, signedValue: 0n, optionalValue: null, choice: { __kind: 'Empty' as const } };
    for (const nonce of [-1n, 1n << 64n]) {
      expect(() => getProbeInstructionDataEncoder().encode({ ...base, nonce })).toThrow();
    }
    for (const signedValue of [-(1n << 127n) - 1n, 1n << 127n]) {
      expect(() => getProbeInstructionDataEncoder().encode({ ...base, signedValue })).toThrow();
    }
  });

  it('checks event identity before decoding', () => {
    const encoded = getProbeRecordedEventEncoder().encode({
      schemaVersion: 1, owner: payer.address, record: payer.address, nonce: 0n,
      signedValue: -1n, optionalValue: null, choice: { __kind: 'Empty' },
    });
    expect(parseProbeRecordedEvent(encoded).signedValue).toBe(-1n);
    const corrupt = Uint8Array.from(encoded);
    corrupt[0] ^= 1;
    expect(() => parseProbeRecordedEvent(corrupt)).toThrow();
  });
});
