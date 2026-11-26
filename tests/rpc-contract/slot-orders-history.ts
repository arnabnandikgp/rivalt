// Independent finalized projection. For a position with lots q and stored claim v,
// B = v + q * checkpoint is invariant under accrual. With a signed fill of d lots
// at execution price P and funding index F, its change is d * (F - P).
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {getBase58Encoder, type Address} from '@solana/kit';
import type {WireRpc} from './wire.js';

export const fingerprint = (s:string) => createHash('sha256').update(s).digest().subarray(0,8);
const methods = ['open_trade_market','publish_trade_market','deposit_trade_cash','withdraw_trade_cash',
  'place_trade_order','cancel_trade_order','fill_trade_order'] as const;
const scale=1_000_000_000n;
export function signed128(bytes:Buffer,start:number) {
  return bytes.readBigUInt64LE(start)+(bytes.readBigInt64LE(start+8)<<64n);
}
export function readRoot(bytes:Buffer) {
  assert.deepEqual(bytes.subarray(0,8),fingerprint('account:TradingMargin'));
  const count=bytes.readUInt32LE(166);
  assert(bytes.length===170+98*(bytes.readUInt16LE(72)===65535?8:1) && count<=(bytes.length-170)/98);
  const slots=Array.from({length:count},(_,index)=>{
    const pos=170+index*98;
    return {id:bytes.readUInt16LE(pos),incarnation:bytes.readBigUInt64LE(pos+2),lots:bytes.readBigInt64LE(pos+10),
      virtual:signed128(bytes,pos+18),funding:signed128(bytes,pos+34),generation:bytes.readBigUInt64LE(pos+50),
      entryLow:signed128(bytes,pos+58),entryHigh:signed128(bytes,pos+74),reference:bytes.readBigUInt64LE(pos+90)};
  });
  return {rev:Number(bytes.readBigUInt64LE(74)),cash:bytes.readBigUInt64LE(82),last:bytes.readBigUInt64LE(90),
    remaining:bytes.readBigUInt64LE(134),slots};
}

export async function replayOrders(rpc:WireRpc,program:Address,roots:Address[],vault:Address,vaultBalance:bigint,
  expected:Map<string,number>) {
  const url=new URL(process.env.RIVALT_DATABASE_URL!);
  assert.equal(url.hostname,'127.0.0.1');
  const pg=createRequire(new URL('../../packages/indexer/package.json',import.meta.url))('pg');
  const admin=new pg.Client({connectionString:url.href});
  await admin.connect();
  try {await admin.query('create database rivalt_order_replay');} finally {await admin.end();}
  url.pathname='/rivalt_order_replay';
  const sql=new pg.Client({connectionString:url.href});
  const prices=new Map<Address,{id:number;price:bigint;funding:bigint;fees:bigint}>();
  const orders=new Map<Address,{sell:boolean;prefix:bigint;remaining:bigint;market:number}>();
  const observed=new Map<string,number>();
  let fills=0;
  try {
    await sql.connect();
    await sql.query('create table postings(signature text, root text, market int, cash numeric, lots numeric, basis numeric, primary key(signature,root))');
    const history:string[]=[];
    for(;;) {
      const page=await rpc.call('getSignaturesForAddress',[program,{limit:100,commitment:'finalized',before:history.at(-1)}]);
      history.push(...page.map((row:{signature:string})=>row.signature));
      if(page.length<100) break;
    }
    // The supervised workload finalizes each financial transaction before the next.
    let lastSlot=-1;
    for(const signature of history.reverse()) {
      const tx=await rpc.call('getTransaction',[signature,{commitment:'finalized',maxSupportedTransactionVersion:1}]);
      const msg=tx.transaction.message;
      assert.equal(tx.transaction.signatures[0],signature);
      for(const call of msg.instructions) {
        if(msg.accountKeys[call.programIdIndex]!==program) continue;
        const bytes=Buffer.from(getBase58Encoder().encode(call.data));
        const name=methods.find(method=>bytes.subarray(0,8).equals(fingerprint('global:'+method)));
        if(!name) continue;
        assert(tx.slot>lastSlot,'ambiguous financial receipt order'); lastSlot=tx.slot;
        const code=tx.meta.err?.InstructionError[1].Custom??0;
        observed.set(signature,code);
        if(code) continue;
        assert.equal(tx.meta.err,null);
        const keys:Address[]=call.accounts.map((index:number)=>msg.accountKeys[index]);
        const post=(root:Address,market:number|null,cash:bigint,lots:bigint,basis:bigint)=>
          sql.query('insert into postings values($1,$2,$3,$4,$5,$6)',[signature,root,market,cash.toString(),lots.toString(),basis.toString()]);
        if(name==='open_trade_market') prices.set(keys[2],{id:bytes.readUInt16LE(8),price:100n,funding:0n,fees:0n});
        if(name==='publish_trade_market') {
          const market=prices.get(keys[2])!;
          market.price=bytes.readBigUInt64LE(16); market.funding=bytes.readBigInt64LE(24);
        }
        if(name==='place_trade_order') orders.set(keys[2],{sell:bytes[18]===1,prefix:0n,remaining:bytes.readBigUInt64LE(19),market:bytes.readUInt16LE(16)});
        if(name==='cancel_trade_order') assert(orders.delete(keys[2]));
        if(name==='deposit_trade_cash'||name==='withdraw_trade_cash') {
          const amount=bytes.readBigUInt64LE(16),delta=name==='deposit_trade_cash'?amount:-amount;
          assert.equal(keys[4],vault);
          for(const [idx,change] of [[4,delta],[5,-delta]] as const) {
            const amountAt=(rows:{accountIndex:number;uiTokenAmount:{amount:string}}[])=>
              BigInt(rows.find(row=>row.accountIndex===call.accounts[idx])!.uiTokenAmount.amount);
            assert.equal(amountAt(tx.meta.postTokenBalances)-amountAt(tx.meta.preTokenBalances),change);
          }
          await post(keys[2],null,delta,0n,0n);
        }
        if(name==='fill_trade_order') {
          const [,,marketKey,trader,maker]=keys, market=prices.get(marketKey)!, order=orders.get(trader)!;
          const lots=bytes.readBigUInt64LE(32),gross=lots*market.price;
          assert.equal(market.id,order.market); assert(lots<=order.remaining);
          const fee=(order.prefix+gross+4999n)/5000n-(order.prefix+4999n)/5000n;
          order.prefix+=gross; order.remaining-=lots;
          if(order.remaining===0n) orders.delete(trader);
          const signed=order.sell?-lots:lots, basis=signed*(market.funding-market.price)*scale;
          await post(trader,market.id,-fee,signed,basis);
          await post(maker,market.id,0n,-signed,-basis);
          market.fees+=fee; fills++;
        }
      }
    }
    assert.deepEqual(observed,expected);
    assert.equal(orders.size,0);
    const read=async(addr:Address)=>Buffer.from((await rpc.call('getAccountInfo',[addr,{encoding:'base64',commitment:'finalized'}])).value.data[0],'base64');
    let cashTotal=0n, fees=0n;
    for(const addr of roots) {
      const root=readRoot(await read(addr));
      const money=await sql.query('select coalesce(sum(cash),0) as v from postings where root=$1',[addr]);
      assert.equal(root.cash,BigInt(money.rows[0].v)); cashTotal+=root.cash;
      const positions=await sql.query('select market,sum(lots) as q,sum(basis) as b from postings where root=$1 and market is not null group by market order by market',[addr]);
      const live=positions.rows.filter((row:{q:string;b:string})=>BigInt(row.q)!==0n||BigInt(row.b)!==0n);
      assert.equal(live.length,root.slots.length);
      for(const [i,row] of live.entries()) {
        const slot=root.slots[i]; assert.equal(slot.id,row.market); assert.equal(slot.lots,BigInt(row.q));
        assert.equal(slot.virtual+slot.lots*slot.funding,BigInt(row.b));
      }
    }
    for(const [address,market] of prices) {
      const bytes=await read(address);
      assert.deepEqual(bytes.subarray(0,8),fingerprint('account:TradingMarket'));
      assert.equal(bytes.readBigUInt64LE(50),market.price);
      assert.equal(signed128(bytes,58),market.funding*scale);
      assert.equal(bytes.readBigUInt64LE(82),market.fees-market.fees/4n);
      assert.equal(bytes.readBigUInt64LE(90),market.fees/4n); assert.equal(bytes[98],Number(market.fees%4n));
      fees+=market.fees;
    }
    assert.equal(cashTotal+fees,vaultBalance);
    return {receipts:observed.size,fills,cash:cashTotal.toString(),fees:fees.toString(),vault:vaultBalance.toString()};
  } finally {await sql.end();}
}
