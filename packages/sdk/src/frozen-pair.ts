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
