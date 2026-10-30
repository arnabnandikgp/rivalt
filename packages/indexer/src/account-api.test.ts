import {expect, it} from 'vitest';
import {accountApi} from './account-api.js';
import type {LiquidityIndexer} from './liquidity-indexer.js';

it('rejects mixed latest/cursor reads before querying history on both account endpoints',async()=>{
  const row={binding:{venue:'venue',profile:'liquidity-execution-qualification'},state:{sequence:'105'},synced_at:new Date()};
  const queries:{sql:string;params?:unknown[]}[]=[];
  const client={async query(sql:string,params?:unknown[]){
    queries.push({sql,params});
    if(sql.startsWith('SELECT * FROM runs'))return {rows:[row]};
    if(sql.includes('FROM events'))return {rows:(sql.includes('DESC')?['105','104']:['4','5']).map(sequence=>({sequence}))};
    return {rows:[]};
  },release(){}};
  let connections=0;
  const indexer={healthy:true,ws:{error:null},config:{runId:'test'},store:{async snapshot(){return row;},pool:{async connect(){connections++;return client;}}}};
  const app=accountApi(indexer as unknown as LiquidityIndexer);
  try {
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
      expect(latest.json()).toMatchObject({items:[{sequence:'104'},{sequence:'105'}],next:'105'});
      const cursor=await app.inject(`/v4/${endpoint}?latest=false&after=3&limit=2`);
      expect(cursor.statusCode).toBe(200);
      expect(cursor.json()).toMatchObject({items:[{sequence:'4'},{sequence:'5'}],next:'5'});
    }
    const history=queries.filter(query=>query.sql.includes('FROM events'));
    expect(history.map(query=>query.params)).toEqual([['test','0',2],['test','3',2],['test','0',2],['test','3',2]]);
    expect(history.map(query=>query.sql.includes("AND kind='LiquidityRouteExecutedV4'"))).toEqual([false,false,true,true]);
    expect(connections).toBe(4);
    indexer.healthy=false;
    expect((await app.inject('/v4/events?after=3')).statusCode).toBe(503);expect(connections).toBe(4);
  }finally{await app.close();}
});
