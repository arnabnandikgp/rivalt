import {expect,it} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {accountFixture} from '../../sdk/src/account-test-fixture.js';
import {accountWorkerKeys,financialMembershipHash} from './account-worker-state.js';
import {readAccountRateProposal} from './account-frozen-proposal.js';

async function fixture() {
  const test=await accountFixture(),venue=test.config.venue,keys=await accountWorkerKeys(venue),epoch=1n;
  const [,registryBump]=await sdk.deriveVenueComponent(venue,'registry'),[,sourceBump]=await sdk.deriveVenueComponent(venue,'resolution');
  const registry={schemaVersion:9,revision:1n,venue,membershipEpoch:4n,nextId:(1n<<54n)+8n,registeredCount:3n,financialCount:3n,
    liveIndex:(await sdk.deriveMemberIndex(venue,14,0n))[0],bump:registryBump};
  test.put(keys.registry,sdk.getVenueRegistryEncoder().encode(registry));
  const source={...test.empty(sdk.getResolutionDecoder()),schemaVersion:9,revision:2n,venue,epoch,stage:2,count:3n,
    membershipEpoch:4n,liveIndex:registry.liveIndex,registryHash:financialMembershipHash({...registry,discriminator:sdk.VENUE_REGISTRY_DISCRIMINATOR}),
    cashBefore:100n,insuranceBefore:[20n,10n],bump:sourceBump};
  test.put(keys.resolution,sdk.getResolutionEncoder().encode(source));
  const [,storageBump]=await sdk.deriveRecoveryStorage(venue);
  test.put(keys.storage,sdk.getRecoveryStorageEncoder().encode({...test.empty(sdk.getRecoveryStorageDecoder()),schemaVersion:9,revision:2n,
    venue,readyCapacity:64n,lockedEpoch:epoch,bump:storageBump}));
  const [,preparedBump]=await sdk.deriveSettlementWorkspace(venue,'prepared');
  const prepared={...test.empty(sdk.getPreparedSettlementDecoder()),schemaVersion:9,revision:2n,venue,epoch,stage:3,count:3n,
    membershipEpoch:4n,insurance:[20n,10n],bump:preparedBump};
  const denominator=Buffer.alloc(320);denominator[0]=1;denominator[1]=3;denominator.writeBigUInt64LE(1n,24);
  prepared.state.denominator=denominator;test.put(keys.prepared,sdk.getPreparedSettlementEncoder().encode(prepared));
  const [,ratesBump]=await sdk.deriveSettlementWorkspace(venue,'rates');
  const rates={...test.empty(sdk.getSettlementRatesDecoder()),schemaVersion:9,revision:2n,venue,epoch,bump:ratesBump};
  const insurance=Buffer.alloc(64);insurance[0]=1;
  for(const [offset,value] of [[8,20n],[16,10n],[24,20n],[32,10n]] as const)insurance.writeBigUInt64LE(value,offset);
  rates.state.insurance=insurance;test.put(keys.rates,sdk.getSettlementRatesEncoder().encode(rates));
  const [,planBump]=await sdk.deriveSettlementWorkspace(venue,'plan');
  test.put(keys.plan,sdk.getSettlementPlanEncoder().encode({...test.empty(sdk.getSettlementPlanDecoder()),schemaVersion:9,revision:1n,venue,bump:planBump}));
  const [pageKey,pageBump]=await sdk.deriveFrozenMarginPage(venue,0n);
  const page={...test.empty(sdk.getFrozenMarginPageDecoder()),schemaVersion:9,revision:4n,venue,epoch,pageIndex:0n,rowCount:3,bump:pageBump};
  const third=(await sdk.deriveMarginAccount((await sdk.deriveAccountPortfolio(venue,test.owner,1))[0],0))[0];
  for(const [ordinal,id] of [0n,65n,(1n<<54n)+7n].entries())Object.assign(page.rows[ordinal],{id,member:[...test.margins,third][ordinal],
    originalRevision:5n,activationGeneration:BigInt(ordinal+1),cash:ordinal===0?100n:0n,
    claims:ordinal===0?[-80_000_000_000n,-80_000_000_000n]:ordinal===1?[80_000_000_000n,0n]:[0n,80_000_000_000n],collected:ordinal===0?100n:0n});
  test.put(pageKey,sdk.getFrozenMarginPageEncoder().encode(page));
  const [limbKey,limbBump]=await sdk.deriveSettlementLimbPage(venue,0,0n);
  const limb={...test.empty(sdk.getSettlementLimbPageDecoder()),schemaVersion:9,revision:3n,venue,epoch,wordCount:1,bump:limbBump};
  limb.payload.words[0]=1n;test.put(limbKey,sdk.getSettlementLimbPageEncoder().encode(limb));
  const rpc={call:async(method:string,args:unknown[]=[])=>({context:{slot:100},value:method==='getAccountInfo'?test.accounts.get(args[0] as string)??null:
    (args[0] as string[]).map(key=>test.accounts.get(key)??null)})};
  return {...test,venue,keys,epoch,registry,source,prepared,rates,page,pageKey,limb,limbKey,rpc};
}
it('reads sparse stable identities from frozen rows and emits exact reduced-LCM rate words',async()=>{
  const test=await fixture(),result=await readAccountRateProposal(test.rpc,test.venue,1n);
  expect(result.rows.map(row=>row.id)).toEqual([0n,65n,(1n<<54n)+7n]);
  expect(result.proposal.common).toBe(1n);expect(result.proposal.factor).toBe(8n);expect(result.proposal.numerators).toEqual([7n,6n]);
  expect(result.proposal.insuranceSpent).toEqual([20n,10n]);
});
it('rejects missing/mixed frozen rows, old domains, duplicate identities and wrong collection',async()=>{
  for(const mutation of ['missing','old-schema','wrong-epoch','duplicate-id','duplicate-key','cash','collection','denominator','membership','profile']) {
    const test=await fixture();
    if(mutation==='missing')test.accounts.delete(test.pageKey);
    else if(mutation==='denominator'){test.limb.payload.words[0]=2n;test.put(test.limbKey,sdk.getSettlementLimbPageEncoder().encode(test.limb));}
    else if(mutation==='membership'){test.registry.membershipEpoch++;test.put(test.keys.registry,sdk.getVenueRegistryEncoder().encode(test.registry));}
    else if(mutation==='profile') {
      const venue=sdk.getVenueDecoder().decode(Buffer.from(test.accounts.get(test.venue).data[0],'base64'));venue.profileVersion=4;
      test.put(test.venue,sdk.getVenueEncoder().encode(venue));
    } else {
      if(mutation==='old-schema')test.page.schemaVersion=8;
      if(mutation==='wrong-epoch')test.page.epoch++;
      if(mutation==='duplicate-id')test.page.rows[1].id=0n;
      if(mutation==='duplicate-key')test.page.rows[1].member=test.page.rows[0].member;
      if(mutation==='cash')test.page.rows[1].cash=1n;
      if(mutation==='collection')test.page.rows[0].collected=99n;
      test.put(test.pageKey,sdk.getFrozenMarginPageEncoder().encode(test.page));
    }
    await expect(readAccountRateProposal(test.rpc,test.venue,1n),mutation).rejects.toThrow();
  }
});
it('does not publish a rate proposal when another continuation advances during page reads',async()=>{
  const test=await fixture();let calls=0;
  const rpc={call:async(method:string,args:unknown[]=[])=>{
    const result=await test.rpc.call(method,args);
    if(++calls===3){test.rates.revision++;test.put(test.keys.rates,sdk.getSettlementRatesEncoder().encode(test.rates));}
    return result;
  }};
  await expect(readAccountRateProposal(rpc,test.venue,1n)).rejects.toThrow(/revision changed/);
  await expect(readAccountRateProposal(test.rpc,test.venue,1n,4 as 5)).rejects.toThrow(/Unsupported/);
});
