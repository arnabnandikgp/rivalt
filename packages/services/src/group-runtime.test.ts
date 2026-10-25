import {AccountRole} from '@solana/kit';
import {expect,it,vi} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {fixtureKey} from '../../../tests/rpc-contract/custody-cases.js';
import {GroupRuntime} from './group-runtime.js';

async function environment(){
  const key=await fixtureKey('p21-market-worker'),group=key.address;
  const markets=await Promise.all([0,1].map(async index=>(await sdk.findGroupMarketPda(group,index))[0]));
  const makers=await Promise.all(markets.flatMap((market,marketIndex)=>[0,1].map(async makerId=>{
    const [registration]=await sdk.findGroupMakerPda(market,makerId);
    const registrationState={schemaVersion:2,group,market,marketIndex,makerId,owner:key.address,capital:registration,
      config:registration,programData:registration,pricingProgram:makerId===0?sdk.makerA.MAKER_A_PROGRAM_ADDRESS:sdk.makerB.MAKER_B_PROGRAM_ADDRESS,
      quoteEpoch:1n,startSlot:1n,expirySlot:200n,quarantined:false};
    return {registration,registrationState,marketIndex,makerId,approved:true,synchronized:true,online:false,
      capital:{cash:100n,positions:[]},state:{quoteEpoch:1n,startSlot:1n,expirySlot:200n}};
  })));
  const snapshot={group,markets,makers,state:{mode:2,paused:false,sequence:1n},slot:100n,now:100n,
    eventAuthority:group,program:sdk.CLEARING_PROGRAM_ADDRESS,
    marketStates:markets.map(()=>({observationSequence:1n,oracle:{sampledAt:90n,sources:[group,group,group,group]}}))};
  const runtime=new GroupRuntime('postgresql://unused:unused@127.0.0.1:1/unused','test','http://127.0.0.1:2');
  runtime.snapshot=async()=>snapshot as any;
  const queries:{text:string;values:unknown[]}[]=[],budget=vi.fn(async(..._args:Parameters<typeof runtime.queue.budget>)=>{}),enqueue=vi.fn(async(..._args:Parameters<typeof runtime.enqueue>)=>{});
  runtime.store.pool.query=(async(text:string,values:unknown[]=[])=>{queries.push({text,values});return {rows:[],rowCount:0};}) as any;
  runtime.queue.budget=budget;runtime.enqueue=enqueue;
  return {runtime,snapshot,key,queries,budget,enqueue};
}
it('keeps all four maker heartbeats/budgets distinct even under one internal operator',async()=>{
  const fixture=await environment();
  try{
    for(const market of [0,1] as const)for(const maker of [0,1] as const)expect((await fixture.runtime.maker(market,maker,fixture.key)).reason).toBe('current-maker-epoch');
    expect(fixture.budget.mock.calls.map(call=>call[0])).toEqual(['group-maker-0-0','group-maker-0-1','group-maker-1-0','group-maker-1-1']);
    expect(fixture.queries.filter(query=>query.text.startsWith('INSERT')).map(query=>query.values.slice(1,3))).toEqual([[0,0],[0,1],[1,0],[1,1]]);
    expect(fixture.enqueue).not.toHaveBeenCalled();
    const other=await fixtureKey('p21-wrong-maker');await expect(fixture.runtime.maker(0,0,other)).rejects.toThrow(/key binding/);
  }finally{await fixture.runtime.close();}
});
it('publishes and syncs expired maker epochs in separate immutable transactions',async()=>{
  const fixture=await environment();
  try{
    fixture.snapshot.slot=200n;
    expect((await fixture.runtime.maker(1,0,fixture.key)).status).toBe('queued');
    const [id,instructions,,budget,authority]=fixture.enqueue.mock.calls[0] as unknown as Parameters<GroupRuntime['enqueue']>;
    expect(id).toBe('maker:1:0:1');expect(budget).toBe('group-maker-1-0');
    expect(sdk.makerA.getPublishGroupEpochInstructionDataDecoder().decode(instructions[1].data!).duration).toBe(3600n);
    expect(instructions).toHaveLength(2);expect(authority).toBeNull();
    expect(instructions.every(instruction=>instruction.programAddress!==sdk.CLEARING_PROGRAM_ADDRESS)).toBe(true);
    const maker=fixture.snapshot.makers[2];Object.assign(maker.state,{quoteEpoch:2n,startSlot:200n,expirySlot:3800n});maker.synchronized=false;
    expect((await fixture.runtime.maker(1,0,fixture.key)).reason).toBe('owner-epoch-sync');
    const [,syncInstructions,,syncBudget,syncAuthority]=fixture.enqueue.mock.calls[1] as unknown as Parameters<GroupRuntime['enqueue']>;
    expect(syncInstructions).toHaveLength(2);expect(syncBudget).toBe(budget);
    expect(sdk.getUpdateGroupMakerV2InstructionDataDecoder().decode(syncInstructions[1].data!).operation).toBe(1);
    const config=syncInstructions[1].accounts![8];
    expect(config).toEqual({address:maker.registrationState.config,role:AccountRole.READONLY});
    expect(syncAuthority).toEqual({kind:'groupQuoteEpoch',group:fixture.key.address,account:maker.registration,value:'1'});
  }finally{await fixture.runtime.close();}
});
it('samples each canonical market despite unavailable maker heartbeats/epochs and leaves enforcement on chain',async()=>{
  const fixture=await environment();
  try{
    fixture.snapshot.makers.forEach(maker=>{maker.approved=false;maker.synchronized=false;maker.registrationState.quarantined=true;});
    for(const market of [0,1] as const)expect((await fixture.runtime.funding(market,fixture.key)).reason).toBe('market-observation-due');
    const calls=fixture.enqueue.mock.calls as unknown as Parameters<GroupRuntime['enqueue']>[];
    expect(calls.map(call=>[call[0],call[3]])).toEqual([['funding:0:1','group-funding-0'],['funding:1:1','group-funding-1']]);
    expect(calls.map(call=>call[1][1].accounts![1].address)).toEqual(fixture.snapshot.markets);
    expect(calls.every(call=>call[4]?.kind==='groupSequence')).toBe(true);
    await expect(fixture.runtime.funding(0,fixture.key,1n)).rejects.toThrow(/cadence/);
  }finally{await fixture.runtime.close();}
});
it('retains unresolved operator attempts and does not silently fund a replacement',async()=>{
  const fixture=await environment();
  try{
    fixture.runtime.store.pool.query=(async()=>({rows:[{pending:true}],rowCount:1})) as any;
    expect((await fixture.runtime.funding(0,fixture.key)).reason).toBe('original-funding-intent-pending');
    fixture.snapshot.slot=200n;expect((await fixture.runtime.maker(0,0,fixture.key)).reason).toBe('original-maker-intent-pending');
    expect(fixture.enqueue).not.toHaveBeenCalled();
  }finally{await fixture.runtime.close();}
});
