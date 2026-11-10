import {expect, it} from 'vitest';
import {accountApi} from './account-api.js';
import {publishedSnapshot} from './store.js';
import type {LiquidityIndexer} from './liquidity-indexer.js';

it('rejects mixed latest/cursor reads before querying history on both account endpoints',async()=>{
  const row={binding:{venue:'venue',profile:'liquidity-execution-qualification'},state:{sequence:'200'},checkpoint:'covered',checkpoint_slot:'20',error:null,
    published_state:{sequence:'105'},published_checkpoint:'published',published_checkpoint_slot:'15',synced_at:new Date()};
  const queries:{sql:string;params?:unknown[]}[]=[];
  const client={async query(sql:string,params?:unknown[]){
    queries.push({sql,params});
    if(sql.startsWith('SELECT * FROM runs'))return {rows:[row]};
    if(sql.includes('FROM events'))return {rows:(sql.includes('DESC')?['105','104']:['4','5']).map(sequence=>({sequence}))};
    return {rows:[]};
  },release(){}};
  let connections=0;
  const indexer={healthy:true,ws:{error:null},config:{runId:'test'},store:{async snapshot(){return row;},async published(){return publishedSnapshot(row);},pool:{async connect(){connections++;return client;}}}};
  const app=accountApi(indexer as unknown as LiquidityIndexer);
  try {
    expect((await app.inject('/ready')).json()).toMatchObject({ready:true,covered:{slot:'20',cursor:'200'},reconciled:{slot:'15',cursor:'105'}});
    for(const endpoint of ['events','trades']) {
      for(const after of ['0','3']) {
        const response=await app.inject(`/v4/${endpoint}?latest=true&after=${after}`);
        expect(response.statusCode).toBe(400);expect(response.json()).toEqual({error:'InvalidRequest'});
      }
    }
    expect(connections).toBe(0);
    for(const endpoint of ['events','trades']) {
      const latest=await app.inject(`/v4/${endpoint}?latest=true&limit=2`);
      expect(latest.statusCode).toBe(200);
      expect(latest.json()).toMatchObject({items:[{sequence:'104'},{sequence:'105'}],next:'105',asOf:{cursor:'105',blockhash:'published',slot:'15'}});
      const cursor=await app.inject(`/v4/${endpoint}?latest=false&after=3&limit=2`);
      expect(cursor.statusCode).toBe(200);
      expect(cursor.json()).toMatchObject({items:[{sequence:'4'},{sequence:'5'}],next:'5'});
    }
    const history=queries.filter(query=>query.sql.includes('FROM events'));
    expect(history.map(query=>query.params)).toEqual([['test','0',2,'105'],['test','3',2,'105'],['test','0',2,'105'],['test','3',2,'105']]);
    expect(history.map(query=>query.sql.includes("AND kind='LiquidityRouteExecutedV4'"))).toEqual([false,false,true,true]);
    expect(history.every(query=>query.sql.includes('sequence<=$4'))).toBe(true);
    expect(connections).toBe(4);
    row.synced_at=new Date(Date.now()-11_000);
    expect((await app.inject('/v4/events')).statusCode).toBe(503);expect(connections).toBe(4);
    row.synced_at=new Date();indexer.healthy=false;
    expect((await app.inject('/v4/events?after=3')).statusCode).toBe(503);expect(connections).toBe(4);
  }finally{await app.close();}
});
