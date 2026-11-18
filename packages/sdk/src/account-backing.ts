import type {ReadonlyUint8Array} from '@solana/kit';
import type {BackingState,SettlementCertificate,VenueRegistry} from './generated/index.js';
import type {AccountSnapshot} from './account-snapshot.js';
import {accountFundingBounds,accountSourceMode} from './account-balance.js';
import {ACCOUNT_SCHEMA} from './account-membership.js';
import {requireValue} from './wallet-client.js';

/** Decode the checked native RVBACK01 checkpoint, retaining full-width totals.
 * This is an unsigned scheduling hint; clearing authorizes every payment. */
export function decodeBackingSummary(encoded:ReadonlyUint8Array) {
  const bytes=Uint8Array.from(encoded);
  requireValue(bytes.length===104&&new TextDecoder().decode(bytes.slice(0,8))==='RVBACK01','Invalid backing summary domain.');
  const unsigned=(offset:number,length:number)=>{
    let value=0n;for(let index=offset+length-1;index>=offset;index--)value=(value<<8n)|BigInt(bytes[index]);return value;
  };
  const count=unsigned(8,8),bad=unsigned(16,8),rawQuantity=unsigned(24,16);
  const quantity=rawQuantity>=(1n<<127n)?rawQuantity-(1n<<128n):rawQuantity;
  const positive=unsigned(40,24),negative=unsigned(64,24),required=[unsigned(88,8),unsigned(96,8)];
  requireValue(bad<=count&&required.every(value=>value<=count)&&(quantity<0n?-quantity:quantity)<=count*100_000_000n
    &&positive+negative<=count*100_100_000_000_000_000_000_000_000n,'Invalid backing summary bounds.');
  return {count,bad,quantity,positive,negative,requiredMask:(required[0]?1:0)|(required[1]?2:0)};
}

function inside(snapshot:AccountSnapshot,backing:BackingState,mask:number) {
  return snapshot.marketStates.every((market,index)=>{
    if(!(mask&(1<<index)))return true;
    const prices=backing.region.prices[index],funding=backing.region.funding[index];
    const held=accountFundingBounds(snapshot.safetyState,market,snapshot.now,snapshot.slot);
    return prices[0]>=1n&&prices[0]<=prices[1]&&prices[1]<=1_000_000n
      &&funding[0]>=-1_000_000_000_000_000n&&funding[0]<=funding[1]&&funding[1]<=1_000_000_000_000_000n
      &&market.configEpoch===backing.configEpochs[index]&&market.lower>=prices[0]&&market.upper<=prices[1]
      &&held[0]>=funding[0]&&held[1]<=funding[1];
  });
}

export function accountBackingStatus(snapshot:AccountSnapshot,registry:VenueRegistry,proof:SettlementCertificate) {
  requireValue(proof.marketIndex<2&&proof.schemaVersion===ACCOUNT_SCHEMA&&proof.venue===snapshot.venue,
    'Foreign backing certificate.');
  const ledger=snapshot.ledgerStates[proof.marketIndex],backing=ledger.backing;
  if(backing.epoch===0n)return {current:false,restart:true,sourcesCurrent:false,complete:false,arithmeticReady:false,payable:false,requiredMask:0};
  const totals=decodeBackingSummary(backing.summary);
  const current=proof.backingEpoch===backing.epoch&&backing.safetyEpoch===snapshot.safetyState.epoch
    &&backing.termsEpoch===snapshot.venueState.termsEpoch&&backing.membershipEpoch===registry.membershipEpoch
    &&proof.count===registry.financialCount&&proof.next<=proof.count&&totals.count===proof.next
    &&inside(snapshot,backing,totals.requiredMask);
  const sourcesCurrent=snapshot.marketStates.every((market,index)=>!(totals.requiredMask&(1<<index))
    ||['Normal','Degraded'].includes(accountSourceMode(snapshot.safetyState,market,snapshot.now,snapshot.slot)));
  const complete=current&&proof.complete&&proof.next===proof.count;
  const arithmeticReady=totals.count===proof.count&&totals.bad===0n&&totals.quantity===0n
    &&totals.positive===totals.negative+ledger.settlement*1_000_000_000n;
  return {current,restart:!current||(!proof.complete&&!inside(snapshot,backing,3)),sourcesCurrent,complete,arithmeticReady,
    payable:complete&&sourcesCurrent&&arithmeticReady,requiredMask:totals.requiredMask};
}
