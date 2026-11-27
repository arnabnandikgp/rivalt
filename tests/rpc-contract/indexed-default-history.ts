// Rebuild the frozen book from finalized SQL postings and independently enumerate charges.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {getAddressEncoder,type Address} from '@solana/kit';

type Sql={query(sql:string,args:unknown[]):Promise<{rows:Record<string,string>[]}>};
type Price={id:number;price:bigint;funding:bigint;fees:bigint};
export type Certificate={denominator:number;selected:number;numerators:number[];charges:number[];cash:number[];spent:number[];repaired:boolean;protectedPlans:number;totalPlans:number};
export type Probe={rows:[number,number[]][];positions:[number,number][][];proof:Certificate};
export function reference<T>(input:unknown):T {
  return JSON.parse(execFileSync('python3',['tests/financial/indexed_default_certificate.py'],{input:JSON.stringify(input),encoding:'utf8'}));
}
export function u32(value:number) { const b=Buffer.alloc(4); b.writeUInt32LE(value); return b; }
export function encodeProof(proof:Certificate) {
  return Buffer.concat([u32(proof.denominator),Buffer.from([proof.selected]),u32(proof.numerators.length),...proof.numerators.map(u32)]);
}
export class IndexedReplay {
  private entry=new Map<string,{lots:bigint;price:bigint}>();
  result?:Certificate;
  constructor(readonly custody:Address,readonly keeper:Address,readonly mint:Address,readonly owners:Address[],readonly wallets:Address[],readonly ids:number[],readonly modes:number[]) {}
  registration(data:Buffer) {
    assert.equal(data.readUInt32LE(8),this.owners.length);
    let offset=12;
    for(const [i,owner] of this.owners.entries()) {
      assert.deepEqual(data.subarray(offset,offset+32),Buffer.from(getAddressEncoder().encode(owner)));
      assert.equal(data.readUInt16LE(offset+32),this.modes[i]); offset+=34;
    }
    assert.equal(data.readUInt32LE(offset),this.ids.length); offset+=4;
    assert.deepEqual(this.ids.map((_,i)=>data.readUInt16LE(offset+2*i)),this.ids);
    assert.equal(data.length,offset+2*this.ids.length);
  }
  fill(market:number,trader:Address,maker:Address,delta:bigint,price:bigint) {
    // Each open leg in this workload is one lot. Round trips leave a realized
    // claim in the postings while removing the inventory used to prove capacity.
    for(const [root,signed] of [[trader,delta],[maker,-delta]] as const) {
      const key=root+'/'+market, old=this.entry.get(key);
      if(old) { assert.equal(old.lots+signed,0n); this.entry.delete(key); }
      else { assert.equal(signed<0n?-signed:signed,1n); this.entry.set(key,{lots:signed,price}); }
    }
  }
  async settle(sql:Sql,roots:Address[],prices:Map<Address,Price>,bytes:Buffer,
    post:(root:Address,market:number|null,cash:bigint,lots:bigint,basis:bigint)=>Promise<unknown>) {
    assert(!this.result);
    const markets=[...prices.values()];
    assert.deepEqual(markets.map(m=>m.id),this.ids);
    const rows=[],positions=[],stored=[];
    const scale=1_000_000_000n;
    for(const root of roots) {
      const cash=BigInt((await sql.query('select sum(cash) as cash from postings where root=$1',[root])).rows[0].cash);
      const slots=(await sql.query('select market,sum(lots) as q,sum(basis) as b from postings where root=$1 and market is not null group by market',[root])).rows;
      const claims=[],limits=[];
      for(const market of markets) {
        const slot=slots.find(s=>Number(s.market)===market.id);
        const lots=BigInt(slot?.q??0), scaled=BigInt(slot?.b??0)+lots*(market.price-market.funding)*scale;
        assert.equal(scaled%scale,0n);
        const entry=this.entry.get(root+'/'+market.id), gain=lots*(market.price-(entry?.price??0n)), claim=scaled/scale;
        assert.equal(entry?.lots??0n,lots);
        const cap=claim<gain?claim:gain;
        claims.push(Number(claim)); limits.push([Number(lots),Number(cap>0n?cap:0n)]);
      }
      rows.push([Number(cash),claims]); positions.push(limits); stored.push({root,cash,slots});
    }
    this.result=reference<Certificate>({rows,positions,fees:markets.map(m=>Number(m.fees))});
    assert.deepEqual(bytes.subarray(40),encodeProof(this.result));
    for(const [i,{root,cash,slots}] of stored.entries()) {
      await post(root,null,BigInt(this.result.cash[i])-cash,0n,0n);
      for(const slot of slots) await post(root,Number(slot.market),0n,-BigInt(slot.q),-BigInt(slot.b));
    }
  }
}
