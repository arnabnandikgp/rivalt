import assert from 'node:assert/strict';
import type { Indexer } from '../../packages/indexer/src/index.js';
import { samePrice } from './price-ratio.js';
import { api } from '../../packages/indexer/src/api.js';

/** Real PostgreSQL event history, independent numeric ordering and OHLC expectations. */
export async function verifyReads(indexer:Indexer){
  const rows=(await indexer.store.pool.query('SELECT sequence::text,kind,block_time::text FROM events WHERE run_id=$1',[indexer.config.runId])).rows;
  rows.sort((a,b)=>BigInt(a.sequence)<BigInt(b.sequence)?-1:1);
  assert(rows.some(x=>BigInt(x.sequence)>=100n),'Exercise must cross the decimal sequence boundary');
  const app=api(indexer),read=async(url:string)=>{const r=await app.inject({method:'GET',url});assert.equal(r.statusCode,200);return r.json();};
  try{
    for(const endpoint of ['events','trades']){
      const expected=rows.filter(x=>endpoint==='events'||x.kind==='route').map(x=>x.sequence);
      for(const boundary of ['0','9','99','999','9999','99999'].filter(x=>BigInt(x)<BigInt(expected.at(-1)!))){
        let cursor=boundary;
        for(let pageNumber=0;pageNumber<2;pageNumber++){
          const page=await read(`/v1/${endpoint}?after=${cursor}&limit=7`),want=expected.filter(x=>BigInt(x)>BigInt(cursor)).slice(0,7);
          assert.deepEqual(page.items.map((x:any)=>x.sequence),want,`${endpoint} numeric cursor order`);
          if(!want.length)break;assert.equal(page.next,want.at(-1));cursor=page.next;
        }
      }
      const latest=await read(`/v1/${endpoint}?latest=true&limit=10`);assert.deepEqual(latest.items.map((x:any)=>x.sequence),expected.slice(-10),`${endpoint} latest numeric order`);
    }
    const trades=rows.filter(x=>x.kind==='route'),end=Math.max(...trades.filter(x=>x.block_time!==null).map(x=>Number(x.block_time)))+1,from=Math.max(0,end-3600);
    const window=(await indexer.store.pool.query("SELECT sequence::text,payload,block_time::text FROM events WHERE run_id=$1 AND kind='route' AND block_time >= $2 AND block_time < $3",[indexer.config.runId,from,end])).rows.sort((a,b)=>BigInt(a.sequence)<BigInt(b.sequence)?-1:1),groups=new Map<number,typeof trades>();
    for(const row of window){const minute=Math.floor(Number(row.block_time)/60)*60;groups.set(minute,[...(groups.get(minute)??[]),row]);}
    const price=(x:any)=>({numerator:x.payload.grossQuote,denominator:x.payload.lots});
    const expected=[...groups].sort(([a],[b])=>a-b).map(([start,values])=>{
      const sorted=[...values].sort((a,b)=>{const d=BigInt(a.payload.grossQuote)*BigInt(b.payload.lots)-BigInt(b.payload.grossQuote)*BigInt(a.payload.lots);return d<0n?-1:d>0n?1:0;});
      return {start:String(start),open:price(values[0]),high:price(sorted.at(-1)),low:price(sorted[0]),close:price(values.at(-1)),volumeLots:values.reduce((n,x)=>n+BigInt(x.payload.lots),0n).toString(),volumeQuote:values.reduce((n,x)=>n+BigInt(x.payload.grossQuote),0n).toString(),trades:values.length};
    });
    const candles=await read(`/v1/candles?from=${from}&to=${end}`);assert.equal(candles.items.length,expected.length);for(const [i,want] of expected.entries()){const got=candles.items[i];assert(samePrice(got.high,want.high)&&samePrice(got.low,want.low),'Exact candle extreme values');assert.deepEqual({...got,high:want.high,low:want.low},want);}assert.equal(candles.unplacedTrades,trades.filter(x=>x.block_time===null).length);
    return {result:'pass',events:rows.length,trades:trades.length,lastSequence:rows.at(-1)!.sequence,candles:expected.length,method:'Actual PostgreSQL rows through Fastify handlers; independent BigInt sequence sort and per-minute price ordering; forward pages at every reached decimal boundary and latest pagination across sequence 100'};
  }finally{await app.close();}
}
