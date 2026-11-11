import {AccountRole,type Address,type ReadonlyUint8Array} from '@solana/kit';
import * as protocol from './generated/index.js';
import {deriveMemberIndex,deriveMemberPage} from './account-addresses.js';
import {ACCOUNT_SCHEMA,MEMBER_FINANCIAL,decodeMembershipAccount} from './account-membership.js';
import {requireValue,type UserRpc} from './wallet-client.js';

export type MembershipRequest={kind:'node';level:number;prefix:bigint;count:bigint}
  |{kind:'page';index:bigint;count:number}|{kind:'member';ordinal:bigint;id:bigint}|{kind:'done'};
const MAX_PAGE=((1n<<64n)-1n)/64n;
const population=(value:bigint)=>{let count=0;for(;value;value&=value-1n)count++;return count;};

/** Decode authenticated checkpoint format 1. This validates serialization and
 * selects a bounded request; only the program authorizes financial progress. */
export function membershipRequest(encoded:ReadonlyUint8Array|readonly number[],count:bigint):MembershipRequest {
  const bytes=Uint8Array.from(encoded),view=new DataView(bytes.buffer),read=(offset:number)=>view.getBigUint64(offset,true);
  requireValue(bytes.length===544&&bytes[0]===1&&bytes[1]<15&&bytes[2]<4&&count>0n
    &&bytes.slice(4,8).every(byte=>byte===0)&&bytes.slice(40,64).every(byte=>byte===0),'Invalid membership checkpoint header.');
  const depth=bytes[1],stage=bytes[2],pageCount=bytes[3],processed=read(16),page=read(24),mask=read(32);
  requireValue(read(8)===count&&processed<=count,'Wrong membership checkpoint count.');
  let visited=0n;
  const frames=Array.from({length:15},(_,index)=>{
    const offset=64+index*32;
    requireValue(bytes.slice(offset+25,offset+32).every(byte=>byte===0),'Invalid membership frame padding.');
    return {prefix:read(offset),expected:read(offset+8),visited:read(offset+16),next:bytes[offset+24]};
  });
  for(const [index,frame] of frames.entries()) {
    if(index>depth||stage===3) {
      requireValue(frame.prefix===0n&&frame.expected===0n&&frame.visited===0n&&frame.next===0,'Invalid inactive membership frame.');continue;
    }
    requireValue(frame.expected>0n&&frame.visited<=frame.expected&&frame.next<=16
      &&frame.prefix<=MAX_PAGE>>BigInt((15-index)*4),'Invalid membership frame.');
    if(index===0)requireValue(frame.prefix===0n&&frame.expected===count,'Invalid root membership frame.');
    else {const parent=frames[index-1];requireValue(parent.next>0&&frame.prefix===parent.prefix*16n+BigInt(parent.next-1)
      &&parent.visited+frame.expected<=parent.expected,'Invalid membership frame ancestry.');}
    visited+=frame.visited;
  }
  const frame=frames[depth];
  if(stage===0||stage===3) {
    requireValue(page===0n&&mask===0n&&pageCount===0,'Unexpected membership page residue.');
    if(stage===3) {requireValue(depth===0&&processed===count,'Incomplete membership cursor.');return {kind:'done'};}
    requireValue(visited===processed,'Invalid membership visited count.');
    return {kind:'node',level:14-depth,prefix:frame.prefix,count:frame.expected};
  }
  requireValue(depth===14&&frame.next>0&&page<=MAX_PAGE&&page===frame.prefix*16n+BigInt(frame.next-1)
    &&pageCount>=1&&pageCount<=64&&frame.visited+BigInt(pageCount)<=frame.expected,'Invalid membership page cursor.');
  const remaining=population(mask);
  requireValue(stage===1?remaining===0:remaining>0&&remaining<=pageCount,'Invalid membership remaining mask.');
  requireValue(visited+BigInt(stage===1?0:pageCount-remaining)===processed,'Invalid membership page progress.');
  if(stage===1)return {kind:'page',index:page,count:pageCount};
  let slot=0;while((mask&(1n<<BigInt(slot)))===0n)slot++;
  return {kind:'member',ordinal:processed,id:page*64n+BigInt(slot)};
}

export function initialMembershipRequest(count:bigint):MembershipRequest {
  requireValue(count>0n&&count<(1n<<64n),'Invalid Financial population.');
  return {kind:'node',level:14,prefix:0n,count};
}

/** Canonical node/page keys come from the cursor. A member key comes only from
 * its authenticated fixed page, never a caller's registry-shaped list. */
export async function membershipRequestAccounts(rpc:Pick<UserRpc,'call'>,venue:Address,request:MembershipRequest) {
  const readonly=(address:Address)=>({address,role:AccountRole.READONLY});
  if(request.kind==='done')return [];
  if(request.kind==='node')return [readonly((await deriveMemberIndex(venue,request.level,request.prefix))[0])];
  const index=request.kind==='page'?request.index:request.id/64n;
  const [page,bump]=await deriveMemberPage(venue,index);
  if(request.kind==='page')return [readonly(page)];
  const response=await rpc.call('getAccountInfo',[page,{encoding:'base64',commitment:'confirmed'}]);
  const state=decodeMembershipAccount(response.value,protocol.MEMBER_PAGE_DISCRIMINATOR,protocol.getMemberPageDecoder());
  const slot=Number(request.id%64n),bit=1n<<BigInt(slot),entry=state.members.entries[slot];
  requireValue(state.schemaVersion===ACCOUNT_SCHEMA&&state.revision>0n&&state.venue===venue&&state.pageIndex===index&&state.bump===bump
    &&(state.allocatedMask&bit)!==0n&&(state.financialMask&bit)!==0n&&entry.lifecycle===MEMBER_FINANCIAL
    &&entry.activationGeneration>0n&&entry.root!=='11111111111111111111111111111111','Invalid Financial page member.');
  return [readonly(page),readonly(entry.root)];
}
