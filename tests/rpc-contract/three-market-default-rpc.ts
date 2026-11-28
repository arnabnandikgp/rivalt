// One signed cross default built entirely from wallet deposits and consenting fills.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {AccountRole,address,getAddressEncoder,getProgramDerivedAddress,type Address,type Instruction} from '@solana/kit';
import {getCreateAccountInstruction,getTransferSolInstruction} from '@solana-program/system';
import {getInitializeAccount3Instruction,getInitializeMint2Instruction,getMintToInstruction,getTokenDecoder,TOKEN_PROGRAM_ADDRESS} from '@solana-program/token';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {fixtureKey,payerKey} from './harness.js';
import {fingerprint,readRoot,replayOrders} from './slot-orders-history.js';

const program=address('sDPXvpEPwCzVKHdpxntiM1khVvtCj2V6ozCr5euajBi'), system=address('11111111111111111111111111111111');
const operator=await payerKey(), keeper=await fixtureKey('linked-default-keeper'), mint=await fixtureKey('linked-default-mint');
const competing=process.env.RIVALT_PROOF_SCOPE==='competing-three-market-default';
const labels=['cross trader','BTC debtor',competing?'BTC winning maker':'flat BTC creditor','ETH creditor','SOL creditor'];
const owners=await Promise.all(labels.map(name=>fixtureKey('linked-default-owner-'+name))), wallets=await Promise.all(labels.map(name=>fixtureKey('linked-default-wallet-'+name)));
const ids=[3,8,38], modes=[65535,3,3,8,38], deposits=competing?[7896,289,1000,2000,2000]:[2806,599,1000,1000,1000];
const deposited=BigInt(deposits.reduce((sum,amount)=>sum+amount,0));
const key=(addr:Address)=>Buffer.from(getAddressEncoder().encode(addr));
const u16=(n:number)=>{const b=Buffer.alloc(2); b.writeUInt16LE(n); return b;};
const u64=(n:number|bigint)=>{const b=Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b;};
const pda=async(seed:string,...rest:Buffer[])=>(await getProgramDerivedAddress({programAddress:program,seeds:[Buffer.from(seed),...rest]}))[0];
const ro=(address:Address)=>({address,role:AccountRole.READONLY}), rw=(address:Address)=>({address,role:AccountRole.WRITABLE});
const signer=(address:Address)=>({address,role:AccountRole.READONLY_SIGNER}), paying=(address:Address)=>({address,role:AccountRole.WRITABLE_SIGNER});
const custody=await pda('slot-custody',key(operator.address),key(mint.address)), vault=await pda('slot-vault',key(custody));
const roots=await Promise.all(owners.map((owner,i)=>pda('trade-root',key(custody),key(owner.address),u16(modes[i]))));
const markets=await Promise.all(ids.map(id=>pda('trade-market',key(custody),u16(id))));
const complete=[...roots,...markets], watched=[custody,vault,...complete,...wallets.map(w=>w.address)];
const dir=process.env.RIVALT_RUN_DIR!;
const {rpc,h,ws,checks}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,dir,{
  instructionConformance:()=>false, payerFor:label=>label.startsWith('keeper ')?keeper:undefined,
});
const expected=new Map<string,number>();
const snapshot=()=>Promise.all(watched.map(h.read));
const root=async(i:number)=>readRoot((await h.read(roots[i]))!);
const balance=async(account:Address)=>getTokenDecoder().decode((await h.read(account))!).amount;
async function send(label:string,name:string,accounts:NonNullable<Instruction['accounts']>,args:Buffer[]=[],actor=operator,error?:number) {
  const before=error?await snapshot():null;
  await h.send(label,[{programAddress:program,accounts,data:Buffer.concat([fingerprint('global:'+name),...args])}],
    actor===operator?[]:[actor],error);
  const receipt=checks.at(-1)!;
  expected.set(String(receipt.signature),error??0);
  assert.equal(receipt.ws,true);
  if(before) assert.deepEqual(await snapshot(),before,label);
}
async function wallet(i:number,amount:number,withdraw=false,error?:number,actor=i) {
  const state=await root(i);
  const windows=withdraw?state.slots.map(slot=>ro(markets[ids.indexOf(slot.id)])):[];
  await send((withdraw?'withdraw ':'deposit ')+amount+' '+labels[i]+(error?' refusal':''),
    withdraw?'withdraw_trade_cash':'deposit_trade_cash',[signer(owners[actor].address),ro(custody),rw(roots[i]),ro(mint.address),
      rw(vault),rw(wallets[actor].address),ro(TOKEN_PROGRAM_ADDRESS),...windows],[u64(state.rev),u64(amount)],owners[actor],error);
}
async function publish(id:number,price:number,error?:number) {
  const market=markets[ids.indexOf(id)];
  await send('publish '+id+' at '+price,'publish_trade_market',[signer(operator.address),ro(custody),rw(market)],
    [u64((await h.read(market))!.readBigUInt64LE(42)),u64(price),u64(0)],operator,error);
}
async function place(id:number,price:number,close:boolean,lots=10) {
  const trader=await root(0);
  const union=Array.from(new Set([...trader.slots.map(s=>s.id),id])).sort((a,b)=>a-b);
  const expires=Number(await rpc.call('getSlot',[{commitment:'confirmed'}]))+5000;
  await send('place '+id+' at '+price,'place_trade_order',[signer(owners[0].address),ro(custody),rw(roots[0]),...union.map(i=>ro(markets[ids.indexOf(i)]))],
    [u64(trader.rev),u16(id),Buffer.from([Number(close)]),u64(lots),u64(price),u64(competing?5:3),u64(expires),Buffer.from([Number(close)])],owners[0]);
  return union;
}
async function trade(id:number,maker:number,price:number,close=false,lots=10) {
  await publish(id,price);
  const union=await place(id,price,close,lots);
  const target=markets[ids.indexOf(id)], source=await h.read(target);
  await send('match '+labels[maker]+' at '+price,'fill_trade_order',[signer(owners[maker].address),ro(custody),rw(target),rw(roots[0]),rw(roots[maker]),
    ...union.filter(i=>i!==id).map(i=>ro(markets[ids.indexOf(i)]))],
    [u64((await root(0)).rev),u64((await root(maker)).rev),u64(source!.readBigUInt64LE(42)),u64(lots)],owners[maker]);
}
const freeze=(label:string,accounts=complete,error?:number)=>send('keeper '+label,'freeze_default',[rw(custody),ro(vault),...accounts.map(ro)],[],operator,error);
const apply=(label:string,commit:Buffer,charge:number|[number,number],error?:number)=>send('keeper '+label,Array.isArray(charge)?'apply_competing_default':'apply_default',
  [rw(custody),ro(vault),...roots.map(rw),rw(markets[0]),...markets.slice(1).map(ro)],[commit,...(Array.isArray(charge)?charge:[charge]).map(u64)],operator,error);

try {
  await h.send('create mint and fund signers',[
    ...[keeper,...owners].map(owner=>getTransferSolInstruction({source:operator,destination:owner.address,amount:50_000_000n})),
    getCreateAccountInstruction({payer:operator,newAccount:mint,lamports:await h.rent(82),space:82n,programAddress:TOKEN_PROGRAM_ADDRESS}),
    getInitializeMint2Instruction({mint:mint.address,decimals:6,mintAuthority:operator.address})],[mint]);
  await send('create SPL custody','open_slot_custody',[paying(operator.address),ro(mint.address),rw(custody),rw(vault),ro(TOKEN_PROGRAM_ADDRESS),ro(system)]);
  const configure=(owner=operator,error?:number)=>send('configure fixed roster','configure_default',[signer(owner.address),rw(custody)],
    [...owners.map(o=>key(o.address)),...ids.map(u16)],owner,error);
  await configure(owners[0],6008); await configure(); await configure(operator,6014);
  for(const [i,market] of markets.entries()) await send('create market '+ids[i],'open_trade_market',
    [paying(operator.address),ro(custody),rw(market),ro(system)],[u16(ids[i])]);
  const outsider=await pda('trade-root',key(custody),key(operator.address),u16(65535));
  await send('refuse unlisted trader','open_trade_root',[paying(operator.address),ro(custody),rw(outsider),ro(system)],[u16(65535)],operator,6015);
  assert.equal(await h.read(outsider),null);
  for(const [i,owner] of owners.entries()) {
    await h.send('mint test tokens for '+labels[i],[
      getCreateAccountInstruction({payer:operator,newAccount:wallets[i],lamports:await h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),
      getInitializeAccount3Instruction({account:wallets[i].address,mint:mint.address,owner:owner.address}),
      getMintToInstruction({mint:mint.address,token:wallets[i].address,mintAuthority:operator,amount:BigInt(deposits[i])})],[wallets[i]]);
    await send('create margin '+labels[i],'open_trade_root',[paying(owner.address),ro(custody),rw(roots[i]),ro(system)],[u16(modes[i])],owner);
    await wallet(i,deposits[i]);
  }
  if(competing) {
    // A realizes -60 then +30 on BTC, and retains one 1000-entry long.
    // B realizes +60 then buys one lot at 1030. The debtor retains both shorts.
    await trade(3,2,1060,false,1); await trade(3,2,1000,true,1);
    await trade(3,1,1000,false,2); await trade(3,2,1030,true,1);
    await trade(8,3,16000,false,1); await trade(38,4,15500,false,1);
  } else {
    await trade(3,2,560); await trade(3,2,500,true); await trade(3,1,500);
    await trade(8,3,300); await trade(38,4,200);
  }
  await freeze('refuse healthy book',complete,6000);
  await place(3,competing?1030:500,true,competing?1:10);
  await publish(3,competing?1150:600); await publish(8,competing?11000:120); await publish(38,competing?12500:80);
  await freeze('refuse unresolved standing order',complete,6000);
  await send('cancel open BTC order','cancel_trade_order',[signer(owners[0].address),ro(custody),rw(roots[0])],
    [u64((await root(0)).rev)],owners[0]);
  await freeze('refuse omitted market',complete.slice(0,-1),6015);
  await freeze('refuse substituted root',[roots[1],...complete.slice(1)],6015);
  await freeze('refuse reversed markets',[...roots,markets[0],markets[2],markets[1]],6015);
  const bytes=await Promise.all(complete.map(h.read));
  await freeze('freeze complete book');
  const frozen=(await h.read(custody))!;
  assert.equal(frozen[73],2); assert.equal(frozen.readBigUInt64LE(376),deposited);
  const hash=(...chunks:Buffer[])=>createHash('sha256').update(Buffer.concat(chunks)).digest();
  let commitment=hash(Buffer.from('Rivalt/local-three-market-freeze/v1'),key(program),key(custody),key(mint.address),frozen.subarray(368,376));
  for(const [i,addr] of complete.entries()) commitment=hash(commitment,key(addr),bytes[i]!);
  assert.deepEqual(commitment,frozen.subarray(336,368));
  await wallet(2,1,true,6014); await wallet(4,1,false,6014); await publish(3,601,6014);
  const selected=competing?[4,6] as [number,number]:100;
  await apply('refuse other commitment',Buffer.alloc(32),selected,6017);
  if(competing) {
    await apply('refuse aggregate without individual charges',commitment,10,6016);
    await apply('refuse equally shared charge that impairs foreign creditors',commitment,[5,5],6016);
    await apply('refuse safe but less proportional allocation',commitment,[3,7],6016);
    await apply('refuse under-recovery',commitment,[4,5],6016);
    await apply('refuse charge above debtor shortfall',commitment,[4,7],6016);
  } else {
    await apply('refuse competing instruction on single-winner book',commitment,[100,0],6016);
    await apply('refuse nonmaximal charge',commitment,99,6016); await apply('protect foreign creditors',commitment,101,6016);
  }
  await apply('resolve complete book',commitment,selected); await apply('refuse duplicate application',commitment,selected,6014);
  const payouts=competing?[0,0,1174,7000,5000]:[0,0,1400,2800,2200];
  for(const [i,value] of payouts.entries()) {
    const state=await root(i);
    assert.deepEqual([state.cash,state.slots.length],[BigInt(value),0]);
  }
  assert.equal(await balance(vault),deposited);
  await wallet(1,1,true,6007); await wallet(2,payouts[2]+1,true,6007); await wallet(2,payouts[2],true,6008,0);
  for(const i of [2,3,4]) await wallet(i,payouts[i],true);
  assert.deepEqual(await Promise.all(wallets.map(w=>balance(w.address))),payouts.map(BigInt));
  const journal=await replayOrders(rpc,program,roots,vault,await balance(vault),expected,{
    custody,keeper:keeper.address,owners:owners.map(o=>o.address),wallets:wallets.map(w=>w.address),mint:mint.address,ids,competing,
  });
  assert.deepEqual([journal.fills,journal.cash,journal.fees,journal.vault],competing?[6,'0','11','11']:[5,'0','5','5']);
  if(competing) {
    assert.deepEqual(journal.settlement,{charge:'10',matched:'2',protectedControls:{'3/7':true,'5/5':false},enumerated:66,feasible:29,before:payouts.map(String),payouts:payouts.map(String),spent:['1','0','0'],
      winners:[{id:'0',weight:'120',charge:'4',matched:'1',baseTicks:'4',extraTickLots:'0'},
               {id:'2',weight:'120',charge:'6',matched:'1',baseTicks:'6',extraTickLots:'0'}]});
  } else assert.deepEqual(journal.settlement,{charge:'100',matched:'1',enumerated:400,feasible:100,before:['40','0','1360','2800','2200'],payouts:payouts.map(String),spent:['1','0','0']});
  const measurements=checks.map(({label,signature,computeUnits,bytes,loadedAccounts,error})=>({label,signature,computeUnits,bytes,loadedAccounts,error}));
  writeFileSync(dir+'/three-market-default.json',JSON.stringify({journal,measurements},null,2));
  console.log('Reconciled signed three-market default',journal);
} finally {await ws.close();}
