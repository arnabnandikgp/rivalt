// Signed test-token movements against persisted sparse books. The fixture markets,
// positions and single standing order are synthetic. Cash starts at zero.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {AccountRole, address, getAddressEncoder, getBase58Encoder, getProgramDerivedAddress, type Address, type Instruction} from '@solana/kit';
import {getCreateAccountInstruction} from '@solana-program/system';
import {getInitializeAccount3Instruction, getInitializeMint2Instruction, getMintToInstruction, getTokenDecoder, TOKEN_PROGRAM_ADDRESS} from '@solana-program/token';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {fixtureKey, payerKey} from './harness.js';

const program = address('sDPXvpEPwCzVKHdpxntiM1khVvtCj2V6ozCr5euajBi');
const system = address('11111111111111111111111111111111');
const owner = await payerKey(), outsider = await fixtureKey('slot-custody-other-owner');
const mint = await fixtureKey('slot-custody-mint'), wallet = await fixtureKey('slot-custody-wallet');
const directory = process.env.RIVALT_RUN_DIR!;
const {rpc, h, ws, checks} = await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!, process.env.RIVALT_WS_URL!, directory,
  {instructionConformance: () => false});
const url = new URL(process.env.RIVALT_DATABASE_URL!);
assert.equal(url.hostname,'127.0.0.1');
const pg = createRequire(new URL('../../packages/indexer/package.json',import.meta.url))('pg');
const sql = new pg.Client({connectionString:url.href});
const replayUrl = new URL(url); replayUrl.pathname = '/rivalt_slot_replay';
const replay = new pg.Client({connectionString:replayUrl.href});
const encoder = getAddressEncoder();
const key = (value:Address) => Buffer.from(encoder.encode(value));
const pda = async (seed:string, ...rest:Buffer[]) => (await getProgramDerivedAddress({programAddress:program,seeds:[Buffer.from(seed),...rest]}))[0];
const disc = (s:string) => createHash('sha256').update(s).digest().subarray(0,8);
const read = (address:Address) => ({address,role:AccountRole.READONLY});
const write = (address:Address) => ({address,role:AccountRole.WRITABLE});
const signer = (address:Address) => ({address,role:AccountRole.READONLY_SIGNER});
const paying = {address:owner.address,role:AccountRole.WRITABLE_SIGNER};
const ix = (name:string, accounts:NonNullable<Instruction['accounts']>, data:Buffer=Buffer.alloc(0)):Instruction => ({
  programAddress:program, accounts, data:Buffer.concat([disc('global:'+name),data])});
const u16 = (n:number) => {const data=Buffer.alloc(2); data.writeUInt16LE(n); return data;};
const u64 = (n:number) => {const data=Buffer.alloc(8); data.writeBigUInt64LE(BigInt(n)); return data;};
const custody = await pda('slot-custody',key(owner.address),key(mint.address)), vault = await pda('slot-vault',key(custody));
const marketId = (index:number) => 3+5*index;
const markets = await Promise.all(Array.from({length:9}, (_,index)=>pda('slot-market',key(custody),u16(marketId(index)))));
const roots = new Map<Address, {width:number; child:number}>();
const scale = 1_000_000_000n, supply = 100_000;
const tokenBalance = async (addr:Address) => Number(getTokenDecoder().decode((await h.read(addr))!).amount);
const table = 'create table cash_moves(signature text primary key, action text, donor text, recipient text, amount bigint, outcome int, cu int)';
const insert = 'insert into cash_moves values ($1,$2,$3,$4,$5,$6,$7)';
const measurements: {width:number; action:string; amount:number; cu:unknown; accounts:unknown; bytes:unknown}[] = [];
const names = ['fund_slot_margin','withdraw_slot_cash','transfer_slot_cash'] as const;
type Action = typeof names[number];

// Independent enumeration uses the original entry and every combination of low/high
// funding. Current loss on a short can never offset a long's loss in another market.
function cashFloor(lots:number[]) {
  const reserve = 20*(105-100+10)+7;
  const current = reserve + lots.reduce((sum,q)=>sum+10*Math.abs(q)+Math.max(0,3*q),0);
  let held = 0;
  for(let corner=0;corner < 2**lots.length;corner++) {
    const debt = lots.reduce((sum,q,index)=>sum+Math.max(0,q*((corner&(1<<index)) ? 63 : -57)),0);
    held = Math.max(held,debt);
  }
  return Math.max(current,held);
}

function signed128(bytes:Buffer,offset:number) {
  return bytes.readBigUInt64LE(offset) + (bytes.readBigInt64LE(offset+8)<<64n);
}
async function checkRoot(addr:Address, cash:number, revision:number, accrued:boolean) {
  const {width, child} = roots.get(addr)!;
  const {value} = await rpc.call('getAccountInfo',[addr,{encoding:'base64',commitment:'finalized'}]);
  assert.equal(value.owner,program);
  const bytes = Buffer.from(value.data[0],'base64');
  assert.equal(bytes.length,72+98*width);
  assert.deepEqual(bytes.subarray(0,40),Buffer.concat([disc('account:SlotMargin'),key(custody)]));
  assert.equal(bytes[40],width); assert.equal(bytes[41],child);
  assert.equal(bytes.readBigUInt64LE(42),BigInt(revision));
  assert.equal(bytes.readBigUInt64LE(50),BigInt(cash));
  const count = child === 0 ? width : 2;
  assert.equal(bytes.readBigUInt64LE(58),BigInt(count));
  assert.equal(bytes.readUInt16LE(66),child === 0 ? 3 : 43);
  assert.equal(bytes.readUInt32LE(68),count);
  for(let index=0;index<count;index++) {
    const offset = 72+98*index;
    const market = child === 0 ? marketId(index) : index === 0 ? marketId(width-1) : 43;
    const lots = BigInt(child === 0 ? (index+1)*(index%2 ? -1 : 1) : index === 0 ? 1 : 0);
    const funding = accrued && lots !== 0n ? 3n*scale : 0n;
    assert.equal(bytes.readUInt16LE(offset),market);
    assert.equal(bytes.readBigUInt64LE(offset+2),BigInt(index+1));
    assert.equal(bytes.readBigInt64LE(offset+10),lots);
    assert.equal(signed128(bytes,offset+18),-lots*(100n*scale+funding));
    assert.equal(signed128(bytes,offset+34),funding);
    assert.equal(bytes.readBigUInt64LE(offset+50),lots !== 0n ? 1n : 0n);
    const size = lots < 0n ? -lots : lots;
    assert.equal(signed128(bytes,offset+58),size*100n*scale);
    assert.equal(signed128(bytes,offset+74),size*100n*scale);
    assert.equal(bytes.readBigUInt64LE(offset+90),size);
  }
}

async function move(label:string, action:Action, root:Address, revision:number, amount:number, windows:Address[],
  options:{recipient?:Address; expected?:number; foreign?:boolean}={}) {
  const {expected,recipient} = options;
  const actor = options.foreign ? outsider : owner;
  const accounts = [signer(actor.address),read(custody),write(root)];
  if(action === 'transfer_slot_cash') accounts.push(write(recipient!));
  else accounts.push(read(mint.address),write(vault),write(wallet.address),read(TOKEN_PROGRAM_ADDRESS));
  const watched = [...roots.keys(),vault,wallet.address,...markets];
  const before = expected ? await Promise.all(watched.map(h.read)) : [];
  const tokenBefore = [await tokenBalance(vault),await tokenBalance(wallet.address)];
  await h.send(label,[ix(action,[...accounts,...windows.map(read)],Buffer.concat([u64(revision),u64(amount)]))],
    options.foreign ? [outsider] : [],expected);
  const delta = expected || recipient ? 0 : action === 'fund_slot_margin' ? amount : -amount;
  assert.deepEqual([await tokenBalance(vault),await tokenBalance(wallet.address)],
    [tokenBefore[0]+delta,tokenBefore[1]-delta],label);
  if(expected) assert.deepEqual(await Promise.all(watched.map(h.read)),before,label);
  const row = checks.at(-1)!; assert.equal(row.ws,true);
  await sql.query(insert,[row.signature,action,root,recipient??null,amount,expected??0,row.computeUnits]);
  if(!expected && action !== 'fund_slot_margin') measurements.push({width:roots.get(root)!.width,
    action:label, amount,cu:row.computeUnits,accounts:row.loadedAccounts,bytes:row.bytes});
}

// Re-fetch program history independently of the submitted signature list. Rebuild
// book cash from successful instructions and reconcile it to both chain and SPL.
async function replayCash() {
  await sql.query('create database rivalt_slot_replay');
  await replay.connect();
  await replay.query(table);
  const history = await rpc.call('getSignaturesForAddress',[program,{commitment:'finalized',limit:100}]);
  assert(history.length < 100,'scope must fit complete history page');
  for(const {signature} of history) {
    const tx = await rpc.call('getTransaction',[signature,{commitment:'finalized',maxSupportedTransactionVersion:1}]);
    const msg = tx.transaction.message;
    assert.equal(tx.transaction.signatures[0],signature);
    for(const call of msg.instructions) {
      if(msg.accountKeys[call.programIdIndex] !== program) continue;
      const data = Buffer.from(getBase58Encoder().encode(call.data));
      const action = names.find(name=>data.subarray(0,8).equals(disc('global:'+name)));
      if(!action) continue;
      assert.equal(data.length,24);
      const amount = Number(data.readBigUInt64LE(16)), code = tx.meta.err?.InstructionError[1].Custom ?? 0;
      if(!code) assert.equal(tx.meta.err,null);
      const accounts = call.accounts.map((index:number)=>msg.accountKeys[index]);
      const recipient = action === 'transfer_slot_cash' ? accounts[3] : null;
      if(!recipient) {
        for(const [addr,index] of [[vault,4],[wallet.address,5]] as const) {
          assert.equal(accounts[index],addr);
          const balance = (rows:{accountIndex:number;uiTokenAmount:{amount:string}}[]) => {
            const row = rows.find(r=>r.accountIndex === call.accounts[index]); assert(row);
            return Number(row.uiTokenAmount.amount);
          };
          const delta = code ? 0 : (action === 'fund_slot_margin' ? amount : -amount);
          assert.equal(balance(tx.meta.postTokenBalances)-balance(tx.meta.preTokenBalances),addr===vault ? delta : -delta);
        }
      }
      await replay.query(insert,[signature,action,accounts[2],recipient,amount,code,tx.meta.computeUnitsConsumed]);
    }
  }
  const rows = 'select * from cash_moves order by signature';
  assert.deepEqual((await replay.query(rows)).rows,(await sql.query(rows)).rows);
  let total = 0;
  for(const addr of roots.keys()) {
    const result = await replay.query(`select coalesce(sum(case when recipient=$1 or action='fund_slot_margin'
      then amount else -amount end),0) as cash from cash_moves where outcome=0 and (donor=$1 or recipient=$1)`,[addr]);
    const cash = Number(result.rows[0].cash);
    assert.equal(BigInt(cash),(await h.read(addr))!.readBigUInt64LE(50));
    total += cash;
  }
  assert.equal(await tokenBalance(vault),total);
  assert.equal(await tokenBalance(wallet.address),supply-total);
  return {total,rows:(await replay.query(rows)).rowCount};
}

try {
  await sql.connect(); await sql.query(table);
  await h.send('create test mint and wallet',[
    getCreateAccountInstruction({payer:owner,newAccount:mint,lamports:await h.rent(82),space:82n,programAddress:TOKEN_PROGRAM_ADDRESS}),
    getInitializeMint2Instruction({mint:mint.address,decimals:6,mintAuthority:owner.address}),
    getCreateAccountInstruction({payer:owner,newAccount:wallet,lamports:await h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),
    getInitializeAccount3Instruction({account:wallet.address,mint:mint.address,owner:owner.address}),
    getMintToInstruction({mint:mint.address,token:wallet.address,mintAuthority:owner,amount:BigInt(supply)})],[mint,wallet]);
  await h.send('initialize collateral custody',[ix('open_slot_custody',[paying,read(mint.address),write(custody),write(vault),read(TOKEN_PROGRAM_ADDRESS),read(system)])]);
  for(const [i,window] of markets.entries()) {
    await h.send('initialize fixture market '+marketId(i),[ix('create_slot_market',[paying,read(custody),write(window),read(system)],u16(marketId(i)))]);
  }
  for(const width of [2,4,8]) {
    const pair: Address[] = [];
    for(const child of [0,1]) {
      const args = Buffer.from([width,child]), addr = await pda('slot-margin',key(custody),args);
      await h.send('prepare '+width+' child '+child,[ix('create_slot_margin',[paying,read(custody),write(addr),read(system)],args)]);
      roots.set(addr,{width,child}); pair.push(addr); await checkRoot(addr,0,0,false);
    }
    const [donor,recipient] = pair, donorMarkets = markets.slice(0,width);
    const recipientMarkets = [markets[width-1],markets[8]], union = [...donorMarkets,markets[8]];
    const floor = cashFloor(donorMarkets.map((_,i)=>(i+1)*(i%2 ? -1 : 1)));
    const max = 10_000-floor;
    await move('deposit '+width,'fund_slot_margin',donor,0,10_000,[]);
    await checkRoot(donor,10_000,1,false);
    await move('withdraw one over '+width,'withdraw_slot_cash',donor,1,max+1,donorMarkets,{expected:6007});
    await move('withdraw omitted '+width,'withdraw_slot_cash',donor,1,max,donorMarkets.slice(1),{expected:6003});
    await move('withdraw substituted '+width,'withdraw_slot_cash',donor,1,max,[...donorMarkets.slice(0,-1),markets[8]],{expected:6008});
    if(width === 2) {
      await move('foreign custody signer','withdraw_slot_cash',donor,1,max,donorMarkets,{foreign:true,expected:6008});
      await move('stale custody revision','withdraw_slot_cash',donor,0,max,donorMarkets,{expected:6001});
    }
    await move('withdraw maximum '+width,'withdraw_slot_cash',donor,1,max,donorMarkets);
    await checkRoot(donor,floor,2,true);
    await move('redeposit withdrawn amount '+width,'fund_slot_margin',donor,2,max,[]);
    await move('transfer over maximum '+width,'transfer_slot_cash',donor,3,max+1,union,{recipient,expected:6007});
    await move('omit recipient order market '+width,'transfer_slot_cash',donor,3,max,donorMarkets,{recipient,expected:6003});
    await move('substitute recipient order market '+width,'transfer_slot_cash',donor,3,max,[...donorMarkets,donorMarkets[0]],{recipient,expected:6008});
    await move('transfer maximum '+width,'transfer_slot_cash',donor,3,max,union,{recipient});
    await checkRoot(donor,floor,4,true);
    await checkRoot(recipient,max,1,true);
    const recipientFloor = cashFloor([1]);
    await move('recipient withdraw maximum '+width,'withdraw_slot_cash',recipient,1,max-recipientFloor,recipientMarkets);
    await checkRoot(recipient,recipientFloor,2,true);
  }
  const journal = await replayCash();
  console.table(measurements);
  console.log('Reconciled custody instructions and remaining vault atoms:',journal);
  writeFileSync(directory+'/slot-custody.json',JSON.stringify({journal,measurements},null,2));
} finally {await ws.close(); await replay.end(); await sql.end();}
