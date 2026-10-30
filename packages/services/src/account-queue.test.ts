import {expect,it} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {accountFixture} from '../../sdk/src/account-test-fixture.js';
import {Queue} from './queue.js';
import {dispatchWire,dispatchMockRows} from '../test-support/dispatch-fixture.js';

/** Consumer fault cases. Actual database/process recovery remains a separate
 * fresh RPC/WS/PostgreSQL acceptance gate; no financial success is fabricated. */
async function fixture(changed=false) {
  const fixture=await accountFixture(),margin=fixture.margins[0];
  const original=Buffer.from(fixture.accounts.get(margin).data[0],'base64');
  const root=sdk.getMarginAccountDecoder().decode(original),bytes=Buffer.from(sdk.getMarginAccountEncoder().encode({...root,stateVersion:changed?10n:9n}));
  const calls:{sql:string;params:any[]}[]=[],rpcCalls:{method:string;params:any[]}[]=[];
  const intent={request_id:'order:1',status:'pending',signature:'original-signature',wire:dispatchWire(),blockhash:'original-blockhash',
    budget:'account-orders',authority:{kind:'accountStateVersion',venue:fixture.config.venue,account:margin,value:'9'}};
  const query=async(sql:string,params:any[]=[])=>{calls.push({sql,params});return {rows:dispatchMockRows(sql,intent)};};
  const rpc={call:async(method:string,params:any[]=[]):Promise<any>=>{
    rpcCalls.push({method,params});
    if(method==='getSignatureStatuses')return {value:[null]};
    if(method==='isBlockhashValid')return {context:{slot:123},value:false};
    if(method==='getAccountInfo')return {context:{slot:124},value:{owner:sdk.CLEARING_PROGRAM_ADDRESS,data:[bytes.toString('base64'),'base64']}};
    throw new Error('Unexpected RPC');
  }};
  const store={runId:'account-unit',pool:{connect:async()=>({query,release(){}})}};
  const queue=new Queue(store as unknown as ConstructorParameters<typeof Queue>[0],rpc as ConstructorParameters<typeof Queue>[1]);
  const update=()=>calls.find(call=>call.sql.startsWith('UPDATE service_intents'))!;
  return {queue,rpc,calls,rpcCalls,update,intent};
}
it('proves only economic nonexecution at finalized expiry and keeps the unseen fee reserved',async()=>{
  const test=await fixture();await test.queue.step('order:1');
  expect(test.update().params[2]).toBe('expired-unexecuted');
  expect(JSON.parse(test.update().params[3])).toMatchObject({fee:null,economicEffect:'not-applied'});
  expect(test.calls.some(call=>call.sql.startsWith('UPDATE service_budgets'))).toBe(false);
  expect(test.rpcCalls.find(call=>call.method==='getAccountInfo')!.params[1]).toMatchObject({commitment:'finalized',minContextSlot:123});
});
it('does not infer nonexecution when root state advanced or the authority schema is unavailable',async()=>{
  for(const unavailable of [false,true]) {
    const test=await fixture(true),original=test.rpc.call;
    if(unavailable)test.rpc.call=async(method,params)=>method==='getAccountInfo'?{context:{slot:124},value:null}:original(method,params);
    await test.queue.step('order:1');expect(test.update().params[2]).toBe('unresolved');
    expect(test.calls.some(call=>call.sql.startsWith('UPDATE service_budgets'))).toBe(false);
  }
});
it('retries identical committed bytes after an acknowledgement loss without releasing fees',async()=>{
  const test=await fixture(),original=test.rpc.call,attempts:string[]=[];
  test.rpc.call=async(method,params=[])=>{
    if(method==='isBlockhashValid')return {context:{slot:123},value:true};
    if(method==='sendTransaction'){attempts.push(params[0]);throw new Error('Acknowledgement unavailable');}
    return original(method,params);
  };
  await test.queue.step('order:1');await test.queue.step('order:1');
  expect(attempts).toEqual([test.intent.wire,test.intent.wire]);expect(test.update().params[2]).toBe('unresolved');
  expect(test.calls.some(call=>call.sql.startsWith('UPDATE service_budgets'))).toBe(false);
  expect(test.calls.some(call=>call.sql.startsWith('DELETE FROM service_dispatch_access'))).toBe(false);
});
it('releases access after proven nonexecution but never rebroadcasts it or releases the unknown fee',async()=>{
  const test=await fixture();test.intent.status='expired-unexecuted';const original=test.rpc.call;
  test.rpc.call=async(method,params=[])=>method==='isBlockhashValid'?{context:{slot:123},value:true}:original(method,params);
  await test.queue.step('order:1');
  expect(test.rpcCalls.some(call=>call.method==='sendTransaction')).toBe(false);
  expect(test.calls.some(call=>call.sql.startsWith('DELETE FROM service_dispatch_access'))).toBe(true);
  expect(test.calls.some(call=>call.sql.startsWith('UPDATE service_budgets'))).toBe(false);
});
