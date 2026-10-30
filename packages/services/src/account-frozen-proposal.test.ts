import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import * as sdk from '@rivalt/sdk';
import {accountFixture} from '../../sdk/src/account-test-fixture.js';
import {readAccountRateProposal} from './account-frozen-proposal.js';

async function fixture() {
  const setup=await accountFixture(),{empty,put,config,accounts}=setup,venue=config.venue;
  const [[resolution,bump],[registry,registryBump]]=await Promise.all([sdk.deriveVenueComponent(venue,'resolution'),sdk.deriveVenueComponent(venue,'registry')]);
  const [third]=await sdk.deriveMarginAccount(setup.portfolio,2),members=[...setup.margins,third];
  const registryState={schemaVersion:3,venue,membershipVersion:4n,count:3,members,bump:registryBump};
  const registryBytes=sdk.getVenueRegistryEncoder().encode(registryState);
  put(registry,Buffer.concat([Buffer.from(registryBytes),Buffer.alloc(100)])); // Account allocation padding is not serialized membership.
  const header={...empty(sdk.getResolutionDecoder()),schemaVersion:3,venue,epoch:1n,stage:4,count:3,safetyEpoch:2n,termsEpoch:1n,
    registryHash:createHash('sha256').update(registryBytes.slice(8)).digest(),cashBefore:100n,poolsBefore:[0n,0n],insuranceBefore:[20n,10n],
    budgets:[20n,10n],positiveScaled:[80_000_000_000n,80_000_000_000n],bump};header.common.limbs[0]=160_000_000_000n;
  put(resolution,sdk.getResolutionEncoder().encode(header));
  const safety=sdk.getVenueSafetyDecoder().decode(Buffer.from(accounts.get(setup.safety).data[0],'base64'));
  put(setup.safety,sdk.getVenueSafetyEncoder().encode({...safety,mode:2,paused:true,resolutionEpoch:1n}));
  const pageStates=[];
  for(let pageIndex=0;pageIndex<2;pageIndex++) {
    const [key,pageBump]=await sdk.findResolutionPagePda(venue,pageIndex);
    const page={...empty(sdk.getResolutionPageDecoder()),schemaVersion:3,venue,epoch:1n,pageIndex,rowCount:pageIndex===0?2:1,bump:pageBump};
    for(let offset=0;offset<page.rowCount;offset++) {
      const id=pageIndex*2+offset;
      Object.assign(page.rows[offset],{member:members[id],cashBefore:id===0?100n:0n,collected:id===0?100n:0n,
        claimsScaled:id===0?[-80_000_000_000n,-80_000_000_000n]:id===1?[80_000_000_000n,0n]:[0n,80_000_000_000n]});
    }
    put(key,sdk.getResolutionPageEncoder().encode(page));pageStates.push({key,page});
  }
  const reads:string[][]=[],rpc={call:async(method:string,params:unknown[]=[])=>{
    const keys=method==='getAccountInfo'?[params[0] as string]:params[0] as string[];reads.push(keys);
    return {context:{slot:100},value:method==='getAccountInfo'?accounts.get(keys[0]):keys.map(key=>accounts.get(key)??null)};
  }};
  return {...setup,resolution,header,registry,registryState,pageStates,rpc,reads};
}
it('derives an untrusted proposal from one complete current frozen RPC batch',async()=>{
  const value=await fixture(),result=await readAccountRateProposal(value.rpc,value.config.venue,1n);
  expect(value.reads).toHaveLength(2);expect(value.reads[1]).toHaveLength(6);
  expect(result.proposal.rates).toEqual([{numerator:7n,denominator:8n},{numerator:3n,denominator:4n}]);
  expect(result.proposal.insuranceSpent).toEqual([20n,10n]);expect(result.header.proposalUploaded).toBe(0);
});
it('binds the unchanged financial schema to the explicitly configured profile',async()=>{
  const value=await fixture(),venue=value.config.venue;
  const original=sdk.getVenueDecoder().decode(Buffer.from(value.accounts.get(venue).data[0],'base64'));
  const result=await readAccountRateProposal(value.rpc,venue,1n);
  expect(result.proposal.rates).toEqual([{numerator:7n,denominator:8n},{numerator:3n,denominator:4n}]);
  value.put(venue,sdk.getVenueEncoder().encode({...original,profileVersion:3}));
  await expect(readAccountRateProposal(value.rpc,venue,1n)).rejects.toThrow(/profile/);
  await expect(readAccountRateProposal(value.rpc,venue,1n,3 as 4)).rejects.toThrow(/Unsupported/);
});
it('refuses a partial page, out-of-order member or already-applied row',async()=>{
  for(const mutation of ['count','member','applied'] as const) {
    const value=await fixture(),{key,page}=value.pageStates[0];
    if(mutation==='count')page.rowCount=1;
    if(mutation==='member')page.rows[0].member=value.margins[1];
    if(mutation==='applied')page.rows[0].applied=true;
    value.put(key,sdk.getResolutionPageEncoder().encode(page));
    await expect(readAccountRateProposal(value.rpc,value.config.venue,1n)).rejects.toThrow(/frozen page|member/);
  }
});
it('refuses changed registry membership, wrong page owner and wrong epoch',async()=>{
  const value=await fixture();value.put(value.registry,sdk.getVenueRegistryEncoder().encode({...value.registryState,membershipVersion:5n}));
  await expect(readAccountRateProposal(value.rpc,value.config.venue,1n)).rejects.toThrow(/registry hash/);
  value.put(value.registry,sdk.getVenueRegistryEncoder().encode(value.registryState));
  value.accounts.get(value.pageStates[0].key).owner=value.owner;
  await expect(readAccountRateProposal(value.rpc,value.config.venue,1n)).rejects.toThrow(/Foreign/);
  await expect(readAccountRateProposal(value.rpc,value.config.venue,2n)).rejects.toThrow(/awaiting/);
});
it('refuses final-batch stage changes after discovery',async()=>{
  const value=await fixture(),original=value.rpc.call;
  value.rpc.call=async(method,params)=>{
    if(method==='getMultipleAccounts')value.put(value.resolution,sdk.getResolutionEncoder().encode({...value.header,stage:5}));
    return original(method,params);
  };
  await expect(readAccountRateProposal(value.rpc,value.config.venue,1n)).rejects.toThrow(/stage/);
});
it('verifies frozen collections, aggregate cash and common denominator',async()=>{
  for(const mutation of ['collected','cash','common'] as const) {
    const value=await fixture();
    if(mutation==='collected') {
      const {key,page}=value.pageStates[0];page.rows[0].collected=99n;value.put(key,sdk.getResolutionPageEncoder().encode(page));
    }else {
      if(mutation==='cash')value.header.cashBefore=101n;else value.header.common.limbs[0]++;
      value.put(value.resolution,sdk.getResolutionEncoder().encode(value.header));
    }
    await expect(readAccountRateProposal(value.rpc,value.config.venue,1n)).rejects.toThrow(/collection|cash|denominator/);
  }
});
