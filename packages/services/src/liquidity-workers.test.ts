import {it,expect} from 'vitest';
import {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {accountFixture} from '../../sdk/src/account-test-fixture.js';
import type {AccountRuntime} from './account-runtime.js';
import {repriceLiquidity} from './liquidity-workers.js';
import {accountBudget} from './account-execution.js';

async function fixture() {
  const input=await accountFixture(),snapshot=await sdk.readAccountSnapshot(input.rpc,input.config,[input.margins[0]],'confirmed');
  Object.assign(snapshot.marketStates[0],{referencePrice:60_000n,lower:59_400n,upper:60_600n,validFrom:1n,validUntil:1000n});
  Object.assign(snapshot.marketStates[0].oracle,{status:2,sampledAt:500n,sourceDeadline:520n,lastQualified:500n,heldEpoch:1n,heldUntil:506n,heldSlot:1000n});
  const key=await Keypair.generate(),registration=input.config.mint;
  const maker={registration,registrationState:{capital:input.margins[0],config:input.config.mint,price:input.config.mint,
    pricingProgram:sdk.makerA.MAKER_A_PROGRAM_ADDRESS,quarantined:false},
    config:{owner:input.owner,updater:key.address,updaterExpirySlot:101n,controlEpoch:3n},
    price:{sequence:9n,controlEpoch:3n,updatedTime:98n},validUntilTime:104n,unavailable:null};
  const queued:any[]=[],queries:string[]=[];
  snapshot.liquidity={adapters:[maker]} as unknown as typeof snapshot.liquidity;
  const runtime={discovery:async()=>({state:{venue:snapshot.venueState,liquidity:{makers:{[registration]:{market:snapshot.markets[0],instance:2,capital:input.margins[0]}}}}}),
    snapshot:async()=>snapshot,budget:async()=> 'maker-budget',pendingBudget:async()=>false,
    store:{pool:{query:async(sql:string)=>{queries.push(sql);return {rows:[]};}}},runId:'unit',
    enqueue:async(...args:any[])=>{queued.push(args);}} as unknown as AccountRuntime;
  return {runtime,snapshot,maker,key,queued,queries};
}
it('allows instance 2 only in profile 4 and partitions budgets by market and instance',()=>{
  expect(()=>accountBudget('maker',0,2)).toThrow();expect(accountBudget('maker',0,2,4).name).toBe('liquidity-maker-0-2');
  expect(accountBudget('maker',1,2,4).name).toBe('liquidity-maker-1-2');expect(()=>accountBudget('maker',1,3,4)).toThrow();
});
it('reprices with strict epochs and a maker-owned sequence proof without replenishment',async()=>{
  const test=await fixture();expect((await repriceLiquidity(test.runtime,0,2,test.key)).status).toBe('queued');
  const [id,instructions,,,authority]=test.queued[0];expect(id).toBe('maker:0:2:3:9');
  expect(authority).toEqual({kind:'liquidityPriceSequence',venue:test.snapshot.venue,account:test.maker.registrationState.price,
    registration:test.maker.registration,pricingProgram:test.maker.registrationState.pricingProgram,value:'9'});
  expect(sdk.makerA.parseRepriceInstruction(instructions[0]).data).toMatchObject({expectedControl:3n,expectedSequence:9n,anchor:test.snapshot.marketStates[0].referencePrice});
  expect(instructions).toHaveLength(1);
});
it('does not replace a pending original and respects updater expiry at the boundary',async()=>{
  const test=await fixture();test.runtime.pendingBudget=async()=>true;
  expect((await repriceLiquidity(test.runtime,0,2,test.key)).reason).toBe('original-maker-intent-pending');expect(test.queued).toHaveLength(0);
  test.maker.config.updaterExpirySlot=test.snapshot.slot;
  await expect(repriceLiquidity(test.runtime,0,2,test.key)).rejects.toThrow(/authority/);
});
it('does not refresh an unauthorized, disabled, frozen or sourceless publication',async()=>{
  for(const kind of ['quarantined','disabled','frozen','source']) {
    const test=await fixture();
    if(kind==='quarantined')test.maker.registrationState.quarantined=true;
    if(kind==='disabled')test.maker.unavailable='disabled' as never;
    if(kind==='frozen')test.snapshot.safetyState.mode=2;
    if(kind==='source')test.snapshot.marketStates[0].oracle.sourceDeadline=0n;
    expect((await repriceLiquidity(test.runtime,0,2,test.key)).status).toBe('blocked');expect(test.queued).toHaveLength(0);
  }
});
