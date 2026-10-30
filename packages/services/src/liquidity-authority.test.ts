import {expect,it} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {liquidityAccountFixture} from '../../sdk/test-support/liquidity-accounts.js';
import {Queue} from './queue.js';
import type {LiquidityPriceAuthority} from './liquidity-authority.js';
import {dispatchWire,dispatchMockRows} from '../test-support/dispatch-fixture.js';

async function fixture(instance=0) {
  const input=await liquidityAccountFixture(),maker=input.states[instance];
  const authority:LiquidityPriceAuthority={kind:'liquidityPriceSequence',venue:input.snapshot.venue,
    account:maker.price,registration:maker.registration,pricingProgram:maker.program,value:'1'};
  const intent={status:'pending',signature:'original-signature',wire:dispatchWire(),blockhash:'original-blockhash',
    budget:'liquidity-maker',authority};
  const writes:{sql:string;params:any[]}[]=[],reads:{method:string;params:any[]}[]=[];
  const query=async(sql:string,params:any[]=[])=>{writes.push({sql,params});return {rows:dispatchMockRows(sql,intent)};};
  const rpc={call:async(method:string,params:any[]=[]):Promise<any>=>{
    reads.push({method,params});
    if(method==='getSignatureStatuses')return {value:[null]};
    if(method==='isBlockhashValid')return {context:{slot:123},value:false};
    if(method==='getMultipleAccounts')return {context:{slot:124},value:params[0].map((key:any)=>input.accounts.get(key)??null)};
    throw new Error('Unexpected RPC');
  }};
  const store={runId:'authority-unit',pool:{connect:async()=>({query,release(){}})}};
  const queue=new Queue(store as unknown as ConstructorParameters<typeof Queue>[0],rpc as ConstructorParameters<typeof Queue>[1],sdk.CLEARING_PROGRAM_ADDRESS,1);
  const status=()=>writes.find(write=>write.sql.startsWith('UPDATE service_intents'))!.params[2];
  return {input,maker,intent,rpc,queue,reads,writes,status};
}
it('authenticates both maker programs after finalized expiry without releasing unseen network fees',async()=>{
  for(const instance of [0,2]) {
    const test=await fixture(instance);await test.queue.step('maker:1');
    expect(test.status()).toBe('expired-unexecuted');
    expect(test.reads.find(read=>read.method==='getMultipleAccounts')!.params[1]).toEqual({encoding:'base64',commitment:'finalized',minContextSlot:123});
    expect(test.writes.some(write=>write.sql.startsWith('UPDATE service_budgets'))).toBe(false);
  }
});
it('fails closed for advanced state, forged bindings, malformed layouts and missing or old snapshots',async()=>{
  for(const fault of ['advanced','owner','executable','schema','config','bump','venue','program','registration','missing','old-slot']) {
    const test=await fixture();
    if(fault==='advanced')test.maker.priceState.sequence=2n;
    if(fault==='schema')test.maker.priceState.schemaVersion=3;
    if(fault==='config')test.maker.priceState.config=test.input.snapshot.venue;
    if(fault==='bump')test.maker.priceState.bump=(test.maker.priceState.bump^1) as typeof test.maker.priceState.bump;
    if(fault==='venue')test.intent.authority.venue=test.input.snapshot.market;
    if(fault==='program')test.intent.authority.pricingProgram=sdk.CLEARING_PROGRAM_ADDRESS;
    if(fault==='registration')test.intent.authority.registration=test.input.states[1].registration;
    test.maker.write();
    const account=test.input.accounts.get(test.maker.price)!;
    if(fault==='owner')account.owner=sdk.CLEARING_PROGRAM_ADDRESS;
    if(fault==='executable')account.executable=true;
    if(fault==='missing')test.input.accounts.set(test.maker.price,null);
    if(fault==='old-slot') {
      const read=test.rpc.call;test.rpc.call=async(method,params)=>{
        const response=await read(method,params);return method==='getMultipleAccounts'?{...response,context:{slot:122}}:response;
      };
    }
    await test.queue.step('maker:1');expect(test.status(),fault).toBe('unresolved');
    expect(test.writes.some(write=>write.sql.startsWith('UPDATE service_budgets'))).toBe(false);
  }
});
