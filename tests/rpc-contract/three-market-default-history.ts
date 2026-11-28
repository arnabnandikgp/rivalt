// Project the authenticated frozen book from prior finalized instructions and SQL postings.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {getAddressEncoder,type Address} from '@solana/kit';

type Sql = {query(query:string, params:unknown[]):Promise<{rows:Record<string,string>[]} >};
type Price = {id:number;price:bigint;funding:bigint;fees:bigint};
type Winner = {id:string;charge:string;matched:string;weight:string;baseTicks:string;extraTickLots:string};
type Outcome = {winners?:Winner[];protectedControls?:Record<string,boolean>;charge:string;matched:string;enumerated:number;feasible:number;before:string[];payouts:string[];spent:string[]};
export type DefaultJournal = {
  custody:Address; keeper:Address; owners:Address[]; wallets:Address[]; mint:Address; ids:number[]; competing:boolean;
};
export class DefaultReplay {
  private entries=new Map<Address,{lots:bigint;cost:bigint;reference:bigint}>();
  private frozen?:Outcome;
  private applied=false;
  constructor(readonly config:DefaultJournal) {}

  // Derive both sides' surviving entry from the actual signed BTC fills.
  // A reduction retains the previous basis. These fixtures have integral entry costs.
  fill(market:number, trader:Address, maker:Address, lots:bigint, price:bigint) {
    if(market!==this.config.ids[0]) return;
    const abs=(value:bigint)=>value<0n?-value:value;
    for(const [member,delta] of [[trader,lots],[maker,-lots]] as const) {
      const old=this.entries.get(member);
      const next=(old?.lots??0n)+delta;
      if(next===0n) { this.entries.delete(member); continue; }
      if(!old || old.lots*next<0n) {
        this.entries.set(member,{lots:next,cost:abs(delta)*price,reference:abs(delta)});
      } else if(old.lots*delta<0n) {
        old.lots=next;
      } else {
        const oldCost=old.cost*abs(old.lots);
        assert.equal(oldCost%old.reference,0n,'fractional entry beyond this replay workload');
        this.entries.set(member,{lots:next,cost:oldCost/old.reference+abs(delta)*price,reference:abs(next)});
      }
    }
  }
  async freeze(sql:Sql,roots:Address[],prices:Map<Address,Price>,slot:bigint) {
    assert(!this.frozen && this.entries.size>0);
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
      const basis=this.entries.get(root);
      assert.equal(lots,basis?.lots??0n);
      if(basis) {
        const cost=basis.cost*scale;
        assert(cost>=0n && cost<1n<<64n);
        entry.writeBigUInt64LE(cost,0); entry.writeBigUInt64LE(cost,16); entry.writeBigUInt64LE(basis.reference,32);
      }
      positions.push({member:id,lots:String(lots),entry_bytes:[...entry]});
    }
    for(const market of prices.values()) vault+=market.fees;
    const target={market:markets[0].id,mark:String([...prices.values()][0].price),positions};
    const book={rows,markets,roster:rows.map(r=>r.id),vault:String(vault),
      ...(this.config.competing?{competition:{...target,episode:String(slot),venue:[...getAddressEncoder().encode(this.config.custody)]}}
        :{reduction:{...target,debtor:'1',winner:'0'}})};
    this.frozen=JSON.parse(execFileSync('python3',['tests/financial/signed_default_reference.py'],{input:JSON.stringify(book),encoding:'utf8'}));
  }
  async apply(sql:Sql,roots:Address[],charges:bigint[],post:(root:Address,market:number|null,cash:bigint,lots:bigint,basis:bigint)=>Promise<unknown>) {
    assert(this.frozen && !this.applied);
    assert.deepEqual(charges,this.frozen.winners?.map(w=>BigInt(w.charge))??[BigInt(this.frozen.charge)]);
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
