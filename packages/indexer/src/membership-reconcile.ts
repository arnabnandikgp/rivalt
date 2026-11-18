/** Current canonical membership and rent identities, independently reconstructed
 * from finalized lifecycle history. None of these observations grants admission. */
import assert from 'node:assert/strict';
import {address} from '@solana/kit';
import * as sdk from '@rivalt/sdk';
import type {AccountState} from './account-projection.js';
import {accountFields} from './account-projection.js';

export const membershipDescriptors=[
  [sdk.RECOVERY_STORAGE_DISCRIMINATOR,99],
  [sdk.STORAGE_FUNDING_DISCRIMINATOR,123],
  [sdk.MARGIN_TOMBSTONE_DISCRIMINATOR,135],
  [sdk.STORAGE_TOMBSTONE_DISCRIMINATOR,72],
] as const;

export async function reconcileMembershipStorage(key:string,kind:number,bytes:Buffer,state:AccountState,
  binding:{venue:string;program:string},raw:(key:string)=>Buffer) {
  const venue=address(binding.venue),program=address(binding.program);
  const identity=async(value:{venue:string;bump:number},derived:Promise<readonly[string,number]>)=>{
    const [canonical,bump]=await derived;assert.equal(key,canonical);assert.equal(value.venue,venue);assert.equal(value.bump,bump);
  };
  if(kind===19) {
    const node=sdk.getMemberIndexNodeDecoder().decode(bytes);
    await identity(node,sdk.deriveMemberIndex(venue,node.level,node.prefix,program));
    const counts=Array<bigint>(16).fill(0n);
    for(const rootKey of state.members) {
      const page=BigInt(state.roots[rootKey].id)/64n;
      if(page>>BigInt(4*(node.level+1))===node.prefix)counts[Number((page>>BigInt(4*node.level))&15n)]++;
    }
    assert.deepEqual(node.counts,counts,'complete financial index counts');
    assert.equal(node.populatedMask,counts.reduce((mask,count,slot)=>count>0n?mask|(1<<slot):mask,0));
    return;
  }
  if(kind===20) {
    const page=sdk.getMemberPageDecoder().decode(bytes);
    await identity(page,sdk.deriveMemberPage(venue,page.pageIndex,program));
    let allocated=0n,financial=0n;
    for(let slot=0;slot<64;slot++) {
      const id=page.pageIndex*64n+BigInt(slot),rootKey=state.identities[id.toString()],entry=page.members.entries[slot];
      if(!rootKey) {
        assert.equal(entry.root,'11111111111111111111111111111111');assert.equal(entry.lifecycle,0);assert.equal(entry.activationGeneration,0n);continue;
      }
      const root=state.roots[rootKey],retired=state.tombstones[rootKey];assert(root||retired,'complete identity payload');
      allocated|=1n<<BigInt(slot);if(root?.lifecycle===2)financial|=1n<<BigInt(slot);
      assert.equal(entry.root,rootKey);assert.equal(entry.lifecycle,root?.lifecycle??3);
      assert.equal(entry.activationGeneration,BigInt((root??retired).activationGeneration));
    }
    assert.equal(page.allocatedMask,allocated);assert.equal(page.financialMask,financial);return;
  }
  if(kind===24) {
    const storage=sdk.getRecoveryStorageDecoder().decode(bytes);
    await identity(storage,sdk.deriveRecoveryStorage(venue,program));
    assert(storage.lockedEpoch===0n||storage.lockedEpoch===BigInt(state.resolution?.epoch??0),'workspace lock identity');
    if(state.safety?.mode===2)assert.equal(storage.lockedEpoch,BigInt(state.resolution!.epoch),'frozen workspace lock');
    else assert.equal(storage.lockedEpoch,0n,'unfrozen workspace lock');
    if(state.safety?.mode!==4)assert(storage.readyCapacity>=BigInt(state.members.length),'funded financial admission');
    assert(storage.targetCapacity===0n||storage.targetCapacity>storage.readyCapacity,'monotone pending capacity');
    if(storage.targetCapacity===0n)assert.equal(storage.nextAllocation,0n);
    return;
  }
  if(kind===25) {
    const receipt=sdk.getStorageFundingDecoder().decode(bytes);
    await identity(receipt,sdk.deriveStorageFunding(venue,receipt.allocation,program));
    assert.equal(receipt.revision,1n,'immutable payer receipt');assert.notEqual(receipt.rentPayer,'11111111111111111111111111111111');
    assert([17,18,19,20,21,22,23,27].includes(state.revisions[receipt.allocation]?.kind),'funded allocation coverage');
    const allocation=raw(receipt.allocation);assert.equal(allocation.subarray(18,50).toString('hex'),bytes.subarray(18,50).toString('hex'));
    return;
  }
  throw new Error(`Unsupported membership storage ${kind}`);
}

export async function requireMembershipCoverage(state:AccountState,venue:string,program:string) {
  const venueKey=address(venue),programKey=address(program);
  for(const [id,key]of Object.entries(state.identities)) {
    const [page]=await sdk.deriveMemberPage(venueKey,BigInt(id)/64n,programKey);
    assert.equal(state.revisions[page]?.kind,20,'complete registered page coverage');
    const member=state.roots[key];
    if(member?.lifecycle===2)for(let level=0;level<15;level++) {
      const [node]=await sdk.deriveMemberIndex(venueKey,level,(BigInt(id)/64n)>>BigInt(4*(level+1)),programKey);
      assert.equal(state.revisions[node]?.kind,19,'complete financial path coverage');
    }
  }
}
