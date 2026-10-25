import {expect, it} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {groupApi} from './group-api.js';
import type {GroupIndexer} from './group-indexer.js';
import {json} from './events.js';

it('reads the canonical on-chain Clock and labels funding previews without granting exits', async () => {
  const margin=sdk.CLEARING_PROGRAM_ADDRESS, rootDecoder=sdk.getMarginAccountV2Decoder(), marketDecoder=sdk.getGroupMarketV2Decoder();
  const root={...rootDecoder.decode(new Uint8Array(rootDecoder.fixedSize)),schemaVersion:2,mode:0,isolatedMarketIndex:255,cash:1000n};
  const markets=[0,1].map(index=>({...marketDecoder.decode(new Uint8Array(marketDecoder.fixedSize)),schemaVersion:2,index}));
  const row=JSON.parse(json({binding:{schema:2,group:margin,anchor:'anchor',genesis:'genesis',domain:'domain',profile:'cross-safety-qualification'},
    checkpoint:'signature',checkpoint_slot:'10',state:{sequence:'2',group:{mode:2,paused:false,markets:['btc','eth']},roots:{[margin]:root},markets:{btc:markets[0],eth:markets[1]}}}));
  row.synced_at=new Date();
  const clock=Buffer.alloc(40);clock.writeBigUInt64LE(12n,0);clock.writeBigInt64LE(101n,32);
  let calls=0;
  const indexer={healthy:true,ws:{error:null},config:{runId:'test'},store:{async snapshot(){return row;}},rpc:{async call(method:string,params:any[]){
    expect(method).toBe('getAccountInfo');expect(params).toEqual(['SysvarC1ock11111111111111111111111111111111',{encoding:'base64',commitment:'finalized',minContextSlot:10}]);
    calls++;return {context:{slot:12},value:{owner:'Sysvar1111111111111111111111111111111111111',data:[clock.toString('base64'),'base64']}};
  }}};
  const app=groupApi(indexer as unknown as GroupIndexer);
  try {
    const response=await app.inject({method:'GET',url:`/v2/accounts/${margin}`});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({schemaVersion:2,clockSource:'finalized-rpc-sysvar',clockContextSlot:'12',
      asOf:{commitment:'finalized',sequence:'2'},view:{cash:'1000',riskEquityScaled:'1000000000000',withdrawableCash:null,evaluatedAt:{slot:'12',unixTime:'101'}}});
    expect(calls).toBe(1);
    indexer.healthy=false;
    expect((await app.inject({method:'GET',url:`/v2/accounts/${margin}`})).statusCode).toBe(503);
    expect(calls).toBe(1);
  } finally {await app.close();}
});

it('serves bounded latest history in ascending display order without changing cursor reads',async()=>{
  const row={binding:{group:'group',profile:'cross-safety-qualification'},state:{sequence:'105',markets:{}},synced_at:new Date()};
  const queries:string[]=[];
  const client={async query(sql:string,params?:unknown[]){queries.push(sql);
    if(sql.startsWith('SELECT * FROM runs'))return {rows:[row]};
    if(sql.includes('FROM events')){expect(params).toEqual(['test','0',2]);return {rows:(sql.includes('DESC')?['105','104']:['1','2']).map(sequence=>({sequence}))};}
    return {rows:[]};},release(){}};
  const indexer={healthy:true,ws:{error:null},config:{runId:'test'},store:{async snapshot(){return row;},pool:{async connect(){return client;}}}};
  const app=groupApi(indexer as unknown as GroupIndexer);
  try{
    const latest=await app.inject('/v2/trades?latest=true&limit=2');expect(latest.statusCode).toBe(200);
    expect(latest.json().items.map((item:any)=>item.sequence)).toEqual(['104','105']);expect(latest.json().next).toBe('105');
    const cursor=await app.inject('/v2/events?limit=2');expect(cursor.json().items.map((item:any)=>item.sequence)).toEqual(['1','2']);
    expect((await app.inject('/v2/events?latest=true&after=3')).statusCode).toBe(400);
    expect((await app.inject('/v2/events?latest=true&limit=101')).statusCode).toBe(400);
    expect(queries.filter(query=>query.startsWith('BEGIN'))).toHaveLength(2);
  }finally{await app.close();}
});
