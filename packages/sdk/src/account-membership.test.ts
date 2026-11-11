import {address} from '@solana/kit';
import {describe,it,expect} from 'vitest';
import * as sdk from './index.js';
import {accountFixture} from './account-test-fixture.js';

async function membershipFixture() {
  const fixture=await accountFixture(),{config,accounts,put,empty,margins,owner}=fixture;
  const margin=margins[0],id=(1n<<54n)+65n;
  const root=sdk.getMarginAccountDecoder().decode(Buffer.from(accounts.get(margin).data[0],'base64'));
  root.id=id;root.activationGeneration=7n;
  put(margin,sdk.getMarginAccountEncoder().encode(root));
  const [registry,bump]=await sdk.deriveVenueComponent(config.venue,'registry');
  const path=await sdk.deriveMemberPath(config.venue,id);
  put(registry,sdk.getVenueRegistryEncoder().encode({schemaVersion:10,revision:9n,venue:config.venue,membershipEpoch:12n,
    nextId:id+1n,registeredCount:2n,financialCount:1n,liveIndex:path[14][0],bump}));
  const [page,pageBump]=await sdk.deriveMemberPage(config.venue,id/64n);
  const members=empty(sdk.getMemberPageDecoder());
  Object.assign(members,{schemaVersion:10,revision:11n,venue:config.venue,pageIndex:id/64n,allocatedMask:2n,financialMask:2n,bump:pageBump});
  members.members.entries[1]={root:margin,lifecycle:2,activationGeneration:7n};
  put(page,sdk.getMemberPageEncoder().encode(members));
  const [storage,storageBump]=await sdk.deriveRecoveryStorage(config.venue);
  put(storage,sdk.getRecoveryStorageEncoder().encode({...empty(sdk.getRecoveryStorageDecoder()),schemaVersion:10,revision:3n,
    venue:config.venue,readyCapacity:64n,bump:storageBump}));
  for(const [level,[key,nodeBump]]of path.entries()) {
    const slot=Number(((id/64n)>>BigInt(4*level))&15n),counts=Array<bigint>(16).fill(0n);counts[slot]=1n;
    put(key,sdk.getMemberIndexNodeEncoder().encode({schemaVersion:10,revision:BigInt(20+level),venue:config.venue,level,
      prefix:(id/64n)>>BigInt(4*(level+1)),populatedMask:1<<slot,counts,bump:nodeBump}));
  }
  const rpc={call:async(method:string,args:unknown[]=[])=>({context:{slot:100},value:method==='getAccountInfo'?accounts.get(args[0] as string)??null:
    (args[0] as string[]).map(key=>accounts.get(key)??null)})};
  return {...fixture,margin,id,root,page,members,path,registry,storage,rpc};
}
describe('canonical membership client',()=>{
  it('preserves high stable identities and every path revision in the signed transition',async()=>{
    const fixture=await membershipFixture();
    const state=await sdk.readMarginMembership(fixture.rpc,fixture.config.venue,fixture.owner,fixture.margin);
    expect(state.root.id).toBe((1n<<54n)+65n);
    expect(state.indexRevisions).toEqual(Array.from({length:15},(_,index)=>BigInt(20+index)));
    expect(state.remaining).toHaveLength(15);
    const client=new sdk.AccountUserClient(fixture.config);Object.assign(client,{rpc:fixture.rpc});
    const instruction=await client.changeMembership(fixture.owner,fixture.margin,false);
    expect(instruction.accounts?.slice(-15).map(meta=>meta.address)).toEqual(fixture.path.map(([key])=>key));
    const args=sdk.getDeactivateMarginInstructionDataDecoder().decode(instruction.data!);
    expect(args.membershipEpoch).toBe(12n);expect(args.revision).toBe(fixture.root.revision);
  });
  it('rejects inconsistent page generations, ancestor counts and active maker binding',async()=>{
    for(const mutation of ['generation','count','binding','old-schema']) {
      const fixture=await membershipFixture();
      if(mutation==='generation') {
        fixture.members.members.entries[1].activationGeneration=6n;
        fixture.put(fixture.page,sdk.getMemberPageEncoder().encode(fixture.members));
      } else if(mutation==='count') {
        const [key]=fixture.path[14],state=sdk.getMemberIndexNodeDecoder().decode(Buffer.from(fixture.accounts.get(key).data[0],'base64'));
        state.counts[0]=2n;fixture.put(key,sdk.getMemberIndexNodeEncoder().encode(state));
      } else if(mutation==='binding') {
        const [key]=await sdk.deriveCapitalBinding(fixture.margin);fixture.put(key,Uint8Array.of(1));
      } else {fixture.root.schemaVersion=8;fixture.put(fixture.margin,sdk.getMarginAccountEncoder().encode(fixture.root));}
      await expect(sdk.readMarginMembership(fixture.rpc,fixture.config.venue,fixture.owner,fixture.margin)).rejects.toThrow();
    }
  });
  it('permits empty Registered retirement discovery without funded index or workspace',async()=>{
    const fixture=await membershipFixture();
    fixture.root.lifecycle=1;fixture.root.cash=0n;fixture.members.financialMask=0n;fixture.members.members.entries[1].lifecycle=1;
    fixture.put(fixture.margin,sdk.getMarginAccountEncoder().encode(fixture.root));
    fixture.put(fixture.page,sdk.getMemberPageEncoder().encode(fixture.members));
    for(const [key] of fixture.path)fixture.accounts.delete(key);fixture.accounts.delete(fixture.storage);
    const client=new sdk.AccountUserClient(fixture.config);Object.assign(client,{rpc:fixture.rpc});
    const instruction=await client.retire(fixture.owner,fixture.margin);
    expect(instruction.accounts?.some(meta=>meta.address===fixture.storage)).toBe(false);
    expect(sdk.getRetireMarginInstructionDataDecoder().decode(instruction.data!).revision).toBe(fixture.root.revision);
  });
  it('widens only namespaces and rejects out-of-domain page/path seeds',async()=>{
    expect([...sdk.namespaceIndexBytes(65537)]).toEqual([1,0,1,0]);
    expect([...sdk.accountIndexBytes(1,1)]).toEqual([1,0]);
    expect(()=>sdk.namespaceIndexBytes(2**32)).toThrow();
    expect(()=>sdk.deriveMemberPage(address('11111111111111111111111111111111'),1n<<58n)).toThrow();
    expect(()=>sdk.deriveMemberIndex(address('11111111111111111111111111111111'),14,1n)).toThrow();
  });
});
