// Project the authenticated frozen book from prior finalized instructions and SQL postings.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import type {Address} from '@solana/kit';

type Sql = {query(query:string, params:unknown[]):Promise<{rows:Record<string,string>[]} >};
type Price = {id:number;price:bigint;funding:bigint;fees:bigint};
type Outcome = {charge:string;matched:string;enumerated:number;feasible:number;before:string[];payouts:string[];spent:string[]};
export type DefaultJournal = {
  custody:Address; keeper:Address; owners:Address[]; wallets:Address[]; mint:Address; ids:number[];
};
export class DefaultReplay {
  private targetLots=0n;
  private targetCost=0n;
  private frozen?:Outcome;
  private applied=false;
  constructor(readonly config:DefaultJournal) {}

  // The signed book uses exact-price openings and full closes. Reconstruct its
  // current entry independently so a prior realized loss stays separate.
  fill(market:number, lots:bigint, price:bigint) {
    if(market!==this.config.ids[0]) return;
    if(lots>0n) this.targetCost+=lots*price;
    else {
      assert.equal(-lots,this.targetLots);
      this.targetCost=0n;
    }
    this.targetLots+=lots;
  }
  async freeze(sql:Sql,roots:Address[],prices:Map<Address,Price>) {
    assert(!this.frozen && this.targetLots>0n);
    const scale=1_000_000_000n;
    const markets=Array.from(prices.values(),m=>({id:m.id,pool:'0',insurance:String(m.fees/4n),fees:String(m.fees-m.fees/4n)}));
    assert.deepEqual(markets.map(m=>m.id),this.config.ids);
    const rows=[], positions=[];
    let vault=0n;
    for(const [index,root] of roots.entries()) {
      const id=String(index);
      const cash=(await sql.query('select sum(cash) as cash from postings where root=$1',[root])).rows[0].cash;
      vault+=BigInt(cash);
      const entries=(await sql.query('select market,sum(lots) as q,sum(basis) as b from postings where root=$1 and market is not null group by market',[root])).rows;
      const claims=Array.from(prices.values(),m=>{
        const row=entries.find(r=>Number(r.market)===m.id);
        return row?String(BigInt(row.b)+BigInt(row.q)*(m.price-m.funding)*scale):'0';
      });
      rows.push({id,cash,claims});
      const lots=BigInt(entries.find(r=>Number(r.market)===markets[0].id)?.q??0);
      const entry=Buffer.alloc(40);
      if(lots!==0n) {
        assert.equal(lots,index===0?this.targetLots:-this.targetLots);
        // Both sides of the still-open pair entered at the same price.
        const cost=this.targetCost*scale;
        assert(cost>=0n && cost<1n<<64n);
        entry.writeBigUInt64LE(cost,0); entry.writeBigUInt64LE(cost,16); entry.writeBigUInt64LE(this.targetLots,32);
      }
      positions.push({member:id,lots:String(lots),entry_bytes:[...entry]});
    }
    for(const market of prices.values()) vault+=market.fees;
    const book={rows,markets,roster:rows.map(r=>r.id),vault:String(vault),
      reduction:{market:markets[0].id,mark:String([...prices.values()][0].price),debtor:'1',winner:'0',positions}};
    this.frozen=JSON.parse(execFileSync('python3',['tests/financial/signed_default_reference.py'],{input:JSON.stringify(book),encoding:'utf8'}));
  }
  async apply(sql:Sql,roots:Address[],charge:bigint,post:(root:Address,market:number|null,cash:bigint,lots:bigint,basis:bigint)=>Promise<unknown>) {
    assert(this.frozen && !this.applied);
    assert.equal(charge,BigInt(this.frozen.charge));
    this.applied=true;
    for(const [i,root] of roots.entries()) {
      const cash=(await sql.query('select sum(cash) as cash from postings where root=$1',[root])).rows[0].cash;
      await post(root,null,BigInt(this.frozen.payouts[i])-BigInt(cash),0n,0n);
      const positions=(await sql.query('select market,sum(lots) as q,sum(basis) as b from postings where root=$1 and market is not null group by market',[root])).rows;
      for(const row of positions) await post(root,Number(row.market),0n,-BigInt(row.q),-BigInt(row.b));
    }
  }
  outcome() {
    assert(this.applied && this.frozen);
    return this.frozen;
  }
}
