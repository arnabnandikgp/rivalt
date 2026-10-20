// This process alone loads legacy Anchor/web3.js. Only JSON crosses its boundary.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const anchor = require('@anchor-lang/core');
const { PublicKey, Connection } = require('@solana/web3.js');
const idl = JSON.parse(fs.readFileSync('packages/sdk/idl/clearing.json', 'utf8'));
const program = new anchor.Program(idl, { connection: new Connection('http://127.0.0.1:8899') });
const owner = new PublicKey('3XxVtJi6gjvRL2JBJye78uWMEopWHW7P1DdLRpkdRYAP');
const programId = new PublicKey(idl.address);
const eventAuthority = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], programId)[0];
const cases = [
  { nonce: '0', signedValue: '0', optionalValue: null, choice: { empty: {} } },
  { nonce: '9007199254740993', signedValue: '-170141183460469231731687303715884105728',
    optionalValue: '18446744073709551615', choice: { number: { value: '18446744073709551615' } } },
  { nonce: '18446744073709551615', signedValue: '170141183460469231731687303715884105727',
    optionalValue: '0', choice: { number: { value: '0' } } },
];
const decimal = (v) => v === null ? null : new anchor.BN(v);
const jsonValue = (v) => JSON.parse(JSON.stringify(v, function (key, value) {
  const original = this[key];
  if (anchor.BN.isBN(original)) return original.toString(10);
  if (original instanceof PublicKey) return original.toBase58();
  return value;
}));
(async () => {
  const output = [];
  for (const v of cases) {
    const nonceBytes = new anchor.BN(v.nonce).toArrayLike(Buffer, 'le', 8);
    const [record, bump] = PublicKey.findProgramAddressSync([Buffer.from('probe'), owner.toBuffer(), nonceBytes], programId);
    const choice = v.choice.number ? { number: { value: decimal(v.choice.number.value) } } : v.choice;
    const ix = await program.methods.probe(decimal(v.nonce), decimal(v.signedValue), decimal(v.optionalValue), choice)
      .accountsStrict({ owner, record, systemProgram: anchor.web3.SystemProgram.programId, eventAuthority, program: programId })
      .instruction();
    const account = { owner, nonce: decimal(v.nonce), signedValue: decimal(v.signedValue),
      optionalValue: decimal(v.optionalValue), choice, bump };
    const accountBytes = await program.coder.accounts.encode('probeRecord', account);
    assert.deepEqual(jsonValue(program.coder.accounts.decode('probeRecord', accountBytes)), jsonValue(account));
    output.push({ input: v, record: record.toBase58(), bump, data: ix.data.toString('hex'),
      accounts: ix.keys.map(k => ({ address: k.pubkey.toBase58(), signer: k.isSigner, writable: k.isWritable })),
      accountBytes: accountBytes.toString('hex'), account: jsonValue(account) });
  }
  if (process.argv[2]) {
    const live = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const account = program.coder.accounts.decode('probeRecord', Buffer.from(live.accountBase64, 'base64'));
    const event = program.coder.events.decode(live.eventBase64);
    assert(event);
    assert.equal(account.nonce.toString(), live.nonce);
    assert.equal(account.signedValue.toString(), live.signedValue);
    assert.equal(event.data.signedValue.toString(), live.signedValue);
    assert.equal(event.data.record.toBase58(), live.record);
  }
  process.stdout.write(JSON.stringify(output));
})().catch(e => { console.error(e); process.exitCode = 1; });
