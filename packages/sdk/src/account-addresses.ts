import {getAddressEncoder,getProgramDerivedAddress,type Address,type ReadonlyUint8Array} from '@solana/kit';
import {CLEARING_PROGRAM_ADDRESS} from './generated/index.js';

const encoder=getAddressEncoder();
export const accountIndexBytes=(index:number,maximum:number)=>{
  if(!Number.isSafeInteger(index)||index<0||index>maximum)throw new Error('Invalid account identity index');
  return new Uint8Array([index&255,index>>>8]);
};
/** Portfolio/child seeds widened in fresh schema 9; market indices remain u8. */
export function namespaceIndexBytes(index:number,maximum=0xffff_ffff) {
  if(!Number.isSafeInteger(index)||index<0||index>maximum||maximum>0xffff_ffff)throw new Error('Invalid namespace index');
  const bytes=new Uint8Array(4);new DataView(bytes.buffer).setUint32(0,index,true);return bytes;
}
export function memberIndexBytes(index:bigint) {
  if(index<0n||index>(1n<<64n)-1n)throw new Error('Invalid member index');
  const bytes=new Uint8Array(8);new DataView(bytes.buffer).setBigUint64(0,index,true);return bytes;
}
const derive=(prefix:string,seeds:ReadonlyUint8Array[],programAddress:Address)=>getProgramDerivedAddress({programAddress,
  seeds:[new TextEncoder().encode(prefix),...seeds]});
export function deriveAccountVenue(domain:Uint8Array,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  if(domain.length!==32)throw new Error('Venue domain must have 32 bytes');
  return derive('venue-v3',[domain],programAddress);
}
export function deriveVenueComponent(venue:Address,component:'custody'|'safety'|'registry'|'vault'|'resolution'|'resolution-work'|'retirement',
  programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  return derive(`${component}-v3`,[encoder.encode(venue)],programAddress);
}
export function deriveAccountMarket(venue:Address,index:number,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  return derive('market-v3',[encoder.encode(venue),accountIndexBytes(index,1).slice(0,1)],programAddress);
}
export function deriveAccountPortfolio(venue:Address,owner:Address,index:number,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  return derive('portfolio-v3',[encoder.encode(venue),encoder.encode(owner),namespaceIndexBytes(index,3)],programAddress);
}
export function deriveMarginAccount(portfolio:Address,index:number,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  return derive('margin-v3',[encoder.encode(portfolio),namespaceIndexBytes(index,8)],programAddress);
}
export function deriveMarketLedger(market:Address,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  return derive('ledger-v3',[encoder.encode(market)],programAddress);
}
export function findResolutionPagePda(venue:Address,index:number,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  return derive('resolution-page-v3',[encoder.encode(venue),accountIndexBytes(index,31)],programAddress);
}
export function deriveSettlementCertificate(venue:Address,index:number,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  return derive('settlement-v3',[encoder.encode(venue),accountIndexBytes(index,1).slice(0,1)],programAddress);
}

export function deriveMemberPage(venue:Address,page:bigint,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  if(page>((1n<<64n)-1n)/64n)throw new Error('Invalid member page');
  return derive('member-page',[encoder.encode(venue),memberIndexBytes(page)],programAddress);
}
export function deriveMemberIndex(venue:Address,level:number,prefix:bigint,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  if(!Number.isInteger(level)||level<0||level>14||prefix<0n||prefix>=1n<<BigInt(Math.max(0,58-4*(level+1))))throw new Error('Invalid member index path');
  return derive('member-index',[encoder.encode(venue),Uint8Array.of(level),memberIndexBytes(prefix)],programAddress);
}
export function deriveRecoveryStorage(venue:Address,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  return derive('recovery-storage',[encoder.encode(venue)],programAddress);
}
export function deriveStorageFunding(venue:Address,allocation:Address,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  return derive('storage-funding',[encoder.encode(venue),encoder.encode(allocation)],programAddress);
}
export function deriveCapitalBinding(margin:Address,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  return derive('capital-v3',[encoder.encode(margin)],programAddress);
}
export function deriveMemberPath(venue:Address,id:bigint) {
  memberIndexBytes(id);
  return Promise.all(Array.from({length:15},(_,level)=>deriveMemberIndex(venue,level,(id/64n)>>BigInt(4*(level+1)))));
}
