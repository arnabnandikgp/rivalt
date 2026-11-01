// Isolated RC2/Kit process; only JSON and raw bytes cross the boundary.
import fs from 'node:fs';
import * as anchor from '@anchor-lang/core';
import { address, createSolanaRpc } from '@solana/kit';
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const camel = value => value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()).replace(/^[A-Z]/, letter => letter.toLowerCase());
const jsonValue = value => JSON.parse(JSON.stringify(value, function (key, item) {
  const original = this[key];
  if (typeof original === 'bigint') return original.toString(10);
  if (original instanceof Uint8Array) return Array.from(original);
  return item;
}));
(async () => {
  const output = {};
  for (const [name, vectors] of Object.entries(input)) {
    const idl = JSON.parse(fs.readFileSync(`packages/sdk/idl/${name}.json`, 'utf8'));
    const program = new anchor.Program(idl, { rpc: createSolanaRpc('http://127.0.0.1:8899') });
    function convert(type, value) {
      if (type === 'pubkey') return address(value);
      if (type === 'bytes') return Buffer.from(value);
      if (['u64','i64','u128','i128'].includes(type)) return BigInt(value);
      if (typeof type === 'string') return value;
      if (type.array) return value.map(item => convert(type.array[0], item));
      if (type.vec) return value.map(item => convert(type.vec, item));
      if (type.option) return value === null ? null : convert(type.option, value);
      const definition = idl.types.find(item => item.name === type.defined.name).type;
      if (definition.kind === 'struct') return Object.fromEntries(definition.fields.map(field =>
        [camel(field.name), convert(field.type, value[camel(field.name)])]));
      if (definition.kind === 'enum') {
        const variant = definition.variants.find(item => item.name === value.__kind);
        if (!variant) throw new Error(`Unknown enum ${value.__kind}`);
        const fields = variant.fields ?? [];
        return { [camel(variant.name)]: fields.length === 0 ? {} : fields[0].name
          ? Object.fromEntries(fields.map(field => [camel(field.name), convert(field.type, value[camel(field.name)])]))
          : fields.map((field, index) => convert(field, value.fields[index])) };
      }
      throw new Error(`Unsupported type ${JSON.stringify(type)}`);
    }
    const instructions = [];
    for (const vector of vectors.instructions) {
      const definition = idl.instructions.find(item => camel(item.name) === vector.name);
      const args = definition.args.map(arg => convert(arg.type, vector.args[camel(arg.name)]));
      const accountTree = value => value === null ? null : typeof value === 'string' ? address(value)
        : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, accountTree(child)]));
      const accounts = accountTree(vector.accounts);
      const remaining = (vector.remainingAccounts ?? []).map(meta => ({ address: address(meta.address), role: (meta.signer ? 2 : 0) | (meta.writable ? 1 : 0) }));
      const instruction = await program.methods[vector.name](...args).accountsStrict(accounts).remainingAccounts(remaining).instruction();
      instructions.push({ name: vector.name, data: Buffer.from(instruction.data).toString('hex'),
        accounts: instruction.accounts.map(key => ({ address: key.address, signer: (key.role & 2) !== 0, writable: (key.role & 1) !== 0 })) });
    }
    const accounts = vectors.accounts.map(vector => ({ name: vector.name,
      value: jsonValue(program.coder.accounts.decode(vector.name, Buffer.from(vector.data, 'base64'))) }));
    const events = vectors.events.map(data => jsonValue(program.coder.events.decode(data)));
    output[name] = { instructions, accounts, events };
  }
  process.stdout.write(JSON.stringify(output));
})().catch(error => { console.error(error); process.exitCode = 1; });
