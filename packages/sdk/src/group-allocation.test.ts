import {expect,it} from 'vitest';
import * as sdk from './index.js';
import {fixtureKey} from '../../../tests/rpc-contract/custody-cases.js';

const scale=1_000_000_000n;
async function environment(){
  const keys=await Promise.all(['group','trader','a','b','owner','a-owner','b-owner'].map(name=>fixtureKey(`p21-allocation-${name}`)));
  const [group,trader,capitalA,capitalB,owner,ownerA,ownerB]=keys.map(key=>key.address),domain=new Uint8Array(32).fill(13);
  const marketKeys=await Promise.all([0,1].map(async index=>(await sdk.findGroupMarketPda(group,index))[0]));
  const empty=<Value>(decoder:{fixedSize:number;decode:(bytes:Uint8Array)=>Value})=>decoder.decode(new Uint8Array(decoder.fixedSize));
  const root={...empty(sdk.getMarginAccountV2Decoder()),schemaVersion:2,group,owner,id:0,mode:0,isolatedMarketIndex:255,cash:1_000_000n};
  const marketStates=marketKeys.map((_,index)=>({...empty(sdk.getGroupMarketV2Decoder()),schemaVersion:2,group,index,termsEpoch:1n,configEpoch:1n,
    lotsPerUnit:index===0?1_000_000n:100_000n,referencePrice:10_000n,lower:9900n,upper:10100n,validFrom:1n,validUntil:1000n}));
  marketStates.forEach(market=>Object.assign(market.oracle,{status:2,sampledAt:100n,sourceDeadline:120n,lastQualified:100n,heldEpoch:1n,heldUntil:106n,heldSlot:1000n}));
  const capitals=[capitalA,capitalB].map((_,index)=>({...empty(sdk.getMarginAccountV2Decoder()),schemaVersion:2,group,owner:[ownerA,ownerB][index],id:index+1,
    mode:1,role:1,isolatedMarketIndex:0,cash:500_000_000n}));
  const makers=await Promise.all(capitals.map(async(capital,index)=>{
    const [registration,bump]=await sdk.findGroupMakerPda(marketKeys[0],index);return ({
    market:marketKeys[0],marketIndex:0,makerId:index,registration,bump,capital,approved:true,synchronized:true,programDataHash:'00'.repeat(32),
    registrationState:{...empty(sdk.getMakerRegistrationV2Decoder()),schemaVersion:2,group,market:marketKeys[0],marketIndex:0,makerId:index,owner:capital.owner,capital:[capitalA,capitalB][index],
      quoteEpoch:1n,authorityEpoch:1n,startSlot:1n,expirySlot:1000n,inventoryLimit:100_000n},
    state:{version:2,makerId:index,owner:capital.owner,market:marketKeys[0],capital:[capitalA,capitalB][index],domain,quoteEpoch:1n,startSlot:1n,expirySlot:1000n,bump:0},
  });}));
  const snapshot={group,commitment:'confirmed',state:{mode:2,paused:false,domain,sequence:7n},markets:marketKeys,marketStates,slot:100n,now:100n,
    roots:{[trader]:root,[capitalA]:capitals[0],[capitalB]:capitals[1]}} as unknown as sdk.GroupSnapshot;
  const input:sdk.GroupAllocationInput={snapshot,trader,marketIndex:0,side:0,lots:1n,makers,maxFee:1_000_000n,allInLimit:1_000_000_000n};
  return {input,root,marketStates,makers,snapshot};
}
it('retains exact A/B economics and tie-breaking for the qualified V2 envelope',async()=>{
  const {input}=await environment();const result=sdk.allocateGroupRoute(input)!;
  expect(result).toMatchObject({grossQuote:10010n,fee:3n,allIn:10013n,legs:[{makerId:0,lots:1n,grossQuote:10010n}]});
  // Independent marginal sum: A 21*10010 + (0+...+20), B 79*10030.
  const split=sdk.allocateGroupRoute({...input,lots:100n})!;
  expect(split).toMatchObject({grossQuote:1_002_790n,fee:201n,allIn:1_002_991n});
  expect(split.legs.map(leg=>[leg.makerId,leg.lots])).toEqual([[0,21n],[1,79n]]);
  expect(sdk.allocateGroupRoute({...input,lots:100n,makers:[...input.makers].reverse()})).toEqual(split);
});
it('counts one cash balance and every losing slot while granting no positive open-profit credit',async()=>{
  const {input,root}=await environment();root.cash=1123n;
  // One BTC lot: 110 adverse loss + 1,010 IM + 3 fee = 1,123 atoms.
  expect(sdk.allocateGroupRoute(input)).not.toBeNull();
  root.positions[1].virtualScaled=-1n;expect(sdk.allocateGroupRoute(input)).toBeNull(); // Exact fractional claim matters.
  root.positions[1].virtualScaled=1_000_000n*scale;root.cash=1122n;
  expect(sdk.allocateGroupRoute(input)).toBeNull(); // No positive unpaid offset.
});
it('includes unmaterialized second-market funding and both-market additive requirements',async()=>{
  const {input,root,marketStates,snapshot}=await environment();
  root.positions[1].lots=1n;root.positions[1].virtualScaled=-10_000n*scale;root.cash=2233n;
  // Other slot adds 100 adverse loss + 1,010 IM. Pending 0.1 atom pushes below exact threshold.
  expect(sdk.allocateGroupRoute(input)).not.toBeNull();
  marketStates[1].oracle.premiumScaled=360n*scale;snapshot.now=101n;
  const before=structuredClone(root);expect(sdk.allocateGroupRoute(input)).toBeNull();expect(root).toEqual(before);
});
it('refreshes stored remaining reserves after the actual prefix fee and order fill',async()=>{
  const {input,root}=await environment();root.cash=1123n;
  const stored=root.book.orders[0];stored.marketIndex=0;
  Object.assign(stored.order,{id:1n,version:1n,state:1,termsEpoch:1n,side:0,lots:1n,filled:0n,limit:10013n,feeBudget:100n,startSlot:1n,expirySlot:1000n});
  // An unrelated still-live order cannot be omitted; the fully filled selected
  // order's reserve is removed, retaining the exact three-atom taker fee.
  expect(sdk.allocateGroupRoute(input)).toBeNull();
  expect(sdk.allocateGroupRoute({...input,stored:{id:1n,version:1n,filled:0n}})).toMatchObject({fee:3n});
  stored.delegateEpoch=1n;root.delegateExpirySlot=0n;
  expect(()=>sdk.allocateGroupRoute({...input,stored:{id:1n,version:1n,filled:0n}})).toThrow(/Stored group order/);
});
it('admits only a strict post-fee whole-account deficit improvement for reductions below IM',async()=>{
  const {input,root}=await environment();
  root.cash=1000n;root.positions[0].lots=2n;root.positions[0].virtualScaled=-20_000n*scale;
  const reduction={...input,side:1 as const,lots:1n,allInLimit:0n,reduceOnly:true};
  expect(sdk.allocateGroupRoute(reduction)).not.toBeNull();
  // Make the execution cost larger than the released MM: selling 1 at 9,000
  // loses 1,000 atoms plus fee, so the whole-account deficit grows.
  input.makers[0].state.makerId=0;input.makers[0].registrationState.sellConsumed=990n; // Exceeds A's fixed depth; A unavailable.
  input.makers[1].registrationState.sellConsumed=1226n; // B price 10,000 - 30 - 970 = 9,000.
  expect(sdk.allocateGroupRoute(reduction)).toBeNull();
});
it('rejects a stale relevant second market but does not add an empty-market price dependency',async()=>{
  const {input,root,marketStates,snapshot}=await environment();marketStates[1].oracle.sourceDeadline=100n;
  expect(sdk.allocateGroupRoute(input)).not.toBeNull();
  root.positions[1].lots=1n;expect(()=>sdk.allocateGroupRoute(input)).toThrow(/source unavailable/);
  root.positions[1].lots=0n;const order=root.book.orders[0];order.marketIndex=1;
  Object.assign(order.order,{id:1n,state:1,lots:1n,termsEpoch:1n,expirySlot:snapshot.slot+100n});
  expect(()=>sdk.allocateGroupRoute(input)).toThrow(/source unavailable/);
});
it('excludes the taker owner from provider selection and authenticates isolated capital identity',async()=>{
  const {input,root,makers,snapshot}=await environment();makers[0].registrationState.owner=root.owner;
  expect(sdk.allocateGroupRoute(input)!.legs.map(leg=>leg.makerId)).toEqual([1]);
  makers[1].registrationState.owner=root.owner;expect(sdk.allocateGroupRoute(input)).toBeNull();
  makers[1].registrationState.owner=makers[1].state.owner;snapshot.roots[makers[1].registrationState.capital].role=0;
  expect(()=>sdk.allocateGroupRoute(input)).toThrow(/isolated group maker/);
});

it('builds both-market sequence/authority bindings and exact reviewed fee/limit bytes',async()=>{
  const {input,root,snapshot}=await environment();
  const quote=await sdk.buildGroupRoute(input,root.owner);expect(quote).not.toBeNull();
  const instruction=quote!.instructions[1],decoded=sdk.getExecuteMarginRouteV2InstructionDataDecoder().decode(instruction.data!);
  expect(decoded).toMatchObject({sequence:7n,observations:[0n,0n],intent:{nonce:0n,side:0,lots:1n,maxFee:3n,allInLimit:10013n,
    generation:{__option:'Some',value:0n},expirySlot:250n}});
  expect(instruction.accounts!.at(-1)!.address).toBe(snapshot.markets[1]);
  expect(sdk.hex(quote!.instructions[0].data!)).toBe('02c0270900');
  await expect(sdk.buildGroupRoute(input,input.makers[0].state.owner)).rejects.toThrow(/trade authority/);
  snapshot.commitment='finalized';await expect(sdk.buildGroupRoute(input,root.owner)).rejects.toThrow(/confirmed snapshot/);
});
it('builds stored order execution from the live durable prefix, without an owner trading signature',async()=>{
  const {input,root}=await environment();const order=root.book.orders[0].order;
  Object.assign(order,{id:1n,version:2n,state:2,side:0,lots:2n,filled:1n,notional:10000n,feeCharged:2n,
    termsEpoch:1n,limit:10013n,feeBudget:100n,startSlot:1n,expirySlot:1000n});
  const quote=await sdk.buildGroupRoute({...input,stored:{id:1n,version:2n,filled:1n}},input.makers[0].state.owner);
  expect(quote).not.toBeNull();expect(quote!.allocation.fee).toBe(3n); // ceil(20010/5000) - ceil(10000/5000)
  const decoded=sdk.getExecuteMarginOrderV2InstructionDataDecoder().decode(quote!.instructions[1].data!);
  expect(decoded.args).toMatchObject({id:1n,version:2n,filled:1n,lots:1n});
});
