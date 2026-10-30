import {expect,it} from 'vitest';
import * as sdk from './index.js';
import {accountTradeFixture} from './account-test-fixture.js';

async function environment() {
  const fixture=await accountTradeFixture(),trader=fixture.margins[0];
  const snapshot=await sdk.readAccountTradeSnapshot(fixture.rpc,fixture.config,trader,0);
  const input:sdk.AccountAllocationInput={snapshot,trader,marketIndex:0,side:0,lots:1n,maxFee:1_000_000n,allInLimit:1_000_000_000n};
  return {fixture,input,snapshot,root:snapshot.roots[trader]};
}
it('reads trader and selected maker capitals in one final batch without unrelated roots or a global stamp',async()=>{
  const {fixture,snapshot}=await environment();
  expect(fixture.batches).toHaveLength(3);expect(fixture.batches[2]).toHaveLength(24);
  expect(fixture.batches.flat()).not.toContain(fixture.margins[1]);
  expect(snapshot.makers).toHaveLength(2);expect(snapshot.makers.every(maker=>maker.approved&&maker.synchronized)).toBe(true);
  expect(Object.keys(snapshot.roots)).toHaveLength(3);
});
it('retains the independent marginal A/B sums, fee rounding and stable split',async()=>{
  const {input,root,snapshot}=await environment();root.cash=1_000_000n;
  expect(sdk.allocateAccountRoute(input)).toMatchObject({grossQuote:10010n,fee:3n,allIn:10013n,legs:[{makerId:0,lots:1n}]});
  // A: 21*10,010 + (0+...+20). B: 79*10,030. ceil(total/5,000)=201.
  expect(sdk.allocateAccountRoute({...input,lots:100n})).toMatchObject({grossQuote:1_002_790n,fee:201n,allIn:1_002_991n,
    legs:[{makerId:0,lots:21n},{makerId:1,lots:79n}]});
  snapshot.makers.reverse();expect(sdk.allocateAccountRoute({...input,lots:100n})!.legs.map(leg=>leg.makerId)).toEqual([0,1]);
});
it('uses whole-account losses, pending other-market funding and no positive unpaid credit',async()=>{
  const {input,root,snapshot}=await environment();root.cash=1123n;
  expect(sdk.allocateAccountRoute(input)).not.toBeNull();root.positions[1].virtualScaled=-1n;
  expect(sdk.allocateAccountRoute(input)).toBeNull();root.positions[1].virtualScaled=1_000_000_000_000n;root.cash=1122n;
  expect(sdk.allocateAccountRoute(input)).toBeNull();
  root.cash=2233n;Object.assign(root.positions[1],{lots:1n,virtualScaled:-10_000_000_000_000n});
  expect(sdk.allocateAccountRoute(input)).not.toBeNull();snapshot.marketStates[1].oracle.premiumScaled=360_000_000_000n;snapshot.now=501n;
  expect(sdk.allocateAccountRoute(input)).toBeNull();
});
it('binds root/market/maker authority and consumed prefixes without observation/global sequence',async()=>{
  const {input,root,snapshot}=await environment();snapshot.makers[0].registrationState.buyConsumed=7n;
  const quote=await sdk.buildAccountRoute(input,root.owner),instruction=quote!.instructions[1];
  const decoded=sdk.getExecuteAccountRouteInstructionDataDecoder().decode(instruction.data!);
  expect(decoded).toMatchObject({guard:{safetyEpoch:2n,venueTermsEpoch:1n,nonce:4n,stateVersion:9n},termsEpoch:1n,configEpoch:1n,
    side:0,lots:1n,expirySlot:250n,legs:[{quoteEpoch:1n,authorityEpoch:1n,expectedConsumed:7n}]});
  expect(decoded).not.toHaveProperty('sequence');expect(decoded).not.toHaveProperty('observationSequence');
  snapshot.custodyState.sequence++;snapshot.marketStates[1].observationSequence++;
  expect((await sdk.buildAccountRoute(input,root.owner))!.instructions[1].data).toEqual(instruction.data);
  await expect(sdk.buildAccountRoute(input,snapshot.makers[0].state.owner)).rejects.toThrow(/trade authority/);
});
it('validates stored authority/prefix and recomputes reservations after a full fill',async()=>{
  const {input,root,snapshot}=await environment();root.cash=1123n;const stored=root.book.orders[0];stored.marketIndex=0;
  Object.assign(stored.order,{id:1n,version:2n,state:1,termsEpoch:1n,side:0,lots:1n,limit:10013n,feeBudget:100n,startSlot:1n,expirySlot:1000n});
  expect(sdk.allocateAccountRoute(input)).toBeNull();
  const quote=await sdk.buildAccountRoute({...input,stored:{id:1n,version:2n,filled:0n}},snapshot.makers[0].state.owner);
  expect(quote!.allocation.fee).toBe(3n);
  expect(sdk.getExecuteAccountOrderInstructionDataDecoder().decode(quote!.instructions[1].data!)).toMatchObject({id:1n,version:2n,filled:0n,lots:1n});
  stored.delegateEpoch=1n;root.delegateExpirySlot=0n;
  expect(()=>sdk.allocateAccountRoute({...input,stored:{id:1n,version:2n,filled:0n}})).toThrow(/Stored/);
});
it('rejects frozen/ineligible cross and stale relevant sources while preserving isolated relevance',async()=>{
  const {input,root,snapshot}=await environment();snapshot.marketStates[1].oracle.sourceDeadline=500n;
  expect(sdk.allocateAccountRoute(input)).not.toBeNull();root.positions[1].lots=1n;
  expect(()=>sdk.allocateAccountRoute(input)).toThrow(/source unavailable/);root.positions[1].lots=0n;
  snapshot.marketStates[0].crossEligible=false;expect(()=>sdk.allocateAccountRoute(input)).toThrow(/cross eligible/);
  root.mode=1;root.isolatedMarketIndex=0;expect(sdk.allocateAccountRoute(input)).not.toBeNull();
  snapshot.safetyState.mode=2;expect(()=>sdk.allocateAccountRoute(input)).toThrow(/trading unavailable/);
});
it('excludes unsynchronized/quarantined/unapproved modules and rejects foreign capital/config',async()=>{
  const {input,snapshot,fixture}=await environment();snapshot.makers[0].approved=false;
  expect(sdk.allocateAccountRoute(input)!.legs[0].makerId).toBe(1);
  snapshot.makers[1].synchronized=false;expect(sdk.allocateAccountRoute(input)).toBeNull();
  const maker=fixture.makers[0],bytes=Buffer.from(fixture.accounts.get(maker.config).data[0],'base64');bytes[0]^=1;
  fixture.put(maker.config,bytes,maker.pricingProgram);
  await expect(sdk.readAccountTradeSnapshot(fixture.rpc,fixture.config,fixture.margins[0],0)).rejects.toThrow(/config schema/);
});
it('uses final-batch maker epochs and code hashes rather than discovery financial values',async()=>{
  const fixture=await accountTradeFixture(),original=fixture.rpc.call,maker=fixture.makers[0];
  fixture.rpc.call=async(method,params)=>{
    if(fixture.batches.length===2) {
      fixture.put(maker.registration,sdk.getFixedMakerRegistrationEncoder().encode({...maker.state,buyConsumed:19n,quoteEpoch:2n}));
      const code=Buffer.from(fixture.accounts.get(maker.programData).data[0],'base64');code[50]^=1;
      fixture.put(maker.programData,code,fixture.accounts.get(maker.programData).owner);
    }return original(method,params);
  };
  const snapshot=await sdk.readAccountTradeSnapshot(fixture.rpc,fixture.config,fixture.margins[0],0);
  expect(snapshot.makers[0]).toMatchObject({approved:false,synchronized:false,registrationState:{buyConsumed:19n,quoteEpoch:2n}});
});
