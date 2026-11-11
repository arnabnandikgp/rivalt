import {it,expect} from 'vitest';
import {membershipRequest,initialMembershipRequest,membershipRequestAccounts} from './account-membership-scan.js';
import * as sdk from './index.js';
import {accountFixture} from './account-test-fixture.js';

function sparseMember() {
  const count=2n,id=(1n<<54n)+65n,page=id/64n,bytes=Buffer.alloc(544);
  bytes.set([1,14,2,1]);bytes.writeBigUInt64LE(count,8);bytes.writeBigUInt64LE(1n,16);
  bytes.writeBigUInt64LE(page,24);bytes.writeBigUInt64LE(2n,32);
  for(let depth=0;depth<15;depth++) {
    const offset=64+32*depth,shift=BigInt((15-depth)*4);
    bytes.writeBigUInt64LE(page>>shift,offset);bytes.writeBigUInt64LE(depth===0?2n:1n,offset+8);
    bytes.writeBigUInt64LE(depth===0?1n:0n,offset+16);
    bytes[offset+24]=Number((page>>BigInt((14-depth)*4))&15n)+1;
  }
  return {count,id,bytes};
}
it('decodes full-width stable IDs independently from ordinal and validates ancestry',()=>{
  const {count,id,bytes}=sparseMember();
  expect(membershipRequest(bytes,count)).toEqual({kind:'member',ordinal:1n,id});
  const page=Buffer.from(bytes);page[2]=1;page.writeBigUInt64LE(0n,32);
  expect(membershipRequest(page,count)).toEqual({kind:'page',index:id/64n,count:1});
  for(const [offset,value] of [[0,2],[1,15],[2,4],[4,1],[89,1],[88,0],[543,1]]) {
    const bad=Buffer.from(bytes);bad[offset]=value;expect(()=>membershipRequest(bad,count)).toThrow();
  }
  expect(()=>membershipRequest(bytes,3n)).toThrow();
});
it('distinguishes final ancestor work from done and refuses incomplete terminal cursors',()=>{
  const bytes=Buffer.alloc(544);bytes[0]=1;bytes.writeBigUInt64LE(71n,8);bytes.writeBigUInt64LE(71n,16);
  bytes.writeBigUInt64LE(71n,72);bytes.writeBigUInt64LE(71n,80);bytes[88]=1;
  expect(membershipRequest(bytes,71n)).toEqual({kind:'node',level:14,prefix:0n,count:71n});
  bytes[2]=3;bytes.fill(0,64);
  expect(membershipRequest(bytes,71n)).toEqual({kind:'done'});
  bytes.writeBigUInt64LE(70n,16);expect(()=>membershipRequest(bytes,71n)).toThrow();
  expect(initialMembershipRequest(1027n)).toEqual({kind:'node',level:14,prefix:0n,count:1027n});
  expect(()=>initialMembershipRequest(0n)).toThrow();
});
it('resolves a root only through the canonical authenticated Financial member slot',async()=>{
  const fixture=await accountFixture(),venue=fixture.config.venue,{id}=sparseMember();
  const [page,bump]=await sdk.deriveMemberPage(venue,id/64n),state=fixture.empty(sdk.getMemberPageDecoder());
  Object.assign(state,{schemaVersion:9,revision:1n,venue,pageIndex:id/64n,allocatedMask:2n,financialMask:2n,bump});
  state.members.entries[1]={root:fixture.margins[0],lifecycle:2,activationGeneration:7n};
  fixture.put(page,sdk.getMemberPageEncoder().encode(state));
  const rpc={call:async()=>({value:fixture.accounts.get(page)})};
  expect((await membershipRequestAccounts(rpc,venue,{kind:'member',ordinal:1n,id})).map(meta=>meta.address))
    .toEqual([page,fixture.margins[0]]);
  for(const patch of [{financialMask:0n},{schemaVersion:8},{pageIndex:0n}]) {
    fixture.put(page,sdk.getMemberPageEncoder().encode({...state,...patch}));
    await expect(membershipRequestAccounts(rpc,venue,{kind:'member',ordinal:1n,id})).rejects.toThrow();
  }
});
