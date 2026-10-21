// Independent legacy process: canonical JSON only crosses this boundary.
const fs = require('node:fs');
const anchor = require('@anchor-lang/core');
const { PublicKey, Connection } = require('@solana/web3.js');
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const programs = Object.fromEntries(['clearing', 'maker_a', 'maker_b'].map(name => [name,
  new anchor.Program(JSON.parse(fs.readFileSync(`packages/sdk/idl/${name}.json`, 'utf8')), { connection: new Connection('http://127.0.0.1:8899') })]));
function value(v) {
  if (v && typeof v === 'object') {
    if ('$integer' in v) return new anchor.BN(v.$integer);
    if ('$address' in v) return new PublicKey(v.$address);
    if ('$bytes' in v) return Buffer.from(v.$bytes);
    if (Array.isArray(v)) return v.map(value);
    return Object.fromEntries(Object.entries(v).map(([k,x]) => [k,value(x)]));
  }
  return v;
}
const canonical = v => JSON.parse(JSON.stringify(v, function(k,x) {
  const original = this[k];
  if (anchor.BN.isBN(original)) return original.toString(10);
  if (original instanceof PublicKey) return original.toBase58();
  if (original instanceof Uint8Array) return Array.from(original);
  return x;
}));
(async () => {
  const instructions=[];
  for (const x of input.instructions ?? []) {
    const ix=await programs[x.program].methods[x.name](...x.args.map(value))
      .accountsStrict(Object.fromEntries(Object.entries(x.accounts).map(([k,v])=>[k,new PublicKey(v)]))).instruction();
    instructions.push({data:ix.data.toString('hex'),accounts:ix.keys.map(k=>({address:k.pubkey.toBase58(),signer:k.isSigner,writable:k.isWritable}))});
  }
  const accounts=(input.accounts ?? []).map(x=>canonical(programs[x.program].coder.accounts.decode(x.name,Buffer.from(x.data,'base64'))));
  const returns=(input.returns ?? []).map(x=>canonical(programs[x.program].coder.types.decode('quoteResponse',Buffer.from(x.data,'base64'))));
  const events=(input.events ?? []).map(x=>canonical(programs.clearing.coder.events.decode(x)));
  process.stdout.write(JSON.stringify({instructions,accounts,returns,events}));
})().catch(e=>{console.error(e);process.exitCode=1;});
