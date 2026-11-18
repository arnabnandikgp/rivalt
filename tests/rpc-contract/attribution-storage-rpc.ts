// Measure exact dyadic basis arithmetic and one rent growth boundary on a synthetic position.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {AccountRole, address, getAddressEncoder, getProgramDerivedAddress, type Instruction} from '@solana/kit';
import {getTransferSolInstruction} from '@solana-program/system';
import {fixtureKey,payerKey} from './harness.js';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';

const root = process.env.RIVALT_RUN_DIR!;
const {h, rpc, ws, checks} = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,
  root,{instructionConformance:()=>false});
const databaseUrl = new URL(process.env.RIVALT_DATABASE_URL!);
assert.equal(databaseUrl.hostname,'127.0.0.1');
const pg = createRequire(new URL('../../packages/indexer/package.json',import.meta.url))('pg');
const sql = new pg.Client({connectionString:databaseUrl.href});
const program = address('sDPXvpEPwCzVKHdpxntiM1khVvtCj2V6ozCr5euajBi');
const trader = await fixtureKey('attribution-storage-trader'), sponsor = await payerKey();
assert.notEqual(trader.address,sponsor.address);
const [basis] = await getProgramDerivedAddress({programAddress:program,
  seeds:[Buffer.from('basis-probe'),getAddressEncoder().encode(trader.address)]});
const disc = (label:string)=>createHash('sha256').update(label).digest().subarray(0,8);
const writable = {address:basis,role:AccountRole.WRITABLE};
const start:Instruction = {programAddress:program,accounts:[
  {address:trader.address,role:AccountRole.WRITABLE_SIGNER},writable,{address:address('11111111111111111111111111111111'),role:AccountRole.READONLY}],
  data:disc('global:start_basis')};
const cycle = (expected:number,count:number):Instruction => ({programAddress:program,
  accounts:[{address:trader.address,role:AccountRole.READONLY_SIGNER},writable],
  data:Buffer.concat([disc('global:cycle_basis'),Buffer.from([expected,count])])});
const transfer = (lamports:bigint)=>getTransferSolInstruction({source:sponsor,destination:basis,amount:lamports});
const traderBalance = async()=>BigInt((await rpc.call('getBalance',[trader.address,{commitment:'finalized'}])).value);
async function checkState(cycles:number,width:number,rent:bigint) {
  const {value} = await rpc.call('getAccountInfo',[basis,{encoding:'base64',commitment:'finalized'}]);
  const raw = Buffer.from(value.data[0],'base64');
  assert.equal(value.owner,program);
  assert.equal(BigInt(value.lamports),rent);
  assert.deepEqual(raw.subarray(0,8),disc('account:Basis'));
  assert.equal(raw[8],cycles);
  assert.equal(raw.length,13+width);
  assert.equal(raw.readUInt32LE(9),width);
  const numerator = BigInt('0x'+Buffer.from(raw.subarray(13)).reverse().toString('hex'));
  assert.equal(numerator,100n*(1n<<BigInt(cycles))+1n);
  const check = checks.at(-1)!;
  await sql.query('INSERT INTO basis_receipts VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [check.signature,cycles,width,numerator.toString(),rent.toString(),check.error===null,check.computeUnits]);
}
try {
  await sql.connect();
  await sql.query('CREATE TABLE basis_receipts(signature text PRIMARY KEY, cycles int, width int, numerator numeric, lamports numeric, success boolean, cu int)');
  const inlineRent = await h.rent(21), expandedRent = await h.rent(29);
  const topUp = expandedRent-inlineRent;
  assert(topUp>0n);
  await h.send('fund fixture trader',[getTransferSolInstruction({source:sponsor,destination:trader.address,amount:10_000_000n})]);
  await h.send('initialize basis',[start],[trader]);
  await checkState(0,8,inlineRent);
  const priorTrader = await traderBalance();
  await h.send('prepare 56 exact cycles',[cycle(0,56)],[trader]);
  await checkState(56,8,inlineRent);
  await h.send('one inline cycle',[cycle(56,1)],[trader]);
  await checkState(57,8,inlineRent);
  await h.send('reject underfunded growth',[transfer(topUp-1n),cycle(57,1)],[trader],6004);
  await checkState(57,8,inlineRent);
  await h.send('sponsor exact growth and cycle',[transfer(topUp),cycle(57,1)],[trader]);
  await checkState(58,16,expandedRent);
  await h.send('one expanded cycle',[cycle(58,1)],[trader]);
  await checkState(59,16,expandedRent);
  assert.equal(await traderBalance(),priorTrader);
  const rows = (await sql.query('SELECT * FROM basis_receipts ORDER BY cycles, success DESC')).rows;
  assert.equal(rows.length,6);
  for (const row of rows) {
    const tx = await rpc.call('getTransaction',[row.signature,{commitment:'finalized',maxSupportedTransactionVersion:1}]);
    assert.equal(tx.meta.err===null,row.success);
    assert.equal(tx.meta.computeUnitsConsumed,row.cu);
  }
  writeFileSync(root+'/basis.json',JSON.stringify({checks,rows,topUpLamports:topUp.toString()},null,2)+'\n');
} finally {
  ws.close();
  await sql.end();
}
