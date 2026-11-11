/** Bounded test-operator requests. The signed program authenticates all supplied
 * accounts; these helpers never modify or synthesize financial account state. */
import assert from 'node:assert/strict';
import {AccountRole,type Address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {Harness} from './harness.js';
export async function scanMetas(h:Harness,venue:Address,request:sdk.MembershipRequest,writableRoot=false) {
  if(request.kind==='done')return [];
  if(request.kind==='node')return [{address:(await sdk.deriveMemberIndex(venue,request.level,request.prefix))[0],role:AccountRole.READONLY}];
  const [address]=await sdk.deriveMemberPage(venue,request.kind==='page'?request.index:request.id/64n);
  if(request.kind==='page')return [{address,role:AccountRole.READONLY}];
  const page=sdk.getMemberPageDecoder().decode((await h.read(address))!);
  const entry=page.members.entries[Number(request.id%64n)];assert.equal(entry.lifecycle,2);
  return [{address,role:AccountRole.READONLY},{address:entry.root,role:writableRoot?AccountRole.WRITABLE:AccountRole.READONLY}];
}
export async function financialRoots(h:Harness,venue:Address,registry:Address) {
  const state=sdk.getVenueRegistryDecoder().decode((await h.read(registry))!),roots:Address[]=[];
  async function node(level:number,prefix:bigint,expected:bigint) {
    const [key]=await sdk.deriveMemberIndex(venue,level,prefix),value=sdk.getMemberIndexNodeDecoder().decode((await h.read(key))!);
    assert.equal(value.counts.reduce((sum,count)=>sum+count,0n),expected);
    for(let slot=0;slot<16;slot++)if(value.counts[slot]) {
      const next=prefix*16n+BigInt(slot);
      if(level)await node(level-1,next,value.counts[slot]);
      else {const [key]=await sdk.deriveMemberPage(venue,next),page=sdk.getMemberPageDecoder().decode((await h.read(key))!);
        const members=page.members.entries.filter(entry=>entry.lifecycle===2);assert.equal(BigInt(members.length),value.counts[slot]);roots.push(...members.map(entry=>entry.root));}
    }
  }
  if(state.financialCount)await node(14,0n,state.financialCount);
  assert.equal(BigInt(roots.length),state.financialCount);assert.equal(new Set(roots).size,roots.length);return roots;
}
export async function backingStep(h:Harness,common:{venue:Address;safety:Address;registry:Address;btc:Address;eth:Address;ledger:Address;certificate:Address;eventAuthority:Address;program:Address},restart=false) {
  const proof=sdk.getSettlementCertificateDecoder().decode((await h.read(common.certificate))!);
  const registry=sdk.getVenueRegistryDecoder().decode((await h.read(common.registry))!);
  const request=restart?sdk.initialMembershipRequest(registry.financialCount):sdk.membershipRequest(proof.membership.checkpoint,proof.count);
  const instruction=sdk.getCheckMarketBackingInstruction({...common,revision:proof.revision,restart});
  return {request,proof,instruction:{...instruction,accounts:[...instruction.accounts,...await scanMetas(h,common.venue,request,true)]}};
}
