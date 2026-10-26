import {AccountRole,address} from '@solana/kit';
import {expect,it,vi} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {fixtureKey} from '../../../tests/rpc-contract/custody-cases.js';
import {groupClaimAmount,groupCertificatePage} from './group-settlement.js';
import {GroupRuntime} from './group-runtime.js';

const SCALE=1_000_000_000n;
function fixture(){
  const group=address('11111111111111111111111111111111');
  const rootDecoder=sdk.getMarginAccountV2Decoder(),marketDecoder=sdk.getGroupMarketV2Decoder();
  const root={...rootDecoder.decode(new Uint8Array(rootDecoder.fixedSize)),schemaVersion:2,mode:0,isolatedMarketIndex:255,cash:20n};
  const markets=[0,1].map(index=>({...marketDecoder.decode(new Uint8Array(marketDecoder.fixedSize)),schemaVersion:2,index,
    termsEpoch:1n,configEpoch:1n,referencePrice:100n,lower:100n,upper:100n,validFrom:1n,validUntil:100n}));
  for(const market of markets)Object.assign(market.oracle,{status:2,sampledAt:100n,sourceDeadline:120n,lastQualified:100n,
    heldEpoch:1n,heldUntil:106n,heldSlot:100n,fundingBase:0n,premiumScaled:0n});
  const stateDecoder=sdk.getClearingGroupV2Decoder(),guardDecoder=sdk.getGroupExitGuardV2Decoder();
  const state={...stateDecoder.decode(new Uint8Array(stateDecoder.fixedSize)),mode:2,paused:false,sequence:3n,settlement:10n};
  const certificate={...guardDecoder.decode(new Uint8Array(guardDecoder.fixedSize)),sequence:3n,count:1,next:0};
  const snapshot={group,state,roots:{[group]:root},marketStates:markets,markets:[group,group],members:[group],
    btc:group,eth:group,registry:group,vault:group,guard:group,eventAuthority:group,program:sdk.CLEARING_PROGRAM_ADDRESS,
    certificate,now:101n,slot:10n} as unknown as sdk.GroupSnapshot;
  return {snapshot,root,markets,group};
}
it('collects floor negative market entitlement bounded by the one cash balance, without implicit closed netting',()=>{
  const {snapshot,root,group}=fixture();root.positions[0].virtualScaled=-10_250_000_000n;root.positions[1].virtualScaled=100n*SCALE;
  const original=structuredClone(root);
  expect(groupClaimAmount(snapshot,group,0,false)).toBe(10n);
  root.cash=3n;expect(groupClaimAmount(snapshot,group,0,false)).toBe(3n);
  root.cash=20n;expect(root).toEqual(original);expect(groupClaimAmount(snapshot,group,1,false)).toBe(0n);
});
it('includes pending opposite-market funding and keeps sub-atom ownership',()=>{
  const {snapshot,root,markets,group}=fixture();
  root.positions[1].lots=2n;root.positions[1].virtualScaled=-200_900_000_000n;markets[1].oracle.premiumScaled=360n*SCALE;
  // 200 mark - 200.9 entry - 0.2 funding = -1.1 atoms, one whole atom collectable.
  expect(groupClaimAmount(snapshot,group,1,false)).toBe(1n);
  root.positions[1].virtualScaled=-200n*SCALE;expect(groupClaimAmount(snapshot,group,1,false)).toBe(0n);
  expect(root.positions[1].fundingCheckpointScaled).toBe(0n);
});
it('pays only whole funded entitlement and gives no positive unpaid credit from another slot',()=>{
  const {snapshot,root,group}=fixture();root.cash=0n;root.positions[0].virtualScaled=2_750_000_000n;
  root.positions[1].lots=1n;root.positions[1].virtualScaled=1000n*SCALE;
  // Two funded atoms cannot meet the other position’s ten-atom IM; its gain has zero credit.
  expect(groupClaimAmount(snapshot,group,0,true)).toBe(0n);
  root.positions[1].lots=0n;expect(groupClaimAmount(snapshot,group,0,true)).toBe(2n);
  snapshot.state.settlement=1n;expect(groupClaimAmount(snapshot,group,0,true)).toBe(1n);
  snapshot.state.settlement=0n;expect(groupClaimAmount(snapshot,group,0,true)).toBe(0n);
});
it('enforces refreshed other-market reservations and excludes foreign isolated claims',()=>{
  const {snapshot,root,group}=fixture();root.positions[0].virtualScaled=2_750_000_000n;
  const entry=root.book.orders[0];entry.marketIndex=1;
  Object.assign(entry.order,{id:1n,state:1,termsEpoch:1n,expirySlot:20n,lots:2n,limit:110n,feeBudget:5n});
  expect(groupClaimAmount(snapshot,group,0,true)).toBe(0n); // 45 reserved versus 22 funded cash.
  snapshot.slot=20n;expect(groupClaimAmount(snapshot,group,0,true)).toBe(2n);
  root.mode=1;root.isolatedMarketIndex=0;expect(groupClaimAmount(snapshot,group,1,true)).toBe(0n);
});
it('allows flat selected loss collection after source loss, but never credits an unvalued exposed root',()=>{
  const {snapshot,root,markets,group}=fixture();markets.forEach(market=>market.oracle.sourceDeadline=101n);
  root.positions[0].virtualScaled=-2_750_000_000n;expect(groupClaimAmount(snapshot,group,0,false)).toBe(2n);
  root.positions[0].virtualScaled=2_750_000_000n;expect(groupClaimAmount(snapshot,group,0,true)).toBe(2n);
  root.positions[1].lots=1n;expect(groupClaimAmount(snapshot,group,0,true)).toBe(0n);
  root.positions[0].lots=1n;root.positions[0].virtualScaled=-200n*SCALE;
  expect(groupClaimAmount(snapshot,group,0,false)).toBe(0n);
  snapshot.state.mode=3;expect(groupClaimAmount(snapshot,group,1,false)).toBe(0n);
});
it('builds only the next canonical read-only proof page and restarts on an observation change',async()=>{
  const {snapshot}=fixture();snapshot.members=await Promise.all(Array.from({length:10},async(_,index)=>(await fixtureKey(`group-proof-${index}`)).address));
  Object.assign(snapshot.certificate!,{count:10,next:8});
  const page=groupCertificatePage(snapshot)!;expect([page.start,page.end]).toEqual([8,10]);
  expect(page.instruction.accounts.slice(-2)).toEqual(snapshot.members.slice(8).map(address=>({address,role:AccountRole.READONLY})));
  snapshot.marketStates[1].observationSequence=1n;
  const restarted=groupCertificatePage(snapshot)!;expect([restarted.start,restarted.end]).toEqual([0,8]);
});
it('retains ambiguous settlement intents and sends collection only through the simulated immutable queue',async()=>{
  const {snapshot,root,group}=fixture(),key=await fixtureKey('group-settle-worker');root.positions[0].virtualScaled=-2_750_000_000n;
  const runtime=new GroupRuntime('postgresql://unused:unused@127.0.0.1:1/unused','test','http://127.0.0.1:2');
  runtime.snapshot=async()=>snapshot as any;runtime.queue.budget=vi.fn(async()=>{});
  let pending=true;runtime.store.pool.query=(async()=>({rows:[],rowCount:pending?1:0})) as any;
  const enqueue=vi.fn(async(..._args:Parameters<typeof runtime.enqueue>)=>{});runtime.enqueue=enqueue;
  try{
    expect((await runtime.settle(key)).reason).toBe('original-settlement-intent-pending');expect(enqueue).not.toHaveBeenCalled();
    pending=false;expect((await runtime.settle(key)).reason).toBe('funded-group-loss');
    const call=enqueue.mock.calls[0];expect(call[3]).toBe('group-settlement');expect(call[5]).toBe(true);
    expect(call[4]).toEqual({kind:'groupSequence',group,account:group,value:'3'});
    expect(sdk.getChangeGroupClaimV2InstructionDataDecoder().decode(call[1][1].data!)).toMatchObject({gain:false,amount:2n,marketIndex:0});
  }finally{await runtime.close();}
});

it('never infers proof-page nonexecution from an unchanged group sequence',async()=>{
  const {snapshot}=fixture(),key=await fixtureKey('group-proof-worker');
  const runtime=new GroupRuntime('postgresql://unused:unused@127.0.0.1:1/unused','test','http://127.0.0.1:2');
  runtime.snapshot=async()=>snapshot as any;runtime.queue.budget=vi.fn(async()=>{});
  runtime.store.pool.query=(async()=>({rows:[],rowCount:0})) as any;
  const enqueue=vi.fn(async(..._args:Parameters<typeof runtime.enqueue>)=>{});runtime.enqueue=enqueue;
  try{
    expect((await runtime.settle(key)).reason).toBe('complete-group-proof-page');
    expect(enqueue.mock.calls[0][4]).toBeNull();expect(enqueue.mock.calls[0][5]).toBe(true);
  }finally{await runtime.close();}
});
