// Signed resource measurement of a read-only risk decision on synthetic fixture PDAs.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {AccountRole, address, getBase58Encoder, getProgramDerivedAddress, type Address, type Instruction} from '@solana/kit';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {payerKey} from './harness.js';

const program = address('sDPXvpEPwCzVKHdpxntiM1khVvtCj2V6ozCr5euajBi');
const payer = await payerKey(), dir = process.env.RIVALT_RUN_DIR!;
const {rpc, h, ws, checks} = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!, process.env.RIVALT_WS_URL!, dir,
  {instructionConformance: () => false});
const database = new URL(process.env.RIVALT_DATABASE_URL!);
assert.equal(database.hostname, '127.0.0.1');
const pg = createRequire(new URL('../../packages/indexer/package.json', import.meta.url))('pg');
const journal = new pg.Client({connectionString: database.href});
const system = address('11111111111111111111111111111111');
const read = (address: Address) => ({address, role: AccountRole.READONLY});
const disc = (name: string) => createHash('sha256').update('global:' + name).digest().subarray(0, 8);
const ix = (name: string, accounts: NonNullable<Instruction['accounts']>, args: Buffer): Instruction =>
  ({programAddress: program, accounts, data: Buffer.concat([disc(name), args])});
const checkName = 'check_width_exit';
const widths = [2, 4, 8];
async function prepare(kind: 'book' | 'window', index: number) {
  const [key] = await getProgramDerivedAddress({programAddress: program, seeds: [Buffer.from('width-' + kind), Uint8Array.of(index)]});
  await h.send('prepare ' + kind + ' ' + index, [ix('prepare_width_' + kind, [
    {address: payer.address, role: AccountRole.WRITABLE_SIGNER}, {address: key, role: AccountRole.WRITABLE}, read(system),
  ], Buffer.from([index]))]);
  return key;
}

const windows: Address[] = [];
const books = new Map<Address, number>();
// One through width lots alternate direction. At the worst mixed corner every
// lot owes 60 atoms. At current funding only IM (10 per lot) and 7 reserved apply.
const cashRequired = (width: number) => 60 * width * (width + 1) / 2;
function evaluate(book: Address, supplied: Address[], amount: number) {
  const width = books.get(book)!;
  if (supplied.length !== width) return 6003;
  if (!supplied.every((key, index) => key === windows[index])) return 6000;
  if (amount <= 0 || 10_000 - amount < cashRequired(width)) return 6007;
}
async function sendCheck(label: string, book: Address, supplied: Address[], amount: number) {
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(BigInt(amount));
  await h.send(label, [ix(checkName, [book, ...supplied].map(read), data)], [], evaluate(book, supplied, amount));
  const check = checks.at(-1)!;
  assert.equal(check.ws, true);
  await journal.query('insert into observed values ($1,$2,$3,$4,$5)', [
    check.signature, books.get(book), amount, evaluate(book, supplied, amount) ?? 0, check.computeUnits]);
}

try {
  await journal.connect();
  await journal.query('create table observed(signature text primary key, width int, amount int, code int, cu int)');
  await journal.query('create table replay (like observed including all)');
  for (let ordinal = 0; ordinal < 8; ordinal++) windows.push(await prepare('window', ordinal));
  for (const width of widths) books.set(await prepare('book', width), width);
  const addresses = [...books.keys(), ...windows];
  const before = await Promise.all(addresses.map(key => h.read(key)));
  assert(before.every(value => value !== null));
  for (const [book, width] of books) {
    const limit = 10_000 - cashRequired(width), supplied = windows.slice(0, width);
    await sendCheck('at withdrawal limit ' + width, book, supplied, limit);
    await sendCheck('one atom over ' + width, book, supplied, limit + 1);
    await sendCheck('omit last market ' + width, book, supplied.slice(0, -1), limit);
    await sendCheck('substitute last market ' + width, book, [...supplied.slice(0,-1), supplied[0]], limit);
  }
  assert.deepEqual(await Promise.all(addresses.map(key => h.read(key))), before);

  // Rebuild from program history without using the submitted signature list.
  const history = await rpc.call('getSignaturesForAddress', [program, {commitment:'finalized', limit:100}]);
  assert(history.length < 100);
  const measurements = [];
  for (const {signature} of history) {
    const tx = await rpc.call('getTransaction', [signature, {commitment:'finalized', maxSupportedTransactionVersion:1}]);
    const message = tx.transaction.message;
    const call = message.instructions.find((item: {programIdIndex:number}) => message.accountKeys[item.programIdIndex] === program);
    if (!call) continue; // the deployment is also in this program address's history
    const data = Buffer.from(getBase58Encoder().encode(call.data));
    if (!data.subarray(0,8).equals(disc(checkName))) continue;
    assert.equal(data.length,16);
    assert.equal(tx.transaction.signatures[0],signature);
    const [book,...supplied] = call.accounts.map((index:number) => message.accountKeys[index] as Address);
    const width = books.get(book), amount = Number(data.readBigUInt64LE(8));
    assert(width);
    const code = evaluate(book,supplied,amount) ?? 0;
    assert.equal(tx.meta.err?.InstructionError[1].Custom ?? 0,code);
    if (!code) {
      assert.equal(tx.meta.err,null);
      assert.equal(tx.meta.returnData.programId,program);
      assert.equal(Buffer.from(tx.meta.returnData.data[0],'base64').readBigUInt64LE(),BigInt(10_000 - amount));
    }
    const writable = message.accountKeys.length - message.header.numReadonlyUnsignedAccounts - message.header.numReadonlySignedAccounts;
    assert.equal(writable,1);
    await journal.query('insert into replay values ($1,$2,$3,$4,$5)', [signature,width,amount,code,tx.meta.computeUnitsConsumed]);
    if (!code) {
      const wire = await rpc.call('getTransaction',[signature,{commitment:'finalized',encoding:'base64', maxSupportedTransactionVersion:1}]);
      measurements.push({width,cu:tx.meta.computeUnitsConsumed,wireBytes:Buffer.from(wire.transaction[0],'base64').length,
        loaded:message.accountKeys.length,writable,fee:tx.meta.fee});
    }
  }
  const differences = await journal.query('(table observed except table replay) union all (table replay except table observed)');
  assert.equal(differences.rowCount,0);
  assert.equal((await journal.query('select count(*)::int as n from replay')).rows[0].n,12);
  assert.equal(measurements.length,3);
  measurements.sort((left,right)=>left.width-right.width);
  console.table(measurements);
  writeFileSync(dir+'/withdrawal-width.json',JSON.stringify({replayed:12,measurements},null,2));
} finally {
  ws.close();
  await journal.end();
}
