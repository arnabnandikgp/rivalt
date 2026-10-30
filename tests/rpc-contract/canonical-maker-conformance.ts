import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getBase58Encoder, type Address, type Instruction } from '@solana/kit';
import * as sdk from '@rivalt/sdk';
const camel = (value: string) => value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()).replace(/^[A-Z]/, letter => letter.toLowerCase());
const upper = (value: string) => value[0].toUpperCase()+value.slice(1);
export function canonicalValue(value: any): any {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return [...value];
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value?.__option === 'None') return null;
  if (value?.__option === 'Some') return canonicalValue(value.value);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'discriminator')
    .map(([key, item]) => [key, canonicalValue(item)]));
  return value;
}
export class CanonicalConformance {
  readonly modules = [
    { name: 'clearing', address: sdk.CLEARING_PROGRAM_ADDRESS, sdk },
    { name: 'maker_a', address: sdk.makerA.MAKER_A_PROGRAM_ADDRESS, sdk: sdk.makerA },
    { name: 'maker_b', address: sdk.makerB.MAKER_B_PROGRAM_ADDRESS, sdk: sdk.makerB },
  ].map(module => ({ ...module, idl: JSON.parse(readFileSync(`packages/sdk/idl/${module.name}.json`, 'utf8')),
    instructions: [] as any[], accounts: [] as any[], events: [] as string[], expectedEvents: [] as any[], expectedAccounts: [] as any[] }));
  record(instructions: Instruction[], history?: any) {
    for (const module of this.modules) {
      for (const instruction of instructions.filter(item => item.programAddress === module.address)) {
        const definition = module.idl.instructions.find((item: any) =>
          Buffer.from(item.discriminator).equals(Buffer.from(instruction.data!).subarray(0,8)));
        if (!definition) continue;
        const name = camel(definition.name), implementation = module.sdk as any;
        const decoded = canonicalValue(implementation[`get${upper(name)}InstructionDataDecoder`]().decode(instruction.data));
        // Codama flattens an Anchor instruction's single `args` struct. Rebuild
        // that argument for the independently isolated Anchor encoder.
        const args = definition.args.length === 1 && definition.args[0].name === 'args'
          ? { args: decoded } : decoded;
        let offset = 0;
        const accountTree = (definitions: any[]): any => Object.fromEntries(definitions.map(account => {
          if (account.accounts) return [camel(account.name), accountTree(account.accounts)];
          const key = instruction.accounts![offset++].address;
          return [camel(account.name), account.optional && key === module.address ? null : key];
        }));
        const accounts = accountTree(definition.accounts);
        assert.equal(offset, instruction.accounts!.length, `${name}: complete nested account mapping`);
        module.instructions.push({ name, args, accounts, expected: { name, data: Buffer.from(instruction.data!).toString('hex'),
          accounts: instruction.accounts!.map(account => ({ address: account.address, signer: (account.role & 2) !== 0, writable: (account.role & 1) !== 0 })) } });
      }
      if (!history || history.meta.err) continue; // Reverted event bytes are not committed state.
      for (const instruction of (history.meta.innerInstructions ?? []).flatMap((group: any) => group.instructions)) {
        if (history.transaction.message.accountKeys[instruction.programIdIndex] !== module.address) continue;
        const bytes = Buffer.from(getBase58Encoder().encode(instruction.data)).subarray(8);
        const definition = module.idl.events?.find((item: any) => Buffer.from(item.discriminator).equals(bytes.subarray(0,8)));
        if (!definition) continue;
        module.events.push(bytes.toString('base64'));
        module.expectedEvents.push(canonicalValue((module.sdk as any)[`get${definition.name}EventDecoder`]().decode(bytes)));
      }
    }
  }
  async finish(runDir: string, keys: { program: Address; name: string; key: Address }[], read: (key: Address) => Promise<Buffer | null>) {
    assert(this.modules.some(module => module.instructions.length > 0), 'No instructions captured for Anchor conformance');
    for (const key of keys) {
      const module = this.modules.find(item => item.address === key.program)!;
      const bytes = (await read(key.key))!;
      module.accounts.push({ name: key.name, data: bytes.toString('base64') });
      module.expectedAccounts.push(canonicalValue((module.sdk as any)[`get${upper(key.name)}Decoder`]().decode(bytes)));
    }
    const input = Object.fromEntries(this.modules.map(module => [module.name, { instructions: module.instructions, accounts: module.accounts, events: module.events }]));
    const path = `${runDir}/legacy-input.json`;
    writeFileSync(path, JSON.stringify(input, null, 2)+'\n');
    const legacy = JSON.parse(execFileSync(process.execPath, ['tests/anchor-conformance/canonical-maker.cjs', path], { encoding: 'utf8', maxBuffer: 8*1024*1024 }));
    for (const module of this.modules) {
      assert.deepEqual(legacy[module.name].instructions, module.instructions.map(item => item.expected), `${module.name}: instruction data/account flags`);
      assert.deepEqual(legacy[module.name].accounts.map((item: any) => item.value), module.expectedAccounts, `${module.name}: account fields`);
      assert.deepEqual(legacy[module.name].events.map((item: any) => item.data), module.expectedEvents, `${module.name}: event fields`);
    }
    return this.modules.map(module => ({ program: module.name, instructions: module.instructions.length,
      instructionNames: [...new Set(module.instructions.map(item => item.name))], accounts: module.accounts.length, events: module.events.length }));
  }
}
