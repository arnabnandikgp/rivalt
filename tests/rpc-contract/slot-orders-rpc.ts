// Signed sparse position lifecycle on local test collateral.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {AccountRole, address, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction} from '@solana/kit';
import {getCreateAccountInstruction,getTransferSolInstruction} from '@solana-program/system';
import {getInitializeAccount3Instruction,getInitializeMint2Instruction,getMintToInstruction,getTokenDecoder,TOKEN_PROGRAM_ADDRESS} from '@solana-program/token';
import {openCanonicalRpcHarness} from './canonical-rpc-harness.js';
import {fixtureKey,payerKey} from './harness.js';
import {fingerprint,readRoot,replayOrders,signed128} from './slot-orders-history.js';

const program=address('sDPXvpEPwCzVKHdpxntiM1khVvtCj2V6ozCr5euajBi'), system=address('11111111111111111111111111111111');
const operator=await payerKey(), trader=await fixtureKey('slot-order-trader'), provider=await fixtureKey('slot-order-provider');
const mint=await fixtureKey('slot-order-mint'), traderToken=await fixtureKey('slot-order-wallet'), makerToken=await fixtureKey('slot-order-provider-wallet');
const qualifyLiquidation=process.env.RIVALT_PROOF_SCOPE==='slot-liquidation';
const receiver=await fixtureKey('slot-risk-receiver'), receiverToken=await fixtureKey('slot-risk-wallet');
const keeper=await fixtureKey('slot-risk-fee-payer');
const directory=process.env.RIVALT_RUN_DIR!;
const {rpc,h,ws,checks}=await openCanonicalRpcHarness(process.env.RIVALT_RPC_URL!,process.env.RIVALT_WS_URL!,directory,{
  instructionConformance:()=>false,
  payerFor:label=>label.startsWith('liquidation: ')?keeper:undefined,
});
const key=(addr:Address)=>Buffer.from(getAddressEncoder().encode(addr));
const u16=(n:number)=>{const b=Buffer.alloc(2);b.writeUInt16LE(n); return b;};
const u64=(n:number)=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
const i64=(n:number)=>{const b=Buffer.alloc(8);b.writeBigInt64LE(BigInt(n));return b;};
const pda=async(seed:string,...rest:Buffer[])=>(await getProgramDerivedAddress({programAddress:program,seeds:[Buffer.from(seed),...rest]}))[0];
const read=(address:Address)=>({address,role:AccountRole.READONLY});
const write=(address:Address)=>({address,role:AccountRole.WRITABLE});
const signer=(address:Address)=>({address,role:AccountRole.READONLY_SIGNER});
const paying=(address:Address)=>({address,role:AccountRole.WRITABLE_SIGNER});
const ids=Array.from({length:9},(_,i)=>3+i*5);
const custody=await pda('slot-custody',key(operator.address),key(mint.address)), vault=await pda('slot-vault',key(custody));
const cross=await pda('trade-root',key(custody),key(trader.address),u16(65535));
const receiverRoot=await pda('trade-root',key(custody),key(receiver.address),u16(65535));
const markets=new Map<number,Address>(), makers=new Map<number,Address>();
for(const id of ids) {
  markets.set(id,await pda('trade-market',key(custody),u16(id)));
  if(id!==43) makers.set(id,await pda('trade-root',key(custody),key(provider.address),u16(id)));
}
const roots=[cross,...makers.values(),...(qualifyLiquidation?[receiverRoot]:[])];
const watched=[...roots,...markets.values(),vault,traderToken.address,makerToken.address,...(qualifyLiquidation?[receiverToken.address]:[])];
const snapshot=()=>Promise.all(watched.map(h.read));
const state=async(root:Address)=>readRoot((await h.read(root))!);
const balance=async(wallet:Address)=>getTokenDecoder().decode((await h.read(wallet))!).amount;
const expected=new Map<string,number>();
type Actor=typeof trader;
async function send(label:string,name:string,accounts:NonNullable<Instruction['accounts']>,args:Buffer[],actor:Actor=operator,error?:number) {
  const before=error?await snapshot():null;
  const instruction={programAddress:program,accounts,data:Buffer.concat([fingerprint('global:'+name),...args])};
  await h.send(label,[instruction],actor.address===operator.address?[]:[actor],error);
  const receipt=checks.at(-1)!;
  assert.equal(receipt.ws,true);
  if(name!=='open_slot_custody'&&name!=='open_trade_root') expected.set(String(receipt.signature),error??0);
  if(before) assert.deepEqual(await snapshot(),before,label);
}
async function wallet(label:string,root:Address,amount:number,withdraw=false,error?:number,omit?:number) {
  const [owner,token]=root===cross?[trader,traderToken]:root===receiverRoot?[receiver,receiverToken]:[provider,makerToken];
  const book=await state(root);
  const windows=withdraw?book.slots.filter(s=>s.id!==omit).map(s=>read(markets.get(s.id)!)):[];
  await send(label,withdraw?'withdraw_trade_cash':'deposit_trade_cash',[signer(owner.address),read(custody),write(root),read(mint.address),
    write(vault),write(token.address),read(TOKEN_PROGRAM_ADDRESS),...windows],[u64(book.rev),u64(amount)],owner,error);
}
async function place(label:string,id:number,sell:boolean,price:number,budget:number,reduce=false,error?:number,root=cross) {
  const owner=root===cross?trader:receiver, book=await state(root);
  const union=Array.from(new Set([...book.slots.map(s=>s.id),id])).sort((a,b)=>a-b);
  const expires=Number(await rpc.call('getSlot',[{commitment:'confirmed'}]))+5000;
  await send(label,'place_trade_order',[signer(owner.address),read(custody),write(root),...union.map(i=>read(markets.get(i)!))],
    [u64(book.rev),u16(id),Buffer.from([Number(sell)]),u64(100),u64(price),u64(budget),u64(expires),Buffer.from([Number(reduce)])],owner,error);
}
async function cancel(label:string,root=cross) {
  const owner=root===cross?trader:receiver;
  await send(label,'cancel_trade_order',[signer(owner.address),read(custody),write(root)],[u64((await state(root)).rev)],owner);
}
async function fill(label:string,id:number,lots:number,options:{error?:number;omit?:number;revision?:number;makerId?:number;actor?:Actor}={}) {
  const maker=makers.get(options.makerId??id)!, market=markets.get(id)!;
  const [t,m,source]=await Promise.all([state(cross),state(maker),h.read(market)]);
  const union=Array.from(new Set([...t.slots,...m.slots].map(s=>s.id))).filter(i=>i!==id && i!==options.omit).sort((a,b)=>a-b);
  const actor=options.actor??provider;
  await send(label,'fill_trade_order',[signer(actor.address),read(custody),write(market),write(cross),write(maker),...union.map(i=>read(markets.get(i)!))],
    [u64(t.rev),u64(m.rev),u64(options.revision??Number(source!.readBigUInt64LE(42))),u64(lots)],actor,options.error);
}
async function publish(id:number,price:number,funding:number) {
  const market=markets.get(id)!;
  const before=await Promise.all(roots.map(h.read));
  await send('update index and funding '+id,'publish_trade_market',[signer(operator.address),read(custody),write(market)],
    [u64(Number((await h.read(market))!.readBigUInt64LE(42))),u64(price),i64(funding)]);
  assert.deepEqual(await Promise.all(roots.map(h.read)),before);
}
const scale=1_000_000_000n;
try {
  await h.send('fund independent signers and create mint',[
    ...[trader,provider,...(qualifyLiquidation?[receiver,keeper]:[])].map(owner=>getTransferSolInstruction({source:operator,destination:owner.address,amount:1_000_000_000n})),
    getCreateAccountInstruction({payer:operator,newAccount:mint,lamports:await h.rent(82),space:82n,programAddress:TOKEN_PROGRAM_ADDRESS}),
    getInitializeMint2Instruction({mint:mint.address,decimals:6,mintAuthority:operator.address})],[mint]);
  const supplies:[Actor,Actor,bigint][]=[[trader,traderToken,20_000n],[provider,makerToken,32_000n]];
  if(qualifyLiquidation) supplies.push([receiver,receiverToken,1400n]);
  for(const [owner,token,supply] of supplies) {
    await h.send('mint local collateral '+owner.address,[
      getCreateAccountInstruction({payer:operator,newAccount:token,lamports:await h.rent(165),space:165n,programAddress:TOKEN_PROGRAM_ADDRESS}),
      getInitializeAccount3Instruction({account:token.address,mint:mint.address,owner:owner.address}),
      getMintToInstruction({mint:mint.address,token:token.address,mintAuthority:operator,amount:supply})],[token]);
  }
  await send('initialize collateral vault','open_slot_custody',[paying(operator.address),read(mint.address),write(custody),write(vault),read(TOKEN_PROGRAM_ADDRESS),read(system)],[]);
  for(const [id,market] of markets) await send('initialize market '+id,'open_trade_market',[paying(operator.address),read(custody),write(market),read(system)],[u16(id)]);
  for(const [id,root] of [[65535,cross],...makers] as [number,Address][]) {
    const owner=root===cross?trader:provider;
    await send('open empty margin '+id,'open_trade_root',[paying(owner.address),read(custody),write(root),read(system)],[u16(id)],owner);
    assert.deepEqual(await state(root),{rev:0,cash:0n,last:0n,remaining:0n,slots:[]});
    if(id!==3) await wallet('fund margin '+id,root,root===cross?20_000:4_000);
  }
  await place('place order without fee allowance',3,false,100,0);
  await fill('refuse fee beyond signed budget',3,25,{error:6009});
  await cancel('cancel unfilled order');
  assert.equal((await state(cross)).slots.length,0);
  for(const id of ids.slice(0,8)) {
    await place('place opening order '+id,id,false,100,2);
    if(id===3) {
      assert.equal((await state(cross)).slots[0].incarnation,2n);
      await fill('refuse unfunded isolated capital',id,25,{error:6010});
      await wallet('fund first isolated capital',makers.get(id)!,4_000);
      await fill('first partial opening',id,25);
      const partial=await state(cross);
      assert.deepEqual([partial.remaining,partial.cash,partial.slots[0].lots],[75n,19_999n,25n]);
      await fill('finish first opening',id,75);
    } else {
      if(id===38) {
        await fill('refuse omitted occupied sibling',id,100,{omit:3,error:6003});
        await fill('refuse wrong isolated market',id,100,{makerId:33,error:6009});
        await fill('refuse foreign maker signer',id,100,{actor:operator,error:6008});
      }
      await fill('fill opening '+id,id,100);
    }
    const t=await state(cross), m=await state(makers.get(id)!);
    assert.deepEqual([t.slots.at(-1)!.lots,t.remaining,m.slots[0].lots,m.cash],[100n,0n,-100n,4000n]);
  }
  assert.equal((await state(cross)).cash,19_984n);
  await place('refuse ninth occupied market',43,false,100,2,false,6000);
  await place('place reduction before source update',38,true,100,2,true);
  await publish(3,95,1); await publish(38,98,1);
  await fill('refuse superseded source revision',38,40,{revision:0,error:6001});
  await fill('refuse execution below signed sell limit',38,40,{error:6009});
  await cancel('cancel repriced reduction');
  await wallet('refuse pre-update withdrawal amount',cross,11_984,true,6007);
  await place('place reduction at updated limit',38,true,98,2,true);
  await fill('partial reduction across eight markets',38,40);
  const reduced=await state(cross), partial=reduced.slots.at(-1)!;
  assert.deepEqual([reduced.remaining,partial.lots,partial.virtual,partial.funding,partial.entryLow,partial.reference],
    [60n,60n,-6180n*scale,scale,10_000n*scale,100n]);
  assert.deepEqual([reduced.slots[0].funding,reduced.slots[0].virtual],[scale,-10_100n*scale]);
  await fill('finish reduction across eight markets',38,60);
  const flat=(await state(cross)).slots.at(-1)!, opposite=(await state(makers.get(38)!)).slots[0];
  assert.deepEqual([flat.lots,flat.virtual,flat.reference,flat.entryLow,flat.entryHigh,opposite.lots,opposite.virtual],
    [0n,-300n*scale,0n,0n,0n,0n,300n*scale]);
  await place('flat unsettled debt keeps eighth slot',43,false,100,2,false,6000);
  // Seven live longs require 950 + 6*1,000 initial margin. The first market
  // owes 600 and the closed market owes 300. Held funding can add 7*200.
  const currentFloor=950+6*1000+600+300, heldFloor=600+300+7*200;
  const exact=19_982-Math.max(currentFloor,heldFloor);
  assert.equal((await state(cross)).cash,19_982n);
  await wallet('refuse exit omitting closed debt',cross,exact,true,6003,38);
  await wallet('refuse one atom over trader exit',cross,exact+1,true,6007);
  await wallet('withdraw exact trader surplus',cross,exact,true);
  assert.deepEqual([(await state(cross)).cash,await balance(traderToken.address)],[7850n,12_132n]);
  await wallet('refuse maker unpaid gain as cash',makers.get(38)!,4001,true,6007);
  await wallet('withdraw maker funded cash',makers.get(38)!,4000,true);
  assert.deepEqual([(await state(makers.get(38)!)).cash,await balance(makerToken.address)],[0n,4000n]);
  if(qualifyLiquidation) await qualifyReceiver();
  const journal=await replayOrders(rpc,program,roots,vault,await balance(vault),expected);
  assert.deepEqual([journal.fills,journal.transfers,journal.cash,journal.fees,journal.vault],
    qualifyLiquidation?[11,2,'37608','18','37626']:[11,0,'35850','18','35868']);
  const measurements=checks.map(({label,signature,computeUnits,bytes,loadedAccounts,error})=>({label,signature,computeUnits,bytes,loadedAccounts,error}));
  writeFileSync(directory+(qualifyLiquidation?'/slot-liquidation.json':'/slot-orders.json'),JSON.stringify({journal,currentFloor,heldFloor,measurements},null,2));
  console.log('Reconciled signed sparse-order lifecycle',journal);
} finally {await ws.close();}

// Extend the reconciled seven-open/one-flat book from the ordinary trading trace.
async function qualifyReceiver() {
  await send('open separate receiving cross account','open_trade_root',
    [paying(receiver.address),read(custody),write(receiverRoot),read(system)],[u16(65535)],receiver);
  await wallet('redeposit cash for target reservation',cross,1002);
  await place('target resting order before shock',13,false,100,2);
  await wallet('fund receiver order',receiverRoot,1002);
  await place('receiver reserves ninth market',43,false,100,2,false,undefined,receiverRoot);

  async function transfer(label:string,lots:number,price:number,opts:{
    error?:number;omit?:number;actor?:Actor;revision?:number;outcome?:[number,number,number]
  }={}) {
    const selected=8, market=markets.get(selected)!;
    const target=await state(cross), receiving=await state(receiverRoot);
    const marketsNeeded=[...new Set([...target.slots,...receiving.slots].map(slot=>slot.id))]
      .filter(id=>id!==selected && id!==opts.omit).sort((a,b)=>a-b);
    const actor=opts.actor??receiver;
    await send('liquidation: '+label,'transfer_trade_risk',[signer(actor.address),read(custody),read(market),write(cross),write(receiverRoot),
      ...marketsNeeded.map(id=>read(markets.get(id)!))],
      [u64(opts.revision??target.rev),u64(receiving.rev),u64(Number((await h.read(market))!.readBigUInt64LE(42))),u64(lots),u64(price)],actor,opts.error);
    if(opts.outcome) {
      const tx=await rpc.call('getTransaction',[checks.at(-1)!.signature,{commitment:'finalized',maxSupportedTransactionVersion:1}]);
      const signers=tx.transaction.message.accountKeys.slice(0,tx.transaction.message.header.numRequiredSignatures);
      assert.deepEqual(new Set(signers),new Set([keeper.address,receiver.address]));
      assert.equal(tx.meta.returnData.programId,program);
      const result=Buffer.from(tx.meta.returnData.data[0],'base64');
      assert.equal(result.length,40);
      const [before,after,fee]=opts.outcome;
      assert.deepEqual([signed128(result,0),signed128(result,16),result.readBigUInt64LE(32)],
        [BigInt(before)*scale,BigInt(after)*scale,BigInt(fee)]);
    }
  }
  await transfer('refuse healthy cross target',40,100,{error:6011});
  await publish(3,45,2);
  // Maintenance = 225 + 6*500; debts = 5700 on the shocked sibling and 300 flat.
  // With 8852 cash the target is 373 atoms below maintenance. Market 8 stayed at 100.
  await transfer('refuse missing shocked sibling',40,100,{omit:3,error:6003});
  await transfer('refuse missing receiver order market',40,100,{omit:43,error:6003});
  await transfer('refuse without receiver consent',40,100,{actor:trader,error:6008});
  await transfer('refuse stale target revision',40,100,{revision:0,error:6001});
  await transfer('refuse transfer beyond held lots',101,100,{error:6009});
  await transfer('refuse transfer outside index band',40,89,{error:6009});
  // One lot at 96 frees five maintenance atoms, realizes four of loss and costs
  // one fee atom. After fees there is zero improvement, despite fewer lots.
  await transfer('refuse zero progress after fee',1,96,{error:6012});
  await wallet('receiver deposits to one below required cash',receiverRoot,397);
  await transfer('refuse one atom short on receiver including its order',40,100,{error:6013});
  await wallet('receiver deposits final atom',receiverRoot,1);
  await transfer('transfer 40 lots with nine distinct dependencies',40,100,{outcome:[373,175,2]});
  const target=await state(cross), receiving=await state(receiverRoot);
  assert.deepEqual([target.cash,target.remaining,target.slots.find(s=>s.id===8)!.lots,target.slots[0].funding],
    [8850n,0n,60n,2n*scale]);
  assert.deepEqual([receiving.cash,receiving.remaining,receiving.slots[0].lots,receiving.slots.at(-1)!.id],
    [1402n,100n,40n,43]);
  await wallet('receiver cannot spend reserved collateral',receiverRoot,1,true,6007);
  await cancel('receiver releases ninth-market reservation',receiverRoot);
  await transfer('transfer 36 lots to restore maintenance',36,100,{outcome:[175,0,2]});
  await transfer('refuse further liquidation after recovery',1,100,{error:6011});
  const restored=await state(cross);
  assert.deepEqual([restored.cash,restored.slots.filter(s=>s.lots!==0n).length,restored.slots.find(s=>s.id===8)!.lots],
    [8848n,7,24n]);
  await wallet('refuse one over receiver exit',receiverRoot,645,true,6007);
  await wallet('receiver withdraws exact surplus',receiverRoot,644,true);
  assert.deepEqual([(await state(receiverRoot)).cash,await balance(receiverToken.address)],[760n,644n]);
}
