// Provision only through signed instructions. These helpers allocate resources;
// financial effects still require the deployed program's actual handlers.
import assert from 'node:assert/strict';
import {AccountRole,getAddressEncoder,getProgramDerivedAddress,type Address} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import * as sdk from '@rivalt/sdk';
import type {Harness} from './harness.js';

type Common={venue:Address;safety:Address;custody:Address;registry:Address;eventAuthority:Address;program:Address};
const encoder=getAddressEncoder();
export async function recoveryKey(venue:Address,kind:number,register=0,page=0n) {
  assert(Number.isInteger(kind)&&kind>=0&&kind<5);
  return (await getProgramDerivedAddress({programAddress:sdk.CLEARING_PROGRAM_ADDRESS,seeds:[
    Buffer.from(['prepared-settlement','settlement-rates','settlement-plan','frozen-margin-page','resolution-limbs'][kind]),encoder.encode(venue),
    ...(kind===3?[sdk.memberIndexBytes(page)]:kind===4?[sdk.namespaceIndexBytes(register),sdk.memberIndexBytes(page)]:[])]}))[0];
}
export async function provisionRecoveryWorkspace(h:Harness,common:Common,payer:Keypair,capacity=64n) {
  assert(capacity>0n&&capacity<=1024n,'Explicit bounded test provisioning population');
  const [storage]=await sdk.deriveRecoveryStorage(common.venue),base={...common,storage},admin={...base,authority:payer};
  if(!await h.read(storage))await h.send('initialize reusable recovery storage',[await sdk.getInitializeRecoveryStorageInstructionAsync(admin)]);
  const state=async()=>sdk.getRecoveryStorageDecoder().decode((await h.read(storage))!);
  if((await state()).readyCapacity>=capacity)return storage;
  assert.equal((await state()).targetCapacity,0n);
  await h.send('begin recovery storage proof',[sdk.getBeginRecoveryProvisionInstruction({...admin,capacity,revision:(await state()).revision})]);
  const ceil=(value:bigint,divisor:bigint)=>(value+divisor-1n)/divisor;
  const schedule:{kind:number;register:number;page:bigint}[]=[0,1,2].map(kind=>({kind,register:0,page:0n}));
  for(let page=0n;page<ceil(capacity,8n);page++)schedule.push({kind:3,register:0,page});
  const bits=capacity===1n?0n:BigInt((capacity-1n).toString(2).length);
  const limbs=ceil(ceil(88n*capacity+4n*(87n+bits)+16n,64n),256n);
  for(let register=0;register<46;register++)for(let page=0n;page<limbs;page++)schedule.push({kind:4,register,page});
  const arcs=8n*capacity+6n;let hierarchy=0n;
  for(let level=ceil(arcs,64n);;level=ceil(level,64n)){hierarchy+=level;if(level===1n)break;}
  const pages=[ceil(capacity,36n),ceil(capacity+5n,28n),ceil(arcs,64n),ceil(arcs,256n),ceil(hierarchy,256n),ceil(capacity,256n),ceil(capacity,256n)];
  for(const [offset,count] of pages.entries())for(let page=0n;page<count;page++)schedule.push({kind:4,register:64+offset,page});
  for(const [index,item] of schedule.entries()) {
    const allocation=await recoveryKey(common.venue,item.kind,item.register,item.page),[receipt]=await sdk.deriveStorageFunding(common.venue,allocation);
    let current=await state();assert.equal(current.nextAllocation,BigInt(index));
    if(!await h.read(receipt))await h.send('fund canonical recovery allocation',[await sdk.getFundRecoveryAllocationInstructionAsync({...base,payer,allocation,receipt,
      ...item,generation:current.generation,ordinal:BigInt(index)})]);
    current=await state();
    await h.send('verify actual recovery allocation',[sdk.getVerifyRecoveryAllocationInstruction({...base,allocation,receipt,
      generation:current.generation,ordinal:BigInt(index),revision:current.revision})]);
  }
  assert.equal((await state()).readyCapacity,capacity);return storage;
}
export async function registerFinancialTestMargin(h:Harness,common:Common,payer:Keypair,input:{owner:Keypair;portfolio:Address;margin:Address;
  subaccountIndex:number;mode:number;isolatedMarketIndex:number;role:number}) {
  const registry=sdk.getVenueRegistryDecoder().decode((await h.read(common.registry))!);
  const [members]=await sdk.deriveMemberPage(common.venue,registry.nextId/64n);
  if(!await h.read(members)) {
    const [receipt]=await sdk.deriveStorageFunding(common.venue,members);
    await h.send('fund canonical registration page',[await sdk.getFundMemberPageInstructionAsync({...common,payer,allocation:members,receipt,pageIndex:registry.nextId/64n})]);
  }
  await h.send('register stable Financial candidate',[await sdk.getRegisterMarginInstructionAsync({...common,...input,members})],[input.owner]);
  const root=sdk.getMarginAccountDecoder().decode((await h.read(input.margin))!),path=await sdk.deriveMemberPath(common.venue,root.id);
  for(const [level,[allocation]] of path.entries())if(!await h.read(allocation)) {
    const [receipt]=await sdk.deriveStorageFunding(common.venue,allocation);
    await h.send('fund canonical Financial path',[await sdk.getFundMemberIndexInstructionAsync({...common,payer,allocation,receipt,level,
      prefix:(root.id/64n)>>BigInt(4*(level+1))})]);
  }
  const [storage]=await sdk.deriveRecoveryStorage(common.venue),[binding]=await sdk.deriveCapitalBinding(input.margin);
  const currentRegistry=sdk.getVenueRegistryDecoder().decode((await h.read(common.registry))!);
  const safety=sdk.getVenueSafetyDecoder().decode((await h.read(common.safety))!);
  const revisions=await Promise.all(path.map(async([key])=>sdk.getMemberIndexNodeDecoder().decode((await h.read(key))!).revision));
  const instruction=sdk.getActivateMarginInstruction({...common,...input,members,storage,binding,revision:root.revision,
    membershipEpoch:currentRegistry.membershipEpoch,safetyEpoch:safety.epoch,indexRevisions:revisions});
  await h.send('activate storage-backed Financial candidate',[{...instruction,accounts:[...instruction.accounts,
    ...path.map(([address])=>({address,role:AccountRole.WRITABLE}))]}],[input.owner]);
}
