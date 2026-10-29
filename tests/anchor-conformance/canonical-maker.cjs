// Isolated Anchor/legacy-web3 process; only JSON and raw bytes cross the boundary.
const fs = require('node:fs');
const anchor = require('@anchor-lang/core');
const { PublicKey, Connection } = require('@solana/web3.js');
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const camel = value => value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()).replace(/^[A-Z]/, letter => letter.toLowerCase());
const jsonValue = value => JSON.parse(JSON.stringify(value, function (key, item) {
  const original = this[key];
  if (anchor.BN.isBN(original)) return original.toString(10);
  if (original instanceof PublicKey) return original.toBase58();
  return item;
}));
(async () => {
  const output = {};
  for (const [name, vectors] of Object.entries(input)) {
    const idl = JSON.parse(fs.readFileSync(`packages/sdk/idl/${name}.json`, 'utf8'));
    const program = new anchor.Program(idl, { connection: new Connection('http://127.0.0.1:8899') });
    function convert(type, value) {
      if (type === 'pubkey') return new PublicKey(value);
      if (['u64','i64','u128','i128'].includes(type)) return new anchor.BN(value);
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
      const accountTree = value => value === null ? null : typeof value === 'string' ? new PublicKey(value)
        : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, accountTree(child)]));
      const accounts = accountTree(vector.accounts);
      const instruction = await program.methods[vector.name](...args).accountsStrict(accounts).instruction();
      instructions.push({ name: vector.name, data: instruction.data.toString('hex'),
        accounts: instruction.keys.map(key => ({ address: key.pubkey.toBase58(), signer: key.isSigner, writable: key.isWritable })) });
    }
    const accounts = vectors.accounts.map(vector => ({ name: vector.name,
      value: jsonValue(program.coder.accounts.decode(vector.name, Buffer.from(vector.data, 'base64'))) }));
    const events = vectors.events.map(data => jsonValue(program.coder.events.decode(data)));
    output[name] = { instructions, accounts, events };
  }
  process.stdout.write(JSON.stringify(output));
})().catch(error => { console.error(error); process.exitCode = 1; });
