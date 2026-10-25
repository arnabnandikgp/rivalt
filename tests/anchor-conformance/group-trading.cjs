// Isolated Anchor client: no modern workspace imports and no shared codecs.
const fs = require('node:fs');
const anchor = require('@anchor-lang/core');
const {PublicKey, Connection} = require('@solana/web3.js');
const input = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const programs = new Map();
const programFor = name => {
  if (!programs.has(name)) programs.set(name,new anchor.Program(
    JSON.parse(fs.readFileSync(`packages/sdk/idl/${name}.json`,'utf8')),
    {connection:new Connection('http://127.0.0.1:8899')}));
  return programs.get(name);
};
const plain = value => JSON.parse(JSON.stringify(value,function(key,item){
  const original=this[key];
  if(anchor.BN.isBN(original))return original.toString(10);
  if(original instanceof PublicKey)return original.toBase58();
  return item;
}));
const unpack = value => {
  if (Array.isArray(value)) return value.map(unpack);
  if (value && typeof value === 'object') {
    if ('$bn' in value) return new anchor.BN(value.$bn);
    if ('$pubkey' in value) return new PublicKey(value.$pubkey);
    return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,unpack(item)]));
  }
  return value;
};
(async()=>{
  const output = [];
  for (const entry of (Array.isArray(input)?input:input.instructions??[])) {
    const program=programFor(entry.program);
    const accounts=Object.fromEntries(Object.entries(entry.accounts).map(([key,value])=>[key,value===null?null:new PublicKey(value)]));
    const instruction=await program.methods[entry.name](...entry.args.map(unpack)).accountsStrict(accounts).instruction();
    output.push({data:instruction.data.toString('hex'),accounts:instruction.keys.map(key=>({address:key.pubkey.toBase58(),signer:key.isSigner,writable:key.isWritable}))});
  }
  const accounts=(Array.isArray(input)?[]:input.accounts??[]).map(entry=>plain(programFor(entry.program).coder.accounts.decode(entry.name,Buffer.from(entry.bytes,'base64'))));
  process.stdout.write(JSON.stringify(Array.isArray(input)?output:{instructions:output,accounts}));
})().catch(error=>{console.error(error);process.exitCode=1;});
