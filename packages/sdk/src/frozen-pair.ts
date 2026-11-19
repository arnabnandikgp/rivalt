import type {PreparedSettlement} from './generated/index.js';
import {requireValue} from './wallet-client.js';

export function frozenPairReceipt(prepared:PreparedSettlement) {
  const bytes=Uint8Array.from(prepared.state.membership);
  const marker=new TextDecoder().decode(bytes.subarray(0,8));
  if(marker!=='RVPAIR01'&&marker!=='RVPAIR02')return null;
  const view=new DataView(bytes.buffer);
  const word=(index:number)=>view.getBigUint64(8+8*index,true);
  const [epoch,debtorId,winnerId,charge,price,unpaidGainCap]=Array.from({length:6},(_,index)=>word(index));
  const schedule=marker==='RVPAIR02'?{matchedLots:word(6),extraTickLots:word(7)}:undefined;
  requireValue(epoch===prepared.epoch&&debtorId!==winnerId&&charge<=unpaidGainCap&&(price===0n)===(charge===0n)
    &&bytes.subarray(schedule?72:56).every(byte=>byte===0),'Invalid verified pair receipt.');
  if(schedule)requireValue((charge===0n)===(schedule.matchedLots===0n)&&
    (schedule.matchedLots===0n?schedule.extraTickLots===0n:schedule.extraTickLots===charge%schedule.matchedLots),
    'Invalid paired lots.');
  return {epoch,debtorId,winnerId,charge,price,unpaidGainCap,...schedule};
}

/** Authenticated header record for the linked qualification profile. The first
 * verified leg is a continuation checkpoint. Only the completed pair can pay. */
export function frozenJointReceipt(prepared:PreparedSettlement) {
  const bytes = Uint8Array.from(prepared.state.membership);
  if (new TextDecoder().decode(bytes.subarray(0,8)) !== 'RVLINK01') return null;
  const view = new DataView(bytes.buffer);
  const word = (index:number) => view.getBigUint64(8+index*8,true);
  const epoch = word(0), debtor = word(1), shares = [word(2), word(3)];
  const legs = [4,10].map(offset => ({
    winner:word(offset), charge:word(offset+1), eligible:word(offset+2),
    matched:word(offset+3), price:word(offset+4), extra:word(offset+5),
  }));
  const complete = prepared.stage === 2 || prepared.stage === 3;
  requireValue((prepared.stage===6 || complete) && prepared.epoch===epoch
    && bytes.subarray(136).every(value=>value===0), 'Invalid joint receipt header.');
  for (const leg of complete ? legs : [legs[0]]) {
    requireValue(leg.winner!==debtor && leg.charge>0n && leg.charge<=leg.eligible && leg.price>0n &&
      leg.matched>0n && leg.extra===leg.charge%leg.matched, 'Invalid joint reduction.');
  }
  requireValue(complete ? legs[0].winner!==legs[1].winner : Object.values(legs[1]).every(value=>value===0n),
    'Invalid joint receipt progress.');
  return {epoch,debtor,shares,legs,complete};
}

/** Atomic BTC/ETH certificate, in debtor, flat creditor, cross winner, ETH winner order. */
export function foreignCreditorReceipt(prepared: PreparedSettlement) {
  const bytes = Uint8Array.from(prepared.state.membership);
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== 'RVCHAIN1') return null;
  const view = new DataView(bytes.buffer);
  const word = (index: number) => view.getBigUint64(8 + index * 8, true);
  const members = [word(1), word(2), word(3), word(4)];
  requireValue((prepared.stage === 2 || prepared.stage === 3) && prepared.epoch === word(0)
    && new Set(members).size === 4 && bytes.subarray(144).every(byte => byte === 0), 'Invalid foreign creditor certificate.');
  const legs = [5, 11].map((offset, market) => {
    const terms = {winner:word(offset), charge:word(offset+1), eligible:word(offset+2),
      matched:word(offset+3), price:word(offset+4), extra:word(offset+5)};
    requireValue(terms.winner === members[market+2] && terms.charge > 0n && terms.charge <= terms.eligible
      && terms.price > 0n && terms.matched > 0n && terms.extra === terms.charge % terms.matched, 'Invalid foreign creditor schedule.');
    return terms;
  });
  return {members, legs};
}

export function sharedInventoryReceipt(prepared:PreparedSettlement) {
  const bytes=Uint8Array.from(prepared.state.membership);
  if(new TextDecoder().decode(bytes.subarray(0,8))!=='RVLOTS01')return null;
  const view=new DataView(bytes.buffer),word=(index:number)=>view.getBigUint64(8+8*index,true);
  const members=[word(1),word(2),word(3),word(4)],charges=[word(5),word(6)];
  const eligible=[word(7),word(8)],prices=[word(9),word(10)];
  requireValue(word(0)===prepared.epoch && [2,3].includes(prepared.stage) && members[0]<members[1]
    && new Set(members).size===4 && bytes.subarray(96).every(byte=>byte===0)
    && charges.every((charge,index)=>charge>0n && charge<=eligible[index] && prices[index]>0n),'Invalid shared inventory receipt.');
  return {members,charges,eligible,prices};
}
