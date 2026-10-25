import {expect,it} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {json} from '../../indexer/src/events.js';
import {groupSampleMatches} from './group-quote.js';

it('matches the actual V2 snapshot envelope including bump and rejects changed/future observations',()=>{
  const decoder=sdk.getGroupMarketV2Decoder(),market={...decoder.decode(new Uint8Array(decoder.fixedSize)),schemaVersion:2,bump:251,index:0,observationSequence:3n};
  const {discriminator,...state}=market;
  const decoded=sdk.getGroupMarketSnapshotV2Decoder().decode(sdk.getGroupMarketSnapshotV2Encoder().encode(state));
  const event=JSON.parse(json({group:market.group,market:market.group,sequence:7n,state:decoded}));
  const snapshot={group:market.group,state:{sequence:8n},markets:[market.group],marketStates:[market]} as unknown as sdk.GroupSnapshot;
  expect(groupSampleMatches(event,snapshot)).toBe(true);
  expect(groupSampleMatches({...event,sequence:'9'},snapshot)).toBe(false);
  expect(groupSampleMatches({...event,group:'foreign'},snapshot)).toBe(false);
  expect(groupSampleMatches({...event,state:{...event.state,bump:250}},snapshot)).toBe(false);
  expect(groupSampleMatches({...event,state:{...event.state,observationSequence:'2'}},snapshot)).toBe(false);
  market.fundingIndexScaled=1n;expect(groupSampleMatches(event,snapshot)).toBe(false);
});

it('rejects malformed quote/submit input before invoking runtime and retains classified unavailability',async()=>{
  const {groupServiceApi}=await import('./group-service-api.js');
  const {GroupQuoteUnavailable}=await import('./group-quote.js');
  let quotes=0,submissions=0;
  const app=groupServiceApi({snapshot:async()=>{throw new Error('unavailable');},
    quote:async()=>{quotes++;throw new GroupQuoteUnavailable('required-market-source-unavailable',{marketIndex:1});},
    submit:async()=>{submissions++;throw new Error('unsupported');}} as any);
  try{
    expect((await app.inject({method:'POST',url:'/v2/quote',payload:{marketIndex:1,side:0,lots:'4609'}})).statusCode).toBe(400);
    expect(quotes).toBe(0);
    expect((await app.inject({method:'POST',url:'/v2/submit',payload:{wire:{}}})).statusCode).toBe(400);expect(submissions).toBe(0);
    const key='11111111111111111111111111111111';
    const response=await app.inject({method:'POST',url:'/v2/quote',payload:{marketIndex:1,side:0,lots:'1',actor:key,margin:key}});
    expect(response.statusCode).toBe(400);expect(response.json()).toEqual({error:'QuoteUnavailable',code:'required-market-source-unavailable',diagnostic:{marketIndex:1}});
    expect((await app.inject('/ready')).statusCode).toBe(503);
  }finally{await app.close();}
});
