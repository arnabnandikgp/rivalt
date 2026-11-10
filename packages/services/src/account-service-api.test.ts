import {expect,it} from 'vitest';
import {accountServiceApi} from './account-service-api.js';
import type {AccountRuntime} from './account-runtime.js';

it('accepts decimal quantities through the numeric domain and rejects malformed or excessive values before quoting',async()=>{
  const seen:bigint[]=[];
  const runtime={profile:4,quote:async(_actor:unknown,_margin:unknown,_market:unknown,_side:unknown,lots:bigint)=>{
    seen.push(lots);return {available:false,code:'fixture-unavailable'};
  }} as unknown as AccountRuntime;
  const app=accountServiceApi(runtime),key='11111111111111111111111111111111';
  try {
    for(const lots of ['4609','1000000','100000000']) {
      const reply=await app.inject({method:'POST',url:'/v4/quote',payload:{actor:key,margin:key,marketIndex:0,side:0,lots}});
      expect(reply.statusCode).toBe(200);
    }
    for(const lots of ['100000001','999999999','1000000000','0','01','1.0','-1',1000000]) {
      const reply=await app.inject({method:'POST',url:'/v4/quote',payload:{actor:key,margin:key,marketIndex:0,side:0,lots}});
      expect(reply.statusCode).toBe(400);
    }
    expect(seen).toEqual([4609n,1000000n,100000000n]);
  } finally {await app.close();}
});
