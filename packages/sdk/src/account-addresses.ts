import {getAddressEncoder,getProgramDerivedAddress,type Address,type ReadonlyUint8Array} from '@solana/kit';
import {CLEARING_PROGRAM_ADDRESS} from './generated/index.js';

const encoder=getAddressEncoder();
export const accountIndexBytes=(index:number,maximum:number)=>{
  if(!Number.isSafeInteger(index)||index<0||index>maximum)throw new Error('Invalid account identity index');
  return new Uint8Array([index&255,index>>>8]);
};
const derive=(prefix:string,seeds:ReadonlyUint8Array[],programAddress:Address)=>getProgramDerivedAddress({programAddress,
  seeds:[new TextEncoder().encode(prefix),...seeds]});
export function deriveAccountVenue(domain:Uint8Array,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  if(domain.length!==32)throw new Error('Venue domain must have 32 bytes');
  return derive('venue-v3',[domain],programAddress);
}
export function findVenueComponentV3Pda(venue:Address,component:'custody'|'safety'|'registry'|'vault'|'resolution'|'resolution-work'|'retirement',
  programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  return derive(`${component}-v3`,[encoder.encode(venue)],programAddress);
}
export function findMarketV3Pda(venue:Address,index:number,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  return derive('market-v3',[encoder.encode(venue),accountIndexBytes(index,1).slice(0,1)],programAddress);
}
export function deriveAccountPortfolio(venue:Address,owner:Address,index:number,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  return derive('portfolio-v3',[encoder.encode(venue),encoder.encode(owner),accountIndexBytes(index,3)],programAddress);
}
export function findMarginV3Pda(portfolio:Address,index:number,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  return derive('margin-v3',[encoder.encode(portfolio),accountIndexBytes(index,8)],programAddress);
}
export function findLedgerV3Pda(market:Address,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  return derive('ledger-v3',[encoder.encode(market)],programAddress);
}
export function findAccountMakerV3Pda(market:Address,index:number,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  return derive('maker-v3',[encoder.encode(market),accountIndexBytes(index,1).slice(0,1)],programAddress);
}
export function findResolutionPageV3Pda(venue:Address,index:number,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  return derive('resolution-page-v3',[encoder.encode(venue),accountIndexBytes(index,31)],programAddress);
}
export function findBackingV3Pda(venue:Address,index:number,programAddress:Address=CLEARING_PROGRAM_ADDRESS) {
  return derive('settlement-v3',[encoder.encode(venue),accountIndexBytes(index,1).slice(0,1)],programAddress);
}
