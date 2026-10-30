import {expect,it} from 'vitest';
import {createNoopSigner,type Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import {accountTradeFixture} from '../../sdk/src/account-test-fixture.js';
import {accountRiskWork} from './account-risk-worker.js';
import {accountWorkerKeys} from './account-worker-state.js';
import type {AccountRuntime} from './account-runtime.js';
import type {AccountAuthority} from './account-authority.js';
import {Queue} from './queue.js';
import {dispatchWire,dispatchMockRows} from '../test-support/dispatch-fixture.js';

/** Encoded RPC consumer fixture: no claim of simulated financial acceptance. */
async function fixture(freezeAccepted=false) {
  const test=await accountTradeFixture(),[target,receiver]=test.margins,venue=test.config.venue;
  const readRoot=(key:string)=>sdk.getMarginAccountDecoder().decode(Buffer.from(test.accounts.get(key).data[0],'base64'));
  const distressed=readRoot(target);
  distressed.cash=1n;distressed.positions[0]={lots:10n,virtualScaled:-100_000_000_000_000n,fundingCheckpointScaled:0n,generation:1n};
  const capital={...readRoot(receiver),role:2,stateVersion:27n,isolatedMarketIndex:0};
  test.put(target,sdk.getMarginAccountEncoder().encode(distressed));test.put(receiver,sdk.getMarginAccountEncoder().encode(capital));
  const keys=await accountWorkerKeys(venue);
  const [,resolutionBump]=await sdk.deriveVenueComponent(venue,'resolution');
  const [,workBump]=await sdk.deriveVenueComponent(venue,'resolution-work');
  test.put(keys.resolution,sdk.getResolutionEncoder().encode({...test.empty(sdk.getResolutionDecoder()),schemaVersion:5,revision:1n,venue,bump:resolutionBump}));
  test.put(keys.work,sdk.getResolutionWorkEncoder().encode({...test.empty(sdk.getResolutionWorkDecoder()),schemaVersion:5,revision:1n,venue,bump:workBump}));
  const [,registryBump]=await sdk.deriveVenueComponent(venue,'registry');
  test.put(keys.registry,sdk.getVenueRegistryEncoder().encode({schemaVersion:5,revision:1n,venue,count:2,membershipVersion:1n,members:[target,receiver],bump:registryBump}));
  const submissions:{instructions:Instruction[];authority:AccountAuthority|null}[]=[];
  const runtime={rpc:test.rpc,riskProbeCursor:0,budget:async()=> 'risk-budget',pendingBudget:async()=>false,
    discovery:async()=>({state:{members:[target,receiver],roots:{[target]:distressed,[receiver]:capital}}}),
    snapshot:async(margins=test.margins)=>({...await sdk.readAccountSnapshot(test.rpc,test.config,margins,'confirmed'),...keys}),
    enqueue:async(_id:string,instructions:Instruction[],_key:Keypair,_budget:string,authority:AccountAuthority|null)=>{
      submissions.push({instructions,authority});
      if(!freezeAccepted&&sdk.hex(instructions[1].data!.slice(0,8))===sdk.hex(sdk.FREEZE_ACCOUNTS_DISCRIMINATOR))
        throw new Error('Risk action presently unavailable');
    }};
  const outcome=await accountRiskWork(runtime as unknown as AccountRuntime,createNoopSigner(test.owner) as Keypair,receiver);
  return {...test,target,receiver,submissions,outcome};
}
it('attaches the signed receiver version to liquidation and proves only finalized nonexecution',async()=>{
  const test=await fixture();expect(test.outcome).toEqual({status:'queued',reason:'funded-whole-account-liquidation'});
  const liquidation=test.submissions.at(-1)!;
  const wire=sdk.getLiquidateAccountInstructionDataDecoder().decode(liquidation.instructions[1].data!);
  expect(wire.receiverGuard.stateVersion).toBe(27n);
  expect(liquidation.authority).toEqual({kind:'accountStateVersion',venue:test.config.venue,account:test.receiver,value:'27'});
  expect(test.submissions[0].authority).toBeNull();
  // Feed the actual worker metadata into the real expiry queue, not a second
  // reimplementation of its decision. No unseen fee can be released.
  for(const state of ['unchanged','advanced','missing'] as const) {
    const calls:{sql:string;params:any[]}[]=[];
    const intent={request_id:'liquidation',status:'pending',signature:'lost-original',wire:dispatchWire(),blockhash:'expired',budget:'risk-budget',authority:liquidation.authority};
    const query=async(sql:string,params:any[]=[])=>{calls.push({sql,params});return {rows:dispatchMockRows(sql,intent)};};
    const root=sdk.getMarginAccountDecoder().decode(Buffer.from(test.accounts.get(test.receiver).data[0],'base64'));
    const bytes=sdk.getMarginAccountEncoder().encode({...root,stateVersion:state==='advanced'?28n:27n});
    const rpc={call:async(method:string,params:any[])=>{
      if(method==='getSignatureStatuses')return {value:[null]};
      if(method==='isBlockhashValid')return {context:{slot:123},value:false};
      expect(method).toBe('getAccountInfo');expect(params[0]).toBe(test.receiver);
      expect(params[1]).toMatchObject({commitment:'finalized',minContextSlot:123});
      return {context:{slot:124},value:state==='missing'?null:{owner:sdk.CLEARING_PROGRAM_ADDRESS,data:[Buffer.from(bytes).toString('base64'),'base64']}};
    }};
    const store={runId:'risk-unit',pool:{connect:async()=>({query,release(){}})}};
    const queue=new Queue(store as unknown as ConstructorParameters<typeof Queue>[0],rpc as ConstructorParameters<typeof Queue>[1]);
    await queue.step('liquidation');
    expect(calls.find(call=>call.sql.startsWith('UPDATE service_intents'))!.params[2]).toBe(state==='unchanged'?'expired-unexecuted':'unresolved');
    expect(calls.some(call=>call.sql.startsWith('UPDATE service_budgets'))).toBe(false);
  }
});
it('keeps permissionless freeze without an invented receiver expiry proof',async()=>{
  const test=await fixture(true);
  expect(test.outcome).toEqual({status:'queued',reason:'authenticated-net-insolvency'});
  expect(test.submissions).toHaveLength(1);expect(test.submissions[0].authority).toBeNull();
});
