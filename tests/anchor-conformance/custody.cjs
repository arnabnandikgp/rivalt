// Isolated legacy process. Inputs/outputs are canonical JSON, never legacy objects.
const fs = require('node:fs');
const anchor = require('@anchor-lang/core');
const { PublicKey, Connection } = require('@solana/web3.js');
const idl = JSON.parse(fs.readFileSync('packages/sdk/idl/clearing.json', 'utf8'));
const program = new anchor.Program(idl, { connection: new Connection('http://127.0.0.1:8899') });
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const jsonValue = (v) => JSON.parse(JSON.stringify(v, function (key, value) {
  const original = this[key];
  if (anchor.BN.isBN(original)) return original.toString(10);
  if (original instanceof PublicKey) return original.toBase58();
  return value;
}));
(async () => {
  const instructions = [];
  for (const v of input.instructions ?? []) {
    const args = v.args.map(a => a.kind === 'u64' ? new anchor.BN(a.value) : a.value);
    const accounts = Object.fromEntries(Object.entries(v.accounts).map(([k, v]) => [k, new PublicKey(v)]));
    const ix = await program.methods[v.name](...args).accountsStrict(accounts).instruction();
    instructions.push({ name: v.name, data: ix.data.toString('hex'),
      accounts: ix.keys.map(k => ({ address: k.pubkey.toBase58(), signer: k.isSigner, writable: k.isWritable })) });
  }
  const accounts = Object.fromEntries(Object.entries(input.accounts ?? {}).map(([name, data]) =>
    [name, jsonValue(program.coder.accounts.decode(name, Buffer.from(data, 'base64')))]));
  const events = (input.events ?? []).map(data => jsonValue(program.coder.events.decode(data)));
  process.stdout.write(JSON.stringify({ instructions, accounts, events }));
})().catch(e => { console.error(e); process.exitCode = 1; });
