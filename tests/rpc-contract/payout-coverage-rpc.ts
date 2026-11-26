// Meter packed exact-row reads. No Rivalt custody or payment instruction runs.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {AccountRole, address, getAddressEncoder, getProgramDerivedAddress, type Instruction} from '@solana/kit';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {payerKey} from './harness.js';

const runDir = process.env.RIVALT_RUN_DIR!;
const program = address('sDPXvpEPwCzVKHdpxntiM1khVvtCj2V6ozCr5euajBi');
const system = address('11111111111111111111111111111111');
const payer = await payerKey();
const namespace = getAddressEncoder().encode(payer.address);
const disc = (name: string) => createHash('sha256').update(name).digest().subarray(0, 8);
const bodies = await Promise.all(Array.from({length: 8}, async (_, lane) => {
  const [key] = await getProgramDerivedAddress({programAddress: program,
    seeds: [Buffer.from('coverage-body'), namespace, Uint8Array.of(lane)]});
  return key;
}));
const budget = 1_400_000;
const {rpc, h, checks, ws} = await openCanonicalRpcHarness(
  process.env.RIVALT_RPC_URL!, process.env.RIVALT_WS_URL!, runDir, {
    instructionConformance: () => false, computeUnitLimit: () => budget,
    heapSize: label => label.startsWith('prepare') || label.startsWith('change') ? 128 * 1024 : undefined,
    measureComputeBoundary: () => true,
    observeOutcomes: label => label.startsWith('read '),
  });
const db = new URL(process.env.RIVALT_DATABASE_URL!);
assert.equal(db.hostname, '127.0.0.1');
const pg = createRequire(new URL('../../packages/indexer/package.json', import.meta.url))('pg');
const sql = new pg.Client({connectionString: db.toString()});
const rowsPerLane = 125;
const accountBytes = 45 + 64 * rowsPerLane;
const scale = 1_000_000_000n;
const selected = (mask: number) => bodies.flatMap((key, lane) => mask & (1 << lane) ? [key] : []);
const signer = {address: payer.address, role: AccountRole.WRITABLE_SIGNER};
function instruction(name: string, accounts: Instruction['accounts'], arg: number): Instruction {
  return {programAddress: program, accounts, data: Buffer.concat([disc('global:' + name), Uint8Array.of(arg)])};
}

async function validateRows(lane: number, reduced: boolean) {
  const {value} = await rpc.call('getAccountInfo', [bodies[lane], {encoding: 'base64', commitment: 'finalized'}]);
  assert.equal(value.owner, program);
  const data = Buffer.from(value.data[0], 'base64');
  assert.equal(data.length, accountBytes);
  assert.deepEqual(data.subarray(0, 8), disc('account:CoverageBody'));
  assert.deepEqual(data.subarray(8, 40), Buffer.from(namespace));
  assert.equal(data[40], lane);
  assert.equal(data.readUInt32LE(41), rowsPerLane * 64);
  const signed128 = (offset: number) => data.readBigUInt64LE(offset) + (data.readBigInt64LE(offset + 8) << 64n);
  for (let ordinal = 0; ordinal < rowsPerLane; ordinal++) {
    const offset = 45 + 64 * ordinal, id = BigInt(ordinal * 8 + lane);
    assert.equal(data.readBigUInt64LE(offset), id);
    const pair = id / 2n;
    const long = (id % 2n === 0n) !== (pair / 8n % 2n === 0n);
    const sign = long ? 1n : -1n;
    const lots = [sign, sign];
    lots[Number(pair / 4n % 2n)] *= pair + 1n;
    const cash = data.readBigUInt64LE(offset + 8);
    const missingAtom = reduced && id === 999n;
    assert.equal(cash, sign * (30n * lots[0] + 80n * lots[1]) - BigInt(missingAtom));
    let debt = 0n;
    for (const market of [0, 1]) {
      assert.equal(data.readBigInt64LE(offset + 16 + 8 * market), lots[market]);
      const fixed = signed128(offset + 32 + 16 * market);
      assert.equal(fixed, -lots[market] * [100n, 200n][market] * scale);
      const claim = fixed + lots[market] * [70n, 120n][market] * scale;
      if (claim < 0n) debt -= claim;
    }
    assert.equal(cash * scale < debt, missingAtom);
  }
}

async function read(label: string, mask: number, reduced = false) {
  const loaded = selected(mask), debtExpected = reduced && loaded.includes(bodies[7]);
  const metas = loaded.map(key => ({address: key, role: AccountRole.READONLY}));
  const ix = instruction('read_coverage', [{address: payer.address, role: AccountRole.READONLY}, ...metas], mask);
  await h.send('read ' + label, [ix]);
  const check = checks.at(-1)!;
  const tx = await rpc.call('getTransaction', [check.signature, {commitment: 'finalized', maxSupportedTransactionVersion: 1}]);
  const count = rowsPerLane * loaded.length;
  assert.equal(check.ws, true);
  assert.equal(tx.transaction.signatures[0], check.signature);
  assert.deepEqual(check.error, tx.meta.err);
  assert.equal(check.computeUnits, tx.meta.computeUnitsConsumed);
  const message = tx.transaction.message;
  const ixOnChain = message.instructions.filter((item: {programIdIndex: number}) => message.accountKeys[item.programIdIndex] === program);
  assert.equal(ixOnChain.length, 1);
  assert.deepEqual(ixOnChain[0].accounts.map((i: number) => message.accountKeys[i]), [payer.address, ...loaded]);
  const firstReadonly = message.accountKeys.length - message.header.numReadonlyUnsignedAccounts;
  for (const index of ixOnChain[0].accounts.slice(1)) assert(index >= firstReadonly);

  let outcome = 'covered';
  if (tx.meta.err === null) {
    assert(!debtExpected);
    assert.equal(tx.meta.returnData.programId, program);
    assert.equal(Buffer.from(tx.meta.returnData.data[0], 'base64').readUInt32LE(), count);
  } else if (tx.meta.err.InstructionError?.[1]?.Custom === 6006) {
    assert(debtExpected);
    outcome = 'uncovered';
  } else {
    // A resource failure is a measurement only for the full-population case.
    assert.equal(count, 1000);
    assert.equal(tx.meta.computeUnitsConsumed, budget);
    assert(tx.meta.logMessages.some((line: string) => /compute units|computational budget/i.test(line)));
    outcome = 'compute limit';
  }
  await sql.query('INSERT INTO coverage_reads VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
    label, check.signature, count, outcome, tx.meta.computeUnitsConsumed, check.bytes, accountBytes * loaded.length, tx.meta.fee]);
}

async function change(reduce: boolean) {
  await h.send('change last fixture row ' + reduce, [instruction('change_coverage', [
    signer, {address: bodies[7], role: AccountRole.WRITABLE}], Number(reduce))]);
  await validateRows(7, reduce);
}

try {
  await sql.connect();
  await sql.query('CREATE TABLE coverage_reads(label text PRIMARY KEY, signature text UNIQUE, rows int, outcome text, cu int, wire_bytes int, body_bytes int, fee int)');
  for (const [lane, key] of bodies.entries()) {
    await h.send('prepare coverage body ' + lane, [instruction('prepare_coverage', [
      signer, {address: key, role: AccountRole.WRITABLE}, {address: system, role: AccountRole.READONLY}], lane)]);
    await validateRows(lane, false);
  }
  await read('empty control', 0);
  await read('one lane', 1);
  await read('all lanes', 255);
  await change(true);
  await read('last row short', 128, true);
  await read('all lanes after change', 255, true);
  await change(false);
  await read('restored last lane', 128);
  const results = (await sql.query('SELECT * FROM coverage_reads ORDER BY cu, label')).rows;
  assert.equal(results.length, 6);
  for (const result of results) {
    const tx = await rpc.call('getTransaction', [result.signature, {commitment: 'finalized', maxSupportedTransactionVersion: 1}]);
    assert.equal(tx.meta.computeUnitsConsumed, result.cu);
    assert.equal(tx.meta.err === null, result.outcome === 'covered');
  }
  writeFileSync(runDir + '/coverage-reads.json', JSON.stringify(results, null, 2));
  console.log(results.map(({label, outcome, cu, wire_bytes}) => ({label, outcome, cu, wire_bytes})));
} finally {
  ws.close();
  await sql.end();
}
