// Synthetic frozen-book fixture and finalized receipt replay. Clearing is never invoked.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {AccountRole, address, getAddressEncoder, getBase58Encoder, getProgramDerivedAddress, type Instruction} from '@solana/kit';
import {Keypair} from '@solana/web3.js';
import {payerKey} from './harness.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';

const program = address('sDPXvpEPwCzVKHdpxntiM1khVvtCj2V6ozCr5euajBi');
const root = process.env.RIVALT_RUN_DIR!;
const phase = process.argv[2];
if (phase === 'write-fixture-key') {
  const key = await Keypair.fromSeed(createHash('sha256').update('rivalt/default-proof-probe/local-only').digest());
  assert.equal(key.address, program);
  writeFileSync(root + '/fixture.json', JSON.stringify(Array.from(key.secretKey)), {mode:0o600, flag:'wx'});
  process.exit(0);
}
assert(phase === 'start' || phase === 'resume');
const directory = root + '/' + phase;
mkdirSync(directory);
const {h, rpc, ws, checks} = await openCanonicalRpcHarness(
  process.env.RIVALT_RPC_URL!, process.env.RIVALT_WS_URL!, directory, {instructionConformance: () => false});
const databaseUrl = new URL(process.env.RIVALT_DATABASE_URL!);
assert.equal(databaseUrl.hostname, '127.0.0.1');
const pg = createRequire(new URL('../../packages/indexer/package.json', import.meta.url))('pg');
const sql = new pg.Client({connectionString:databaseUrl.href});
const payer = await payerKey();
const venue = Buffer.from(getAddressEncoder().encode(payer.address));
const discriminator = (name:string) => createHash('sha256').update(name).digest().subarray(0,8);
const gains = [5, 5, 5, 5, 6, 8];
const json = (value:unknown) => JSON.stringify(value, null, 2)+'\n';

async function book(episode:number) {
  const input = Buffer.alloc(24);
  input.writeBigUInt64LE(BigInt(episode));
  input.writeUInt16LE(17,8);
  input.writeUInt16LE(10,10);
  gains.forEach((amount,i) => input.writeUInt16LE(amount,12+2*i));
  const [proof, bump] = await getProgramDerivedAddress({programAddress:program, seeds:[
    Buffer.from('default-proof'), venue, input.subarray(0,8)]});
  function instruction(name:string, data:Uint8Array = Buffer.alloc(0)): Instruction {
    const writable = {address:proof, role:AccountRole.WRITABLE};
    const accounts = name === 'prepare' ? [{address:payer.address, role:AccountRole.WRITABLE_SIGNER},writable,
      {address:address('11111111111111111111111111111111'),role:AccountRole.READONLY}] : [writable];
    return {programAddress:program, accounts, data:Buffer.concat([discriminator('global:'+name),data])};
  }
  async function read() {
    const account = (await rpc.call('getAccountInfo',[proof,{commitment:'finalized',encoding:'base64'}])).value;
    assert.equal(account.owner,program);
    const raw = Buffer.from(account.data[0],'base64');
    assert.equal(raw.length,107);
    assert.deepEqual(raw.subarray(0,8),discriminator('account:Proof'));
    assert.deepEqual(raw.subarray(8,40),venue);
    assert.deepEqual(raw.subarray(40,64),input);
    assert.equal(raw[73],bump);
    return {cursor:raw[71], sealed:raw[72] === 1, charges:gains.map((_,i)=>raw.readUInt16LE(74+i*2)),
      mask:raw[86], recovered:raw.readUInt32LE(87),
      cost:(raw.readBigUInt64LE(91) + (raw.readBigUInt64LE(99)<<64n)).toString()};
  }
  async function reject(label:string, ix:Instruction, code:number) {
    const before = await h.read(proof);
    await h.send(label,[ix],[],code);
    assert.deepEqual(await h.read(proof),before);
  }
  async function verify() {
    const {cursor,sealed,...actual} = await read();
    assert.deepEqual([cursor,sealed],[10,true]);
    const {flat,...expected} = JSON.parse(execFileSync('python3',
      ['tests/financial/test_metered_default_proof.py','rpc-expected',venue.toString('hex'),String(episode),
       '17','10',...gains.map(String)], {encoding:'utf8'}));
    assert.deepEqual(actual,expected);
    assert.deepEqual(flat,[7,19]);
    return {episode,proof,...actual,flat};
  }
  return {proof, input, read, verify, reject, prepare:instruction('prepare',input), seal:instruction('seal'),
    advance:(cursor:number,count:number)=>instruction('advance',Buffer.from([cursor,count]))};
}

// Derive the SQL record only from finalized program instructions and observed outcomes.
async function replay(proof:string) {
  const signatures = await rpc.call('getSignaturesForAddress',[proof,{commitment:'finalized',limit:100}]);
  assert(signatures.length > 0 && signatures.length < 100);
  let inserted = 0;
  for (const item of signatures.reverse()) {
    const receipt = await rpc.call('getTransaction',[item.signature,
      {commitment:'finalized',encoding:'json',maxSupportedTransactionVersion:1}]);
    assert.equal(receipt.transaction.signatures[0],item.signature);
    const message = receipt.transaction.message;
    const matching = message.instructions.filter((ix:{programIdIndex:number})=>message.accountKeys[ix.programIdIndex] === program);
    assert.equal(matching.length,1);
    const ix = matching[0];
    assert(ix.accounts.some((index:number)=>message.accountKeys[index] === proof));
    const bytes = Buffer.from(getBase58Encoder().encode(ix.data));
    const kind = ['prepare','advance','seal'].find(name=>bytes.subarray(0,8).equals(discriminator('global:'+name)));
    assert(kind);
    const values = [item.signature, proof, kind, bytes.toString('hex'), receipt.meta.err === null, receipt.meta.computeUnitsConsumed];
    const added = await sql.query('INSERT INTO proof_receipts VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',values);
    inserted += added.rowCount;
    const observation = await sql.query('SELECT signature,proof,kind,wire,success,cu FROM proof_receipts WHERE signature=$1',[item.signature]);
    assert.deepEqual(Object.values(observation.rows[0]),values);
  }
  return {inserted,count:signatures.length};
}

try {
  await sql.connect();
  const staged = await book(41);
  if (phase === 'start') {
    await sql.query('CREATE TABLE proof_receipts(signature text PRIMARY KEY, proof text, kind text, wire text, success boolean, cu integer)');
    await h.send('prepare staged',[staged.prepare]);
    await staged.reject('reject early seal',staged.seal,6003);
    assert.deepEqual(await replay(staged.proof),{inserted:2,count:2});
    await h.send('verify three partitions',[staged.advance(0,3)]);
    assert.equal((await staged.read()).cursor,3);
    // End this worker after finality and before journaling the last receipt.
  } else {
    const started = performance.now();
    assert.equal((await sql.query('SELECT count(*)::int AS count FROM proof_receipts')).rows[0].count,2);
    assert.deepEqual(await replay(staged.proof),{inserted:1,count:3});
    const state = await staged.read();
    assert.deepEqual([state.cursor,state.sealed],[3,false]);
    const recoveryMs = performance.now()-started;
    await staged.reject('reject stale cursor',staged.advance(0,1),6001);
    await staged.reject('reject oversized batch',staged.advance(3,8),6002);
    await h.send('verify one partition',[staged.advance(state.cursor,1)]);
    await h.send('verify remaining six',[staged.advance(4,6)]);
    await h.send('seal staged winner',[staged.seal]);
    await staged.reject('reject sealed replay',staged.seal,6003);
    const stagedPlan = await staged.verify();
    const single = await book(42);
    await h.send('prepare single batch',[single.prepare]);
    await h.send('verify ten partitions',[single.advance(0,10)]);
    await h.send('seal single batch',[single.seal]);
    const singlePlan = await single.verify();
    const stagedHistory = await replay(staged.proof);
    const singleHistory = await replay(single.proof);
    assert.deepEqual(stagedHistory,{inserted:6,count:9});
    assert.deepEqual(singleHistory,{inserted:3,count:3});
    assert.equal((await replay(staged.proof)).inserted,0);
    assert.equal((await replay(single.proof)).inserted,0);
    writeFileSync(root+'/recovery.json',json({recoveryMs,stagedPlan,singlePlan,stagedHistory,singleHistory}));
  }
  writeFileSync(directory+'/checks.json',json(checks));
} finally {
  ws.close();
  await sql.end();
}
