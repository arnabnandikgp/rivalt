// Signed D127 comparison on a synthetic committed book. This fixture cannot move collateral.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {AccountRole, address, getAddressEncoder, getBase58Encoder, getProgramDerivedAddress, type Instruction} from '@solana/kit';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {payerKey} from './harness.js';

const root = process.env.RIVALT_RUN_DIR!;
const {h, rpc, ws, checks} = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!, process.env.RIVALT_WS_URL!,
  root, {instructionConformance: () => false});
const database = new URL(process.env.RIVALT_DATABASE_URL!);
assert.equal(database.hostname, '127.0.0.1');
const pg = createRequire(new URL('../../packages/indexer/package.json', import.meta.url))('pg');
const sql = new pg.Client({connectionString: database.href});
const program = address('sDPXvpEPwCzVKHdpxntiM1khVvtCj2V6ozCr5euajBi');
const payer = await payerKey();
const venue = Buffer.from(getAddressEncoder().encode(payer.address));
const hash = (data: Uint8Array | string) => createHash('sha256').update(data).digest();
const discriminator = (name: string) => hash(name).subarray(0, 8);
const u64 = (value: number) => {const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b;};
const reflection = [1, 0, 3, 2, 5, 4, 7, 6];

function expectedOrdinal(episode: number) {
  const key = (member: number) => hash(Buffer.concat([Buffer.from('Rivalt/frozen-member-order/v1\0'),
    venue, u64(episode), u64(member)]));
  const [first] = [2, 3, 4, 5].sort((a, b) => Buffer.compare(key(a), key(b)) || a-b);
  return first === 3 || first === 4 ? 54 : 99;
}

async function scenario(episode: number, asymmetric: boolean, reverse: boolean) {
  const model = JSON.parse(execFileSync('python3', ['tests/financial/mirror_probe_input.py', venue.toString('hex'),
    String(episode), asymmetric ? '1' : '0', reverse ? 'reverse' : 'forward'], {encoding:'utf8'}));
  const original = Buffer.from(model.input, 'hex');
  const commitment = hash(original);
  if (asymmetric) assert.equal(model.winner, 0);
  else assert.equal(model.ordinal, expectedOrdinal(episode));
  const [proof] = await getProgramDerivedAddress({programAddress:program,
    seeds:[Buffer.from('mirror-probe'), venue, u64(episode)]});
  const writable = {address:proof, role:AccountRole.WRITABLE};
  function ix(name: string, data: Uint8Array): Instruction {
    const accounts = name === 'start_mirror' ? [{address:payer.address, role:AccountRole.WRITABLE_SIGNER},
      writable, {address:address('11111111111111111111111111111111'),role:AccountRole.READONLY}] :
      name === 'write_mirror' ? [{address:payer.address, role:AccountRole.READONLY_SIGNER}, writable] : [writable];
    return {programAddress:program, accounts, data:Buffer.concat([discriminator('global:'+name), data])};
  }
  async function state() {
    const {value} = await rpc.call('getAccountInfo', [proof, {commitment:'finalized', encoding:'base64'}]);
    assert.equal(value.owner, program);
    const raw = Buffer.from(value.data[0], 'base64');
    assert.deepEqual(raw.subarray(0, 8), discriminator('account:MirrorProbe'));
    assert.deepEqual(raw.subarray(8, 80), Buffer.concat([venue, u64(episode), commitment]));
    return {winner:raw[80], input:raw.subarray(85, 85 + raw.readUInt32LE(81))};
  }
  const decide = (map: number[], selection: number) => ix('decide_mirror', Buffer.from([...map, selection]));
  async function refused(label: string, instruction: Instruction, code: number) {
    const before = await state();
    await h.send(label, [instruction], [], code);
    assert.deepEqual(await state(), before);
  }
  await h.send('commit frozen source and two outcomes', [ix('start_mirror', Buffer.concat([u64(episode),commitment]))]);
  await refused('refuse incomplete committed input', decide(reflection, 1), 6003);
  for (let offset = 0; offset < original.length; offset += 448) {
    const bytes = original.subarray(offset, offset+448);
    const header = Buffer.alloc(6); header.writeUInt16LE(offset); header.writeUInt32LE(bytes.length, 2);
    await h.send('write committed snapshot bytes '+offset, [ix('write_mirror', Buffer.concat([header, bytes]))]);
  }
  assert.deepEqual(await state(), {winner:0, input:original});
  if (asymmetric) {
    await refused('refuse almost mirrored frozen markets', decide(reflection, 1), 6000);
    await refused('refuse other plan on asymmetric book', decide(reflection, 2), 6000);
  } else {
    await refused('refuse duplicate witness member', decide([0,0,...reflection.slice(2)],model.winner), 6000);
    await refused('refuse losing plan', decide(reflection, 3-model.winner), 6005);
    await h.send('verify mirrored outcome and frozen member order', [decide(reflection, model.winner)]);
    assert.deepEqual(await state(), {winner:model.winner, input:original});
    await refused('refuse rewriting final decision', decide(reflection, 3-model.winner), 6001);
  }
  return {episode, proof, ordinal:model.ordinal as number|null, flat:model.flat as number[]|null};
}

try {
  await sql.connect();
  const firstEpisode = 1;
  let oppositeEpisode = firstEpisode+1;
  while (expectedOrdinal(oppositeEpisode) === expectedOrdinal(firstEpisode)) oppositeEpisode++;
  const outcomes = [await scenario(firstEpisode, false, false), await scenario(oppositeEpisode, false, true),
    await scenario(oppositeEpisode+1, true, false)];
  assert.deepEqual(outcomes.slice(0,2).map(x=>x.ordinal).sort(),[54,99]);
  await sql.query('CREATE TABLE mirror_proof_receipts(signature text PRIMARY KEY, proof text, instruction text, succeeded boolean, cu int)');
  const observed = new Map(checks.map(check => [check.signature,check]));
  let verified = 0;
  for (const {proof} of outcomes) {
    const signatures = await rpc.call('getSignaturesForAddress',[proof,{commitment:'finalized', limit:100}]);
    assert(signatures.length > 0 && signatures.length < 100);
    for (const {signature} of signatures) {
      const receipt = await rpc.call('getTransaction',[signature,{commitment:'finalized',encoding:'json',maxSupportedTransactionVersion:1}]);
      const check = observed.get(signature);
      assert(check && receipt.transaction.signatures[0] === signature);
      assert.equal(receipt.meta.computeUnitsConsumed,check.computeUnits);
      assert.equal(receipt.meta.err===null,check.error===null);
      const message = receipt.transaction.message;
      const matching = message.instructions.filter((entry:{programIdIndex:number})=>message.accountKeys[entry.programIdIndex]===program);
      assert.equal(matching.length,1);
      const data = Buffer.from(getBase58Encoder().encode(matching[0].data));
      const action = ['start_mirror','write_mirror','decide_mirror'].find(kind=>discriminator('global:'+kind).equals(data.subarray(0,8)));
      assert(action);
      await sql.query('INSERT INTO mirror_proof_receipts VALUES($1,$2,$3,$4,$5)',
        [signature, proof, action, check.error===null, check.computeUnits]);
      verified++;
    }
  }
  const measurements = (await sql.query("SELECT instruction,succeeded,count(*)::int AS calls,min(cu) AS min_cu,max(cu) AS max_cu FROM mirror_proof_receipts GROUP BY instruction,succeeded ORDER BY instruction,succeeded")).rows;
  assert.equal(verified, checks.length);
  writeFileSync(root+'/mirror.json',JSON.stringify({outcomes,verified,measurements,checks},null,2)+'\n');
  console.log(JSON.stringify({outcomes,verified,measurements}));
} finally {
  ws.close();
  await sql.end();
}
