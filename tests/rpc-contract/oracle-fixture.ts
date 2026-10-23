// Explicit local dependency wire schema, independently encoded from Anchor.
import {createHash} from 'node:crypto';
import {address,AccountRole,getAddressEncoder,getProgramDerivedAddress,type Instruction} from '@solana/kit';
import type {Keypair} from '@solana/web3.js';
import {fixtureKey} from './custody-cases.js';
export const ORACLE_FIXTURE=address('A5ACpHNQHLkCQtfvRkPoR45juvuxwfi9mEWGU43eD5nj');
const disc=(name:string)=>createHash('sha256').update(`global:${name}`).digest().subarray(0,8);
export async function feedAddress(index:number){
  const authority=await fixtureKey(index<2?'p07-primary':'p07-guard');
  const id=Buffer.alloc(32,index+1),[feed]=await getProgramDerivedAddress({programAddress:ORACLE_FIXTURE,seeds:[Buffer.from('feed'),getAddressEncoder().encode(authority.address),id]});
  return {feed,authority,id};
}
export async function initializeFeed(index:number):Promise<Instruction>{
  const f=await feedAddress(index);
  return {programAddress:ORACLE_FIXTURE,accounts:[{address:f.authority.address,role:AccountRole.WRITABLE_SIGNER},{address:f.feed,role:AccountRole.WRITABLE},{address:address('11111111111111111111111111111111'),role:AccountRole.READONLY}],data:Buffer.concat([disc('initialize'),f.id])};
}
export type SourceChange={verifier?:string;level?:number;price?:bigint;confidence?:bigint;exponent?:number;published?:bigint};
export async function publishFeed(index:number,now:bigint,change:SourceChange={},signer?:Keypair):Promise<Instruction>{
  const f=await feedAddress(index),data=Buffer.alloc(69);disc('publish').copy(data);
  data.set(getAddressEncoder().encode(address(change.verifier??ORACLE_FIXTURE)),8);data[40]=change.level??2;
  data.writeBigInt64LE(change.price??(index%2===0?60_000_000_000n:1_000_000n),41);data.writeBigUInt64LE(change.confidence??0n,49);
  data.writeInt32LE(change.exponent??-6,57);data.writeBigInt64LE(change.published??now,61);
  return {programAddress:ORACLE_FIXTURE,accounts:[{address:signer?.address??f.authority.address,role:AccountRole.READONLY_SIGNER},{address:f.feed,role:AccountRole.WRITABLE}],data};
}
