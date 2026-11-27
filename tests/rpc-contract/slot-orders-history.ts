// Independent finalized projection. For a position with lots q and stored claim v,
// B = v + q * checkpoint is invariant under accrual. With a signed fill of d lots
// at execution price P and funding index F, its change is d * (F - P).
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {getBase58Encoder, type Address} from '@solana/kit';
import {DefaultReplay, type DefaultJournal} from './three-market-default-history.js';
import type {IndexedReplay} from './indexed-default-history.js';
import type {WireRpc} from './wire.js';

export const fingerprint = (s:string) => createHash('sha256').update(s).digest().subarray(0,8);
const methods = ['open_trade_market','publish_trade_market','deposit_trade_cash','withdraw_trade_cash',
  'place_trade_order','cancel_trade_order','fill_trade_order','transfer_trade_risk'] as const;
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
  expected:Map<string,number>, configuration?:DefaultJournal, indexed?:IndexedReplay) {
  const resolution=configuration && new DefaultReplay(configuration);
  const replayMethods:readonly string[]=indexed?[...methods,'open_slot_custody','open_trade_root','register_indexed_book','settle_indexed_book','inspect_indexed_book']:resolution?[...methods,'open_slot_custody','open_trade_root','configure_default','freeze_default','apply_default','apply_competing_default']:methods;
  let appliedCommitment:Buffer|undefined, cutoff:bigint|undefined;
  const url=new URL(process.env.RIVALT_DATABASE_URL!);
  assert.equal(url.hostname,'127.0.0.1');
  const pg=createRequire(new URL('../../packages/indexer/package.json',import.meta.url))('pg');
  const admin=new pg.Client({connectionString:url.href});
  await admin.connect();
  try {await admin.query('create database rivalt_order_replay');} finally {await admin.end();}
  url.pathname='/rivalt_order_replay';
  const sql=new pg.Client({connectionString:url.href});
  const prices=new Map<Address,{id:number;price:bigint;funding:bigint;fees:bigint}>();
  const orders=new Map<Address,{sell:boolean;prefix:bigint;remaining:bigint;market:number;limit:bigint;feeLeft:bigint;reduce:boolean;expiry:bigint}>();
  const observed=new Map<string,number>();
  let fills=0, transfers=0;
  // Value every SQL-reconstructed position at its own current index. A flat
  // negative basis remains debt. The rounded requirement is per market.
  async function riskAt(root:Address) {
    const cashRow=await sql.query('select coalesce(sum(cash),0) as cash from postings where root=$1',[root]);
    const cash=BigInt(cashRow.rows[0].cash);
    let equity=cash*scale, maintenance=0n, initial=0n;
    const holdings=new Map<number,bigint>();
    const rows=await sql.query('select market,sum(lots) as lots,sum(basis) as basis from postings where root=$1 and market is not null group by market',[root]);
    for(const row of rows.rows) {
      const market=[...prices.values()].find(m=>m.id===row.market)!;
      const lots=BigInt(row.lots), size=lots<0n?-lots:lots;
      holdings.set(row.market,lots);
      const claim=BigInt(row.basis)+lots*(market.price-market.funding)*scale;
      if(claim<0n) equity+=claim;
      maintenance+=(size*market.price+19n)/20n;
      initial+=(size*market.price+9n)/10n;
    }
    const shortfall=maintenance*scale-equity;
    return {cash,equity,initial,holdings,deficit:shortfall>0n?shortfall:0n};
  }
  try {
    await sql.connect();
    await sql.query('create table postings(signature text, root text, market int, cash numeric, lots numeric, basis numeric, unique nulls not distinct(signature,root,market))');
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
        const name=replayMethods.find(method=>bytes.subarray(0,8).equals(fingerprint('global:'+method)));
        if(!name) continue;
        assert(tx.slot>lastSlot,'ambiguous financial receipt order'); lastSlot=tx.slot;
        const code=tx.meta.err?.InstructionError[1].Custom??0;
        observed.set(signature,code);
        if(code) continue;
        assert.equal(tx.meta.err,null);
        const keys:Address[]=call.accounts.map((index:number)=>msg.accountKeys[index]);
        const post=(root:Address,market:number|null,cash:bigint,lots:bigint,basis:bigint)=>
          sql.query('insert into postings values($1,$2,$3,$4,$5,$6)',[signature,root,market,cash.toString(),lots.toString(),basis.toString()]);
        if(indexed) {
          const signers=msg.accountKeys.slice(0,msg.header.numRequiredSignatures);
          if(name==='register_indexed_book') { assert.equal(keys[1],indexed.custody); assert(signers.includes(keys[0])); indexed.registration(bytes); }
          if(name==='settle_indexed_book') {
            assert.deepEqual(keys,[indexed.custody,vault,...roots,...prices.keys()]);
            assert.deepEqual(signers,[indexed.keeper]); assert.equal(orders.size,0);
            await indexed.settle(sql,roots,prices,bytes,post);
            appliedCommitment=bytes.subarray(8,40);
          }
          if(name==='withdraw_trade_cash' || name==='deposit_trade_cash') {
            const i=roots.indexOf(keys[2]); assert(i>=0);
            assert.equal(keys[0],indexed.owners[i]); assert(signers.includes(keys[0]));
            assert.equal(keys[3],indexed.mint); assert.equal(keys[5],indexed.wallets[i]);
          }
        }
        if(configuration && resolution) {
          const signers:Address[]=msg.accountKeys.slice(0,msg.header.numRequiredSignatures);
          if(name==='configure_default') {
            assert.equal(keys[1],configuration.custody); assert(signers.includes(keys[0]));
            for(const [i,owner] of configuration.owners.entries()) {
              assert.deepEqual(bytes.subarray(8+i*32,40+i*32),Buffer.from(getBase58Encoder().encode(owner)));
            }
            assert.deepEqual(configuration.ids.map((_,i)=>bytes.readUInt16LE(168+i*2)),configuration.ids);
          }
          if(name==='freeze_default' || name==='apply_default' || name==='apply_competing_default') {
            assert.deepEqual(signers,[configuration.keeper]);
            assert.deepEqual(keys,[configuration.custody,vault,...roots,...prices.keys()]);
            assert.equal(orders.size,0);
            if(name==='freeze_default') {
              assert.equal(cutoff,undefined); cutoff=BigInt(tx.slot);
              await resolution.freeze(sql,roots,prices,cutoff);
            } else {
              appliedCommitment=bytes.subarray(8,40);
              assert.equal(name,configuration.competing?'apply_competing_default':'apply_default');
              assert.equal(bytes.length,configuration.competing?56:48);
              const charges=configuration.competing?[bytes.readBigUInt64LE(40),bytes.readBigUInt64LE(48)]:[bytes.readBigUInt64LE(40)];
              await resolution.apply(sql,roots,charges,post);
            }
          }
          if(name==='withdraw_trade_cash' || name==='deposit_trade_cash') {
            const member=roots.indexOf(keys[2]); assert(member>=0);
            assert.equal(keys[0],configuration.owners[member]); assert(signers.includes(keys[0]));
            assert.equal(keys[3],configuration.mint); assert.equal(keys[5],configuration.wallets[member]);
          }
        }
        if(name==='open_trade_market') prices.set(keys[2],{id:bytes.readUInt16LE(8),price:100n,funding:0n,fees:0n});
        if(name==='publish_trade_market') {
          const market=prices.get(keys[2])!;
          market.price=bytes.readBigUInt64LE(16); market.funding=bytes.readBigInt64LE(24);
        }
        if(name==='place_trade_order') orders.set(keys[2],{sell:bytes[18]===1,prefix:0n,remaining:bytes.readBigUInt64LE(19),market:bytes.readUInt16LE(16),limit:bytes.readBigUInt64LE(27),feeLeft:bytes.readBigUInt64LE(35),expiry:bytes.readBigUInt64LE(43),reduce:Boolean(bytes[51])});
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
          order.prefix+=gross; order.remaining-=lots; order.feeLeft-=fee;
          if(order.remaining===0n) orders.delete(trader);
          const signed=order.sell?-lots:lots, basis=signed*(market.funding-market.price)*scale;
          await post(trader,market.id,-fee,signed,basis);
          await post(maker,market.id,0n,-signed,-basis);
          if(resolution) { assert.equal(trader,roots[0]); resolution.fill(market.id,trader,maker,signed,market.price); }
          indexed?.fill(market.id,trader,maker,signed,market.price);
          market.fees+=fee; fills++;
        }
        if(name==='transfer_trade_risk') {
          const [,,marketKey,target,receiver]=keys, market=prices.get(marketKey)!;
          const lots=bytes.readBigUInt64LE(32), execution=bytes.readBigUInt64LE(40);
          const before=await riskAt(target), held=before.holdings.get(market.id)!;
          assert(before.deficit>0n && lots>0n && lots<=(held<0n?-held:held));
          assert(execution*10n>=market.price*9n && execution*10n<=market.price*11n);
          const gross=lots*execution, rawFee=(gross+1999n)/2000n;
          const fee=[rawFee,10_000n,before.cash].reduce((a,b)=>a<b?a:b);
          const received=held>0n?lots:-lots;
          const basis=received*(market.funding-execution)*scale;
          await post(target,market.id,-fee,-received,-basis);
          await post(receiver,market.id,fee,received,basis);
          const after=await riskAt(target), receiving=await riskAt(receiver);
          assert(after.deficit<before.deficit);
          let receiverReserve=0n;
          for(const [root,account] of [[target,after],[receiver,receiving]] as const) {
            const order=orders.get(root);
            if(!order) continue;
            const position=account.holdings.get(order.market)??0n;
            if(BigInt(tx.slot)>=order.expiry || (root===target && !order.reduce)
              || (order.reduce && (position===0n || order.sell!==(position>0n)))) {
              orders.delete(root); continue;
            }
            if(root===receiver) {
              const source=[...prices.values()].find(m=>m.id===order.market)!;
              const size=position<0n?-position:position;
              const eligible=order.reduce && size<order.remaining?size:order.remaining;
              const adverse=order.sell?source.price-order.limit:order.limit-source.price;
              receiverReserve=order.feeLeft+eligible*((adverse>0n?adverse:0n)+(order.reduce?0n:(source.price+9n)/10n));
            }
          }
          assert(receiving.equity>=(receiving.initial+receiverReserve)*scale);
          assert.equal(tx.meta.returnData.programId,program);
          const returned=Buffer.from(tx.meta.returnData.data[0],'base64');
          assert.equal(returned.length,40);
          assert.deepEqual([signed128(returned,0),signed128(returned,16),returned.readBigUInt64LE(32)],
            [before.deficit,after.deficit,fee]);
          transfers++;
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
    if(indexed) {
      const data=await read(indexed.custody);
      assert.deepEqual(data.subarray(0,8),fingerprint('account:IndexedCustody'));
      assert.equal(data[73],2); assert.deepEqual(data.subarray(476,508),appliedCommitment);
      assert.equal(data[508],indexed.result!.selected);
      assert.equal(Boolean(data[701]),indexed.result!.repaired);
      for(let m=0;m<8;m++) assert.equal(data.readBigUInt64LE(637+8*m),BigInt(indexed.result!.spent[m]??0));
      const split=indexed.result!.split;
      assert.equal(data[702],Number(Boolean(split)));
      if(split) {
        assert.equal(data.readUInt16LE(703),split.market);
        assert.deepEqual([...data.subarray(705,707)],split.members);
        assert.deepEqual([707,715].map(offset=>Number(data.readBigUInt64LE(offset))),split.charges);
        assert.deepEqual([723,731].map(offset=>Number(data.readBigUInt64LE(offset))),split.lots);
      }
      for(let m=0;m<8;m++) {
        const charge:bigint=BigInt(indexed.result!.charges[m]??0);
        assert.equal(data.readBigUInt64LE(509+8*m),charge);
        const matched:bigint=split && split.market===indexed.ids[m]?BigInt(split.lots.reduce((a,b)=>a+b,0)):BigInt(charge>0n);
        assert.equal(data.readBigUInt64LE(573+8*m),matched);
      }
    }
    const settlement=resolution?.outcome();
    if(configuration && settlement) {
      const custody=await read(configuration.custody);
      assert.deepEqual(custody.subarray(0,8),fingerprint('account:ResolutionCustody'));
      assert.equal(custody[73],3);
      assert.deepEqual(custody.subarray(336,368),appliedCommitment);
      assert.equal(custody.readBigUInt64LE(368),cutoff);
      assert.equal(custody.readBigUInt64LE(384),BigInt(settlement.charge));
      assert.equal(custody.readBigUInt64LE(392),BigInt(settlement.matched));
      assert.deepEqual(roots.map((_,i)=>String(custody.readBigUInt64LE(400+8*i))),settlement.payouts);
    }
    for(const [address,market] of prices) {
      const bytes=await read(address);
      assert.deepEqual(bytes.subarray(0,8),fingerprint('account:TradingMarket'));
      assert.equal(bytes.readBigUInt64LE(50),market.price);
      assert.equal(signed128(bytes,58),market.funding*scale);
      assert.equal(bytes.readBigUInt64LE(82),market.fees-market.fees/4n);
      const spent=settlement && configuration?BigInt(settlement.spent[configuration.ids.indexOf(market.id)]):indexed?BigInt(indexed.result!.spent[indexed.ids.indexOf(market.id)]):0n;
      assert.equal(bytes.readBigUInt64LE(90),market.fees/4n-spent); assert.equal(bytes[98],Number(market.fees%4n));
      fees+=market.fees-spent;
    }
    assert.equal(cashTotal+fees,vaultBalance);
    return {...(settlement?{settlement}:{}),receipts:observed.size,fills,transfers,cash:cashTotal.toString(),fees:fees.toString(),vault:vaultBalance.toString()};
  } finally {await sql.end();}
}
