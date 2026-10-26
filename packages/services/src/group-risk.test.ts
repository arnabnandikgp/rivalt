import {AccountRole} from '@solana/kit';
import {expect,it,vi} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {fixtureKey} from '../../../tests/rpc-contract/custody-cases.js';
import {GroupRuntime} from './group-runtime.js';
import {groupDefaultProbeMembers,groupReceiver,groupResolutionPage,groupRiskSources} from './group-risk.js';

async function fixture(){
  const key=await fixtureKey('group-risk-worker'),targetKey=await fixtureKey('group-risk-target');
  const group=key.address,target=targetKey.address,receiver=key.address;
  const rootDecoder=sdk.getMarginAccountV2Decoder(),marketDecoder=sdk.getGroupMarketV2Decoder(),groupDecoder=sdk.getClearingGroupV2Decoder();
  const root={...rootDecoder.decode(new Uint8Array(rootDecoder.fixedSize)),schemaVersion:2,group,owner:target,mode:0,isolatedMarketIndex:255,cash:1_000_000n};
  root.positions[0].lots=100n;root.positions[0].virtualScaled=-6_000_000_000_000_000n;
  const capital={...structuredClone(root),id:1,owner:key.address,role:2,positions:rootDecoder.decode(new Uint8Array(rootDecoder.fixedSize)).positions};
  const markets=[0,1].map(index=>({...marketDecoder.decode(new Uint8Array(marketDecoder.fixedSize)),schemaVersion:2,group,index,termsEpoch:1n,configEpoch:1n,
    referencePrice:52_000n,lower:51_480n,upper:52_520n,validFrom:1n,validUntil:200n}));
  for(const market of markets)Object.assign(market.oracle,{status:2,sampledAt:100n,sourceDeadline:120n,lastQualified:100n,
    heldEpoch:1n,heldUntil:106n,heldSlot:200n,fundingBase:0n,premiumScaled:0n});
  // Generated variable-length resolution layout has an empty rows vector.
  const headerDecoder=sdk.getGroupResolutionHeaderV2Decoder();
  const resolutionState={discriminator:sdk.GROUP_RESOLUTION_V2_DISCRIMINATOR,schemaVersion:2,group,bump:0,header:headerDecoder.decode(new Uint8Array(headerDecoder.fixedSize)),rows:[]} as sdk.GroupResolutionV2;
  const snapshot={group,state:{...groupDecoder.decode(new Uint8Array(groupDecoder.fixedSize)),mode:2,sequence:9n},marketStates:markets,
    roots:{[target]:root,[receiver]:capital},members:[target,receiver],markets:[group,group],btc:group,eth:group,registry:group,
    resolution:group,resolutionState,vault:group,eventAuthority:group,program:sdk.CLEARING_PROGRAM_ADDRESS,now:101n,slot:100n} as unknown as sdk.GroupSnapshot & {eventAuthority:typeof group;program:typeof sdk.CLEARING_PROGRAM_ADDRESS};
  const runtime=new GroupRuntime('postgresql://unused:unused@127.0.0.1:1/unused','test','http://127.0.0.1:2');
  runtime.snapshot=async()=>snapshot as any;runtime.queue.budget=vi.fn(async()=>{});
  runtime.store.pool.query=(async()=>({rows:[{count:0}],rowCount:0})) as any;
  const enqueue=vi.fn(async(..._args:Parameters<typeof runtime.enqueue>)=>{});runtime.enqueue=enqueue;
  return {key,target,receiver,root,capital,markets,snapshot,runtime,enqueue};
}
it('probes open exposure using current on-chain prices and uses exact net claims for flat discovery',async()=>{
  const fixtureState=await fixture();const {snapshot,target,root}=fixtureState;
  try{
    expect(groupDefaultProbeMembers(snapshot)).toEqual([target]);
    root.positions[0].lots=0n;root.cash=0n;root.positions[0].virtualScaled=-2_000_000_000n;root.positions[1].virtualScaled=3_000_000_000n;
    expect(groupDefaultProbeMembers(snapshot)).toEqual([]); // Negative risk equity is not net bankruptcy.
    root.positions[1].virtualScaled=1_999_999_999n;expect(groupDefaultProbeMembers(snapshot)).toEqual([target]);
  }finally{await fixtureState.runtime.close();}
});
it('builds exact canonical four-member pages and limits writable roots to collection/apply stages',async()=>{
  const {snapshot,runtime}=await fixture();
  try{
    snapshot.members=await Promise.all(Array.from({length:9},async(_,index)=>(await fixtureKey(`group-risk-page-${index}`)).address));
    snapshot.state.mode=3;snapshot.state.paused=true;Object.assign(snapshot.resolutionState!.header,{count:9,cursor:4,stage:2,epoch:7n});
    for(const stage of [2,3,10,11]){
      snapshot.resolutionState!.header.stage=stage;const page=groupResolutionPage(snapshot);
      expect(page.accounts.slice(-4)).toEqual(snapshot.members.slice(4,8).map(address=>({address,role:[3,10].includes(stage)?AccountRole.WRITABLE:AccountRole.READONLY})));
      expect(sdk.getAdvanceGroupResolutionV2InstructionDataDecoder().decode(page.data!)).toMatchObject({epoch:7n,stage,start:4});
    }
    snapshot.resolutionState!.header.count=8;expect(()=>groupResolutionPage(snapshot)).toThrow(/cursor/);
  }finally{await runtime.close();}
});
it('requires explicit owned funded non-maker receiving capital and shared collateral source identities',async()=>{
  const {snapshot,runtime,key,receiver,capital,target}=await fixture();
  try{
    expect(groupReceiver(snapshot,key.address,undefined)).toBeNull();expect(groupReceiver(snapshot,key.address,receiver)).toBe(capital);
    capital.role=1;expect(()=>groupReceiver(snapshot,key.address,receiver)).toThrow(/receiver/);capital.role=2;
    capital.cash=0n;expect(()=>groupReceiver(snapshot,key.address,receiver)).toThrow(/receiver/);
    expect(()=>groupReceiver(snapshot,key.address,target)).toThrow(/receiver/);
    snapshot.marketStates[1].oracle.sources[1]=target;expect(()=>groupRiskSources(snapshot)).toThrow(/source identity/);
  }finally{await runtime.close();}
});
it('retains ambiguous risk intents without new simulations or signatures',async()=>{
  const {runtime,key,receiver,enqueue}=await fixture();
  try{runtime.store.pool.query=(async()=>({rows:[],rowCount:1})) as any;
    expect((await runtime.riskWork(key,receiver)).reason).toBe('original-risk-intent-pending');expect(enqueue).not.toHaveBeenCalled();
  }finally{await runtime.close();}
});
it('probes ordinary authenticated bankruptcy despite pause/stale cached observations, never emergency',async()=>{
  const {runtime,snapshot,key,enqueue}=await fixture();
  try{
    snapshot.state.paused=true;snapshot.marketStates.forEach(market=>market.oracle.sourceDeadline=1n);
    expect((await runtime.riskWork(key)).reason).toBe('authenticated-net-insolvency');
    const call=enqueue.mock.calls[0];expect(call[3]).toBe('group-risk');expect(call[5]).toBe(true);
    expect(sdk.getFreezeGroupV2InstructionDataDecoder().decode(call[1][1].data!)).toMatchObject({sequence:9n,emergency:false});
  }finally{await runtime.close();}
});
it('uses actual simulation for post-fee progress and preserves the reference price and bounded size',async()=>{
  const {runtime,key,receiver,enqueue}=await fixture();
  try{
    enqueue.mockImplementation(async(_id,instructions)=>{
      if(Buffer.from(instructions[1].data!).subarray(0,8).equals(Buffer.from(sdk.FREEZE_GROUP_V2_DISCRIMINATOR)))throw new Error('Risk action presently unavailable');
      const instruction=sdk.getLiquidateGroupV2InstructionDataDecoder().decode(instructions[1].data!);
      if(instruction.lots===64n)throw new Error('Risk action presently unavailable');
    });
    expect((await runtime.riskWork(key,receiver)).reason).toBe('funded-whole-account-liquidation');
    const calls=enqueue.mock.calls.slice(1);expect(calls.map(call=>sdk.getLiquidateGroupV2InstructionDataDecoder().decode(call[1][1].data!).lots)).toEqual([64n,32n]);
    expect(calls.every(call=>call[5]===true&&sdk.getLiquidateGroupV2InstructionDataDecoder().decode(call[1][1].data!).price===52_000n)).toBe(true);
  }finally{await runtime.close();}
});
it('never tries replacement actions after transport or budget uncertainty',async()=>{
  const {runtime,key,receiver,enqueue}=await fixture();
  try{enqueue.mockRejectedValue(new Error('RPC unavailable'));
    await expect(runtime.riskWork(key,receiver)).rejects.toThrow('RPC unavailable');expect(enqueue).toHaveBeenCalledTimes(1);
  }finally{await runtime.close();}
});
it('bounds paid recovery checks and leaves resume to the explicit group authority',async()=>{
  const {runtime,key,snapshot,enqueue}=await fixture();
  try{
    snapshot.state.mode=3;snapshot.state.paused=true;const header=snapshot.resolutionState!.header;
    Object.assign(header,{epoch:1n,stage:12,count:2,recoveryLast:98n});
    expect((await runtime.riskWork(key)).reason).toBe('permissionless-group-recovery-check');
    expect(sdk.getRecoverGroupResolutionV2InstructionDataDecoder().decode(enqueue.mock.calls[0][1][1].data!)).toMatchObject({resume:false,epoch:1n});
    enqueue.mockClear();header.recoverySince=92n;expect((await runtime.riskWork(key)).reason).toBe('explicit-authority-resume-required');expect(enqueue).not.toHaveBeenCalled();
    header.recoverySince=0n;runtime.store.pool.query=(async()=>({rows:[{count:8}],rowCount:0})) as any;
    expect((await runtime.riskWork(key)).reason).toBe('bounded-recovery-checks-exhausted');expect(enqueue).not.toHaveBeenCalled();
  }finally{await runtime.close();}
});
